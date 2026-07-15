import fs from "fs";
import path from "path";
import crypto from "crypto";
import sharp from "sharp";

/**
 * Phase 7.10 — Object storage abstraction for service images.
 *
 * The database NEVER stores image binaries — only the `url`/`thumbnailUrl`
 * strings this module returns. Today the storage driver is local disk,
 * persisted under a project-level directory (survives restarts, backed up
 * with the rest of the repl). Swapping in Cloudflare R2 or Amazon S3 later
 * only requires implementing the same `StorageDriver` interface below and
 * changing `getStorageDriver()` — no route or business-logic changes.
 */

export interface UploadResult {
  url: string;
  thumbnailUrl: string;
}

export interface StorageDriver {
  /** Store the original + a generated thumbnail; return public URLs for both. */
  upload(buffer: Buffer, keyPrefix: string, mimetype: string): Promise<UploadResult>;
  /** Delete a previously uploaded file (and its thumbnail) given its public URL. Safe to call on unknown/foreign URLs — becomes a no-op. */
  delete(url: string): Promise<void>;
}

const STORAGE_ROOT = path.resolve(process.cwd(), "..", "..", "storage", "service-images");
const PUBLIC_PREFIX = "/uploads/service-images";

const MAX_DIMENSION = 1200;
const THUMB_DIMENSION = 200;
const JPEG_QUALITY = 82;

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

class LocalDiskStorageDriver implements StorageDriver {
  constructor() {
    ensureDir(STORAGE_ROOT);
  }

  async upload(buffer: Buffer, keyPrefix: string, _mimetype: string): Promise<UploadResult> {
    const id = crypto.randomBytes(12).toString("hex");
    const baseName = `${keyPrefix}-${id}`;

    // Normalize everything to compressed JPEG — keeps storage small and
    // avoids serving arbitrary/oversized formats back to clients.
    const original = await sharp(buffer)
      .rotate() // respect EXIF orientation, then strip it
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
    if (!url.startsWith(PUBLIC_PREFIX)) return; // not one of ours (e.g. "icon:" scheme, external URL) — no-op
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

let driver: StorageDriver | null = null;

export function getStorageDriver(): StorageDriver {
  if (!driver) driver = new LocalDiskStorageDriver();
  return driver;
}

export function getStorageRoot(): string {
  return STORAGE_ROOT;
}

export const STORAGE_PUBLIC_PREFIX = PUBLIC_PREFIX;

/** 5MB cap — generous for phone camera photos, small enough to keep uploads fast. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
