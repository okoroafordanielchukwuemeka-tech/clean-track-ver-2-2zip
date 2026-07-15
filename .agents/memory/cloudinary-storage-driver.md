---
name: Cloudinary Storage Driver
description: Service image storage migrated from local disk to Cloudinary; how the driver works, URL format, and delete convention.
---

## Rule
All service image uploads go through `CloudinaryStorageDriver` in `artifacts/api-server/src/lib/storage.ts`. The driver is selected automatically at first use if all three secrets are present (`CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`); falls back to `LocalDiskStorageDriver` if not.

## How it works
- Upload: sharp-normalises to ≤1200px JPEG → uploads as base64 data URI to Cloudinary folder `cleantrack/` with public_id `cleantrack/{keyPrefix}-{randomHex}`.
- Original URL: `result.secure_url` from Cloudinary upload response.
- Thumbnail URL: constructed via `cloudinary.url(publicId, { width: 200, height: 200, crop: "fill", ... })` — no second upload; Cloudinary generates and caches the transformation on first request.
- Delete: `extractCloudinaryPublicId(url)` parses the secure_url by splitting at `image/upload/`, stripping any version segment (`v\d+`) and transformation segments (contain `=` or `,`), then stripping extension. Calls `cloudinary.uploader.destroy(publicId)`. Non-Cloudinary URLs (e.g. `icon:` scheme, local `/uploads/...`) return null from extractor → no-op.

## Legacy local images
`app.ts` still serves `express.static(getStorageRoot())` at `/uploads/service-images` for images uploaded before migration. Leave this route in place until all pre-migration local images are either migrated or no longer referenced in the DB.

**Why:** local disk storage doesn't survive deployment restarts in production; Cloudinary provides persistent CDN-served storage with transformation API for free thumbnails.

**How to apply:** when adding a new upload endpoint for a different resource type (e.g. worker avatars), implement a new driver call or reuse `getStorageDriver()` with a different `keyPrefix`. Never write images to disk directly.
