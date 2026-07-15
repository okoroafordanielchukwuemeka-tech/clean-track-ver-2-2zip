---
name: Cloudinary Image System Certification
description: Phase 7.11.1 certification results, bugs fixed, and known behaviors documented
---

# Cloudinary Image System Certification

## Bugs Fixed During Certification

### 1. Multer errors bypassing route try-catch (FIXED)
**Why**: POST /:id/image used upload.single("file") as Express middleware. When multer rejects (LIMIT_FILE_SIZE, UNSUPPORTED_TYPE), it calls next(err) — skipping the route handler's try-catch and hitting the global 500 handler instead.
**Fix**: Moved multer inline as a Promise inside the route handler, catching errors before they propagate.
**File**: artifacts/api-server/src/routes/services.ts — POST /:id/image
**How to apply**: Any new file-upload route must run multer inline: `const multerErr = await new Promise(resolve => upload.single("file")(req, res, err => resolve(err ?? null)))`

### 2. Missing broken-image fallback (FIXED)
**Why**: ServiceImage <img> had no onError handler — browser shows broken icon if CDN URL fails.
**Fix**: Added imgError state + onError handler + renders <ImageOff> placeholder.
**File**: artifacts/clean-track/src/components/service-image.tsx

### 3. Missing lazy loading (FIXED)
**Fix**: Added loading="lazy" attribute to ServiceImage <img>.

## Documented Behaviors (By Design)

### Duplicate service shares Cloudinary asset
POST /:id/duplicate copies imageUrl/thumbnailUrl strings — no new Cloudinary asset created.
Both DB records point to the same CDN URL. Cost optimization; acceptable since duplicates typically get new images.

### CSV export excludes imageUrl
Export columns: name, category, standardPrice, expressPrice, premiumPrice, isActive.
imageUrl excluded — CDN URLs not portable across accounts.

### thumbnailUrl is a Cloudinary transformation URL (not a separate upload)
Format: c_fill,h_200,q_82,w_200 transformation. Zero extra storage cost.

## Orphan Asset Audit (Post-Certification)
- Cloudinary assets in cleantrack/: 3
- DB unique Cloudinary refs: 3 (4 total, service-1 and service-11/copy share same URL)
- Orphans: 0, Broken refs: 0
