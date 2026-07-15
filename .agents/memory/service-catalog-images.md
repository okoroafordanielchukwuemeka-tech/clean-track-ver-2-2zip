---
name: Service Catalog & Image Management (Phase 7.10)
description: Object-storage abstraction, default icon library, and image URL conventions for the services module.
---

- `imageUrl` on `services` has three states: `null` (no image — client suggests a default icon by matching the service name against a keyword list), `"icon:<key>"` (owner explicitly picked a bundled icon), or a real URL (custom photo upload). The DB never stores binary image data, only these strings.
- Image files live on local disk under a `storage/` directory at the monorepo root (outside both artifact folders) so they survive artifact rebuilds/restarts, served via `express.static` at a `/uploads/...` prefix registered before body-parsing middleware.
- Storage is behind a `StorageDriver` interface (`upload`/`delete`) specifically so the local-disk implementation can be swapped for a real bucket (S3/R2) later without touching business logic. No cloud object-storage integration was available/configured at build time — this was a judgment call, not a user-approved architecture decision.
- Branch-specific service availability uses a join table: zero rows for a service = available at all branches (backward compatible default), one or more rows = restricted to those branches.

**Why:** keeps DB rows small/portable, keeps image handling swappable, and avoids a breaking migration for laundries that don't use per-branch service restriction.
**How to apply:** any new code touching service images or branch-scoped service availability should read/write through these same conventions rather than inventing a second image or branch-scoping mechanism.
