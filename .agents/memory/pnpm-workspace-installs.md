---
name: pnpm workspace package installs
description: Why installLanguagePackages is unsafe in this pnpm monorepo and what to use instead.
---

`installLanguagePackages` ran `npm install` at the pnpm workspace root instead of the target workspace member, which rewrote the root `package.json`/added a stray `package-lock.json` and wiped/replaced ~700 pnpm-managed packages in `node_modules`.

**Why:** the tool isn't workspace-aware in this repo layout (multiple `artifacts/*` packages + shared `lib/*` packages under one pnpm workspace); it defaults to root-level npm semantics which conflict with pnpm's workspace linking.
**How to apply:** for this monorepo, install packages with `pnpm --filter <workspace-package-name> add <pkg>` (or `-D` for dev deps) via ShellExec directly, never via `installLanguagePackages`. If a bad install already happened, recovery is: delete the stray root `package-lock.json`, revert root `package.json`, wipe `node_modules`, and run a clean `pnpm install` before redoing the install correctly.
