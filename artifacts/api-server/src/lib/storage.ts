import fs from "fs";
import path from "path";
import crypto from "crypto";
import sharp from "sharp";
import { v2 as cloudinary } from "cloudinary";

/**
 * Object storage abstraction for service images.
 *
 * The database NEVER stores image binaries — only the `url`/`thumbnailUrl`
 * strings this module returns.
 *
 * Driver selection (checked once at first use):
 *   • CLOUDINARY_CLOUD_NAME + CLOUDINARY_API_KEY + CLOUDINARY_API_SECRET set
 *     → CloudinaryStorageDriver  (images served via Cloudinary CDN)
 *   • Otherwise
 *     → LocalDiskStorageDriver   (images served via express.static on this server)
 *
 * Swapping drivers only requires changing `getStorageDriver()` — no route or
 * business-logic code changes needed.  The express.static route in app.ts
 * continues to serve any images that were uploaded before the Cloudinary
 * migration; new uploads resolve directly to the CDN.
 */

export interface UploadResult {
  url: string;
  thumbnailUrl: string;
}

export interface StorageDriver {
  /** Store the original + a generated thumbnail; return public URLs for both. */
  upload(buffer: Buffer, keyPrefix: string, mimetype: string): Promise<UploadResult>;
  /**
   * Delete a previously uploaded file (and its thumbnail) given its public URL.
   * Safe to call on unknown/foreign URLs (e.g. "icon:" scheme) — becomes a no-op.
   */
  delete(url: string): Promise<void>;
}

// ─── Shared image-processing constants ───────────────────────────────────────

const MAX_DIMENSION = 1200;
const THUMB_DIMENSION = 200;
const JPEG_QUALITY = 82;

// ─── Local disk driver ───────────────────────────────────────────────────────

const STORAGE_ROOT = path.resolve(process.cwd(), "..", "..", "storage", "service-images");
const PUBLIC_PREFIX = "/uploads/service-images";

class LocalDiskStorageDriver implements StorageDriver {
  constructor() {
    fs.mkdirSync(STORAGE_ROOT, { recursive: true });
  }

  async upload(buffer: Buffer, keyPrefix: string, _mimetype: string): Promise<UploadResult> {
    const id = crypto.randomBytes(12).toString("hex");
    const baseName = `${keyPrefix}-${id}`;

    const original = await sharp(buffer)
      .rotate()
      .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toBuffer();

    const thumbnail = await sharp(buffer)
      .rotate()
      .resize({ width: THUMB_DIMENSION, height: THUMB_DIMENSION, fit: "cover" })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toBuffer();

    const fileName = `${baseName}.jpg`;
    const thumbName = `${baseName}-thumb.jpg`;

    fs.writeFileSync(path.join(STORAGE_ROOT, fileName), original);
    fs.writeFileSync(path.join(STORAGE_ROOT, thumbName), thumbnail);

    return {
      url: `${PUBLIC_PREFIX}/${fileName}`,
      thumbnailUrl: `${PUBLIC_PREFIX}/${thumbName}`,
    };
  }

  async delete(url: string): Promise<void> {
    if (!url.startsWith(PUBLIC_PREFIX)) return;
    const fileName = url.slice(PUBLIC_PREFIX.length + 1);
    if (!fileName || fileName.includes("..") || fileName.includes("/")) return;
    const base = fileName.replace(/\.jpg$/, "");
    const thumbFileName = base.endsWith("-thumb") ? fileName : `${base}-thumb.jpg`;
    for (const f of [fileName, thumbFileName]) {
      const full = path.join(STORAGE_ROOT, f);
      if (fs.existsSync(full)) fs.unlinkSync(full);
    }
  }
}

// ─── Cloudinary driver ────────────────────────────────────────────────────────

/**
 * All images are stored under the "cleantrack/" folder in Cloudinary so they
 * are easy to find and bulk-manage in the Cloudinary dashboard.
 *
 * Thumbnails are NOT uploaded separately — Cloudinary's transformation URL API
 * generates them on the fly from the original and caches them on the CDN
 * (zero extra storage cost, no second round-trip).
 *
 * delete() recovers the public_id from the URL by stripping the standard
 * Cloudinary URL prefix and optional version segment, then the extension.
 */
const CLOUDINARY_FOLDER = "cleantrack";
const CLOUDINARY_HOST = "res.cloudinary.com";

class CloudinaryStorageDriver implements StorageDriver {
  constructor() {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true,
    });
    console.log("[storage] CloudinaryStorageDriver active — cloud:", process.env.CLOUDINARY_CLOUD_NAME);
  }

  async upload(buffer: Buffer, keyPrefix: string, _mimetype: string): Promise<UploadResult> {
    const id = crypto.randomBytes(12).toString("hex");
    const publicId = `${CLOUDINARY_FOLDER}/${keyPrefix}-${id}`;

    // Run through sharp first: normalise orientation, cap dimensions, ensure JPEG.
    // This keeps uploads lean and avoids serving oversized originals via CDN.
    const processed = await sharp(buffer)
      .rotate()
      .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toBuffer();

    // Upload as base64 data URI — simplest approach for an in-memory Buffer.
    const dataUri = `data:image/jpeg;base64,${processed.toString("base64")}`;

    const result = await cloudinary.uploader.upload(dataUri, {
      public_id: publicId,
      resource_type: "image",
      overwrite: false,
    });

    // Derive thumbnail URL via Cloudinary's transformation API.
    // No second upload: Cloudinary generates & caches the crop on first request.
    const thumbnailUrl = cloudinary.url(publicId, {
      width: THUMB_DIMENSION,
      height: THUMB_DIMENSION,
      crop: "fill",
      quality: JPEG_QUALITY,
      format: "jpg",
      secure: true,
      version: result.version,
    });

    return { url: result.secure_url, thumbnailUrl };
  }

  async delete(url: string): Promise<void> {
    const publicId = extractCloudinaryPublicId(url);
    if (!publicId) return; // not one of ours — no-op
    try {
      await cloudinary.uploader.destroy(publicId, { resource_type: "image" });
    } catch (err) {
      // Log but don't throw — a failed delete should never block a route response.
      console.warn("[storage] Cloudinary delete failed for", publicId, err);
    }
  }
}

/**
 * Extract the Cloudinary public_id from a secure_url.
 *
 * URL formats:
 *   https://res.cloudinary.com/{cloud}/image/upload/{public_id}.{ext}
 *   https://res.cloudinary.com/{cloud}/image/upload/v{digits}/{public_id}.{ext}
 *   https://res.cloudinary.com/{cloud}/image/upload/w_200,h_200,c_fill/v{digits}/{public_id}.{ext}
 *
 * Returns null for any URL that doesn't match (safe to call on local-disk or
 * external URLs — callers treat null as a no-op).
 */
function extractCloudinaryPublicId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== CLOUDINARY_HOST) return null;

    // Path: /{cloud}/image/upload/[transforms/][v{digits}/]{public_id}.{ext}
    const parts = parsed.pathname.split("/");
    // Find "upload" segment index
    const uploadIdx = parts.indexOf("upload");
    if (uploadIdx === -1) return null;

    // Collect segments after "upload", skipping transformation strings and version
    const afterUpload = parts.slice(uploadIdx + 1);
    const meaningful = afterUpload.filter((seg) => {
      if (!seg) return false;
      if (/^v\d+$/.test(seg)) return false;      // version: v1234567890
      if (/[=,]/.test(seg)) return false;        // transformation: w_200,h_200
      return true;
    });

    if (!meaningful.length) return null;

    // Last segment has the extension — strip it
    const last = meaningful[meaningful.length - 1];
    const dotIdx = last.lastIndexOf(".");
    if (dotIdx !== -1) meaningful[meaningful.length - 1] = last.slice(0, dotIdx);

    return meaningful.join("/");
  } catch {
    return null;
  }
}

// ─── Driver singleton & exports ───────────────────────────────────────────────

let driver: StorageDriver | null = null;

export function getStorageDriver(): StorageDriver {
  if (!driver) {
    const hasCloudinary =
      process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET;
    driver = hasCloudinary ? new CloudinaryStorageDriver() : new LocalDiskStorageDriver();
  }
  return driver;
}

/** Path to local disk storage root — used by app.ts to serve legacy images via express.static. */
export function getStorageRoot(): string {
  return STORAGE_ROOT;
}

/** URL prefix under which local-disk images are served. */
export const STORAGE_PUBLIC_PREFIX = PUBLIC_PREFIX;

/** 5 MB cap — generous for phone camera photos, small enough to keep uploads fast. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
