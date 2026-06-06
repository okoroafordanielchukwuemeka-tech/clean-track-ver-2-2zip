---
name: Worker Operational Messaging
description: Worker-accessible WhatsApp notification endpoints added to the orders router, and the Communication Panel UI on order-detail.
---

## Rule
Three new endpoints live on the `/api/orders` router (already `requireAuth`), giving workers controlled messaging access without touching `/api/communication` (which remains `requireOwner`):

- `POST /orders/:id/send-notification` — `checkPermission("process:orders")` — type `"ready"` maps to `"order_ready"` eventType, `"reminder"` maps to `"overdue"` (which the dispatcher maps to `"pickup_reminder"` template trigger)
- `GET /orders/:id/messages` — `checkPermission("view:orders")` — JOINs `notificationMessages` → `notificationEvents` on `eventId` to filter by `orderId`
- `POST /orders/:id/messages/:msgId/retry` — `checkPermission("process:orders")` — sets status to "queued", then calls `providerRegistry.getProvider()` via dynamic import

## Why
All `/api/communication` routes are `requireOwner` — workers had zero messaging access. The fix adds routes on the already-worker-accessible `/api/orders` router instead of relaxing the `requireOwner` on `/api/communication`.

## How to apply
- Never compare `order.status !== "cancelled"` on the frontend — the `Order.status` type is `"pending" | "processing" | "ready" | "partial_pickup" | "completed"` (no cancelled), TypeScript will flag it as unintentional
- `notificationMessages` doesn't have a direct `orderId` column — always JOIN through `notificationEvents` to filter messages by order
- `buildOrderVariables()` and `dispatchNotification()` are both exported from `notification-dispatcher.ts`
- `providerRegistry` is at `../lib/providers/registry.js` (use dynamic import inside the route to avoid circular refs)
