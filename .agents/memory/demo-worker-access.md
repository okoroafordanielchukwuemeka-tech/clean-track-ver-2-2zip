---
name: Demo Worker Access
description: Reliability rule for the public demo worker shortcut when seed data uses generated phone numbers
---

## Rule
The public demo worker shortcut must authenticate through a server-side demo-only endpoint that resolves the seeded demo worker. The client must not embed a worker phone number.

**Why:** Demo seed data generates worker phone numbers, so a client-side shortcut tied to one phone can silently become invalid while normal worker authentication remains healthy.

**How to apply:** Keep the shortcut rate-limited and return a clear setup/unavailable error when the demo worker is missing; preserve ordinary phone + PIN login for real workers.