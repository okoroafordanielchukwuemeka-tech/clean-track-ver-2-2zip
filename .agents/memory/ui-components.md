---
name: UI Components Available
description: Which shadcn/ui components exist in the Clean Track frontend and notes on adding new ones
---

**Existing components** (`artifacts/clean-track/src/components/ui/`):
badge, button, card, dialog, input, label, select, table, tabs, alert-dialog (added)

**Why:** The project uses a hand-built subset of shadcn/ui — components are NOT auto-generated from the CLI. They must be created manually.

**How to apply:** Before importing any `@/components/ui/X`, check that X.tsx exists. If missing:
1. Check if the corresponding `@radix-ui/react-X` package is in node_modules/.pnpm
2. If yes, create the component file modeled after dialog.tsx (same Radix + cn pattern)
3. If no, install the package first with pnpm

**Radix packages confirmed available:** react-dialog, react-alert-dialog, react-select, react-tabs
