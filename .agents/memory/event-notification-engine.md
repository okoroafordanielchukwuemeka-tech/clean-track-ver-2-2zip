---
name: Event & Notification Engine
description: How the operational event system and notifications are implemented in Clean Track
---

The event engine (`artifacts/api-server/src/lib/events.ts`) exposes a single `emitEvent()` async function that inserts into the `notifications` table.

**Rule:** Always call `emitEvent(...).catch(() => {})` in route handlers — fire-and-forget, never await, to avoid blocking the HTTP response.

**Why:** Notification failures should never break the main operation (order creation, payment, etc.).

**How to apply:**
- Orders route fires: new_order (POST), order_ready (PATCH status→ready), order_assigned (PATCH assignedWorkerId changed), payment_received (POST payment)
- Notifications route runs `detectOperationalAlerts()` in background on every GET to detect due_soon/overdue conditions
- Due-soon threshold: 75% of turnaround time (express=24h, premium=48h, standard=72h)
- Duplicate detection: checks for existing notification by (laundryId, eventType, relatedOrderId) before creating

**Polling:**
- Count: every 30s always
- Full list: every 15s when panel is open, paused when closed
