# CleanTrack — Real SaaS Master Completion Plan

Last updated: 2026-09-19

## Mission

Turn CleanTrack from a working prototype/deployed application into a production SaaS that a real laundry can sign up for, configure, operate daily, communicate with customers, pay for, and rely on — while the product is secure, recoverable, observable, maintainable, and ready for customer acquisition.

The finish line is NOT "the code builds."

The finish line is:

> A real laundry owner can discover CleanTrack, understand its value, sign up, configure the business and branches, create workers/services, receive and process orders, collect/return clothes, record payments, communicate with customers, see accurate reports, pay for the subscription, recover from failures, contact support, and continue using the system safely without us manually fixing their account.

---

# 1. Production foundation

## Done / verified

- [x] GitHub source of truth established.
- [x] Railway production deployment established.
- [x] Neon PostgreSQL production database connected.
- [x] Railway healthcheck working.
- [x] Production CORS configured.
- [x] Environment validation in production.
- [x] Cloudinary configured for persistent image storage.
- [x] SMTP/Resend-compatible email transport configured.
- [x] Paystack billing configuration present.
- [x] Daily backup scheduler present.
- [x] Operational background jobs running.
- [x] Temporary order-location migration command removed from Railway after successful one-time migration.
- [x] Production order-location migration verified:
  - 1,008 orders inspected.
  - 1,007 had legacy branch assignments.
  - 1,007 received all four explicit locations.
  - 0 legacy backfill mismatches.
  - 0 cross-tenant location assignments.
  - 1 order has no legacy branch and therefore remains without the four locations. This order must be investigated before location fields become required.
- [ ] Establish a durable production migration history that matches the real production database without replaying the old migration chain.
- [ ] Remove/clean remaining development-era diagnostics and warnings where appropriate.
- [ ] Make database migrations safe, repeatable, observable and documented.
- [ ] Configure off-site backups.
- [ ] Test backup restoration, not merely backup creation.
- [ ] Define retention policy and recovery procedure.
- [ ] Confirm Railway/Neon failure recovery procedure.
- [ ] Add production error monitoring and alerting.
- [ ] Define uptime/health monitoring.
- [ ] Add security headers/rate limiting where appropriate.
- [ ] Review secrets and credential rotation procedure.

---

# 2. Multi-tenant security

CleanTrack must behave as if every laundry is its own private database even though laundries share infrastructure.

## Required

- [ ] Audit every API route for laundry ownership.
- [ ] Audit every ID-based lookup.
- [ ] Audit every update/delete operation.
- [ ] Audit every nested resource.
- [ ] Verify workers cannot cross laundries.
- [ ] Verify workers cannot access another branch outside their operational permission.
- [ ] Verify owners can access only their own laundry.
- [ ] Verify customer, service, worker, branch, order, payment, batch and notification relationships are tenant-safe.
- [ ] Verify uploaded files cannot be used to cross tenants.
- [ ] Verify search cannot leak another laundry.
- [ ] Verify analytics cannot aggregate another laundry.
- [ ] Verify background jobs always carry laundry scope.
- [ ] Add regression tests for cross-tenant access attempts.

---

# 3. Branch architecture — current priority

## Business model

### PROCESSING
- Can process clothes.
- Cannot collect from customers.
- Cannot return/handover finished clothes under the current agreed model.

### PICKUP
- Can collect incoming clothes.
- Can return/handover finished clothes.
- Cannot process clothes.

### HYBRID
- Can collect.
- Can process.
- Can return/handover.

Do not silently add capabilities that were not agreed.

## Target order locations

Every order eventually needs four distinct concepts:

- collectionBranchId — where the clothes entered the business.
- processingBranchId — where processing is assigned.
- returnBranchId — where finished clothes are returned/handed over.
- currentBranchId — where the physical order currently is.

Legacy branchId remains temporarily as a compatibility bridge.

## Current migration status

- [x] Branch type field added.
- [x] Branch capability helper added.
- [x] Explicit order location columns added.
- [x] Existing branch data safely backfilled.
- [x] Cross-tenant location verification passed.
- [ ] Investigate the one legacy-unassigned order.
- [ ] Complete backend branchId usage audit.
- [ ] Replace order workflow authorization with operation-specific authorization.
- [ ] Add explicit movement/transfer history.
- [ ] Update batch logic.
- [ ] Update analytics.
- [ ] Update search.
- [ ] Update notifications.
- [ ] Update receipts.
- [ ] Update customer/order views.
- [ ] Update frontend branch selectors.
- [ ] Verify offline/PWA synchronization with the new location model.
- [ ] Only remove legacy branchId after every dependent workflow is migrated and verified.

## Branch audit findings on 2026-09-19

The old orders.branchId is still used by:

- order list/summary/recent/detail scoping;
- order creation;
- pickup authorization;
- batch visibility and creation/completion;
- analytics;
- search;
- branch detail counts;
- receipts;
- discount approval filtering;
- customer order history;
- notification branch naming;
- seed/demo scripts;
- frontend branch filtering;
- worker queues.

Therefore the correct action is NOT to delete branchId now.

Classification:

### KEEP temporarily
- orders.branchId as compatibility field.
- workers.branchId as the worker's assigned/home branch.
- customers.branchId where it represents customer ownership/location.
- conversations.branchId and other genuinely branch-owned records.
- branchId in events/alerts/device records when it represents the originating branch.

### CHANGE
- Order list/detail/summary filters must use current operational location and/or the relevant lifecycle location.
- Order creation must accept explicit collection/processing/return locations.
- Worker authorization must be operation-specific.
- Pickup/return authorization must use return/current location and canReturn.
- Processing authorization must use processing/current location and canProcess.
- Collection authorization must use collection/current location and canCollect.
- Batch visibility and assignment must use processing/current location.
- Analytics must define whether a metric is based on collection, processing, return or current location.
- Search must use current/relevant lifecycle location.
- Receipts must show the relevant branch for the event being represented.
- Notification branch context must use the branch relevant to the notification/event.

### REPLACE later
- Any order workflow whose only branch meaning is "the order belongs to this branch."
- Silent branch overwrites used to represent movement.
- Legacy branch equality checks for worker assignment.

### DEPRECATE last
- orders.branchId only after all consumers are migrated and production data has been verified.

---

# 4. Order lifecycle

The core lifecycle must be reliable under normal use, duplicate requests, concurrency, partial pickups, cancellation and payment changes.

## Target lifecycle

1. Order created at collection branch.
2. Order verified.
3. Processing branch selected.
4. Order moves to processing location.
5. Processing/batching occurs.
6. Order becomes ready.
7. Finished clothes move to return branch.
8. Customer is notified.
9. Customer receives all or part of the order.
10. Payment/balance is resolved according to policy.
11. Order completes only when completion conditions are satisfied.
12. Full history remains auditable.

## Already hardened

- [x] Transactional order creation.
- [x] Customer ownership validation.
- [x] Service ownership validation.
- [x] Pricing validation.
- [x] Derived payment status.
- [x] Pickup transaction.
- [x] Pickup row locking.
- [x] Duplicate pickup protection.
- [x] Over-pickup protection.
- [x] Partial pickup support.
- [x] Optimistic order update protection.
- [x] Cancellation idempotency.
- [x] Terminal status transition protection.
- [x] Payment recording protection on cancelled/completed orders.
- [x] Payment receipt-number collision/cast bug fixed.
- [x] Idempotency support including 204 responses.

## Still required

- [ ] Explicit branch/location lifecycle.
- [ ] Transfer/movement history.
- [ ] Payment correction/refund workflow.
- [ ] Block unsafe deletion of payments on terminal orders.
- [ ] Validate payment amount: positive, finite, valid decimal.
- [ ] Decide and enforce overpayment policy.
- [ ] Decide whether completed/cancelled orders permit non-financial edits.
- [ ] Audit every terminal-state mutation.
- [ ] Define cancellation/refund accounting.
- [ ] Test simultaneous order edits.
- [ ] Test simultaneous payment/pickup/cancellation attempts.
- [ ] Test duplicate network submissions.
- [ ] Test offline replay.

---

# 5. Orders, services, customers and workers

## Orders
- [ ] Create.
- [ ] Edit.
- [ ] Verify.
- [ ] Assign.
- [ ] Batch.
- [ ] Process.
- [ ] Ready.
- [ ] Move.
- [ ] Return.
- [ ] Partial pickup.
- [ ] Full pickup.
- [ ] Cancel.
- [ ] Correct/refund.
- [ ] Receipt.
- [ ] Audit history.

## Services
- [ ] Service catalog.
- [ ] Per-branch availability.
- [ ] Standard/express/premium pricing.
- [ ] Active/inactive lifecycle.
- [ ] Safe price changes.
- [ ] Historical order price preservation.
- [ ] Branch capability compatibility where required.

## Customers
- [ ] Customer creation.
- [ ] Search.
- [ ] Order history.
- [ ] Payment history.
- [ ] Balance.
- [ ] Notes.
- [ ] Tags/segments.
- [ ] Archived/inactive handling.
- [ ] Branch relationship rules.
- [ ] Customer communication history.

## Workers
- [ ] Worker creation.
- [ ] Branch assignment.
- [ ] Permission management.
- [ ] Immediate branch reassignment effect.
- [ ] Operational permissions.
- [ ] Worker audit trail.
- [ ] Safe deactivation.
- [ ] No cross-tenant assignment.
- [ ] Operation-specific branch authorization.

---

# 6. Batch processing

The product must support real laundry operations where many orders are processed together.

- [ ] Batch creation.
- [ ] Batch assignment.
- [ ] Batch status lifecycle.
- [ ] Processing branch scope.
- [ ] Cross-tenant protection.
- [ ] Concurrent batch protection.
- [ ] No cancelled/completed orders in new batches.
- [ ] Correct order movement when batch completes.
- [ ] Batch history.
- [ ] Worker permissions.
- [ ] Frontend batch queue.
- [ ] Offline-safe batch behavior.

---

# 7. Payments and billing

There are two different financial systems and both must be correct.

## Customer order payments
- [x] Manual payment recording.
- [x] Balance calculation.
- [x] Payment status calculation.
- [x] Receipt generation.
- [ ] Overpayment policy.
- [ ] Refund/correction workflow.
- [ ] Payment deletion restrictions.
- [ ] Payment audit trail.
- [ ] Duplicate payment protection.
- [ ] Provider reconciliation where applicable.

## CleanTrack subscription billing
- [ ] Pricing plans finalized.
- [ ] Trial rules finalized.
- [ ] Paystack checkout tested.
- [ ] Successful subscription activation.
- [ ] Failed payment handling.
- [ ] Renewal handling.
- [ ] Cancellation handling.
- [ ] Grace period.
- [ ] Subscription status UI.
- [ ] Owner billing page.
- [ ] Receipts/invoices.
- [ ] Webhook signature verification.
- [ ] Idempotent billing webhook processing.
- [ ] Entitlement enforcement.
- [ ] Upgrade/downgrade behavior.

---

# 8. WhatsApp/customer communication

CleanTrack should eventually make customer communication a product capability, not a collection of manual scripts.

## Foundation

- [ ] Meta App created/configured.
- [ ] WhatsApp Business setup.
- [ ] Embedded Signup.
- [ ] META_APP_ID.
- [ ] META_APP_SECRET.
- [ ] META_CONFIG_ID.
- [ ] WHATSAPP_WEBHOOK_VERIFY_TOKEN.
- [ ] WHATSAPP_APP_SECRET.
- [ ] Webhook verification.
- [ ] Signature verification.
- [ ] Tenant-specific WhatsApp connection.
- [ ] Token storage/security.
- [ ] Message provider abstraction.

## Customer workflows

- [ ] Order received.
- [ ] Order ready.
- [ ] Pickup reminder.
- [ ] Payment/balance reminder.
- [ ] Order delivered/completed.
- [ ] Failed message retry.
- [ ] Message history.
- [ ] Template management.
- [ ] Consent/opt-out handling.
- [ ] Delivery/read status.
- [ ] Human takeover/inbox.

## Location-based pickup

Customer shared location can be used as pickup information.

Required model:

Customer -> shares location -> CleanTrack receives location -> stores it against the pickup/collection request -> staff sees pickup location -> pickup is assigned/completed -> location event is audited.

Do not treat a WhatsApp location message as permanent customer address automatically. It should be an explicit pickup-location event with consent/context.

---

# 9. Customer service / support

CleanTrack needs a real way for paying users to get help.

## Minimum support system

- [ ] Public support email.
- [ ] In-app support entry point.
- [ ] Support/contact form.
- [ ] Customer email captured.
- [ ] Laundry/account ID captured automatically.
- [ ] Category selection:
  - account
  - billing
  - order problem
  - WhatsApp
  - technical problem
  - feature request
  - other
- [ ] Priority.
- [ ] Ticket/status tracking.
- [ ] Conversation history.
- [ ] Automated acknowledgement.
- [ ] Owner/admin support dashboard.
- [ ] SLA/response target.
- [ ] Knowledge base/FAQ.
- [ ] Incident communication process.

## Later

- [ ] WhatsApp support.
- [ ] AI support assistant.
- [ ] Screen/video troubleshooting.
- [ ] Customer health dashboard.
- [ ] Automated issue detection.

---

# 10. Landing page and acquisition system

CleanTrack needs a public marketing site separate from the authenticated application experience.

## Landing page goal

The page should quickly answer:

1. What is CleanTrack?
2. Who is it for?
3. What painful problem does it remove?
4. How does it work?
5. Why should a laundry owner care?
6. What does it cost?
7. What happens after clicking the CTA?

## Core positioning direction

Working hero direction:

**"Grow your laundry without losing control."**

Pain themes:

- Owner cannot see what is happening across the business.
- Owner does not know which clothes are ready.
- Debt/balance tracking is manual.
- Workers have to remember customer/order details.
- Repetitive customer messages consume time.
- Multiple branches become difficult to control.

## Required sections

- [ ] Hero + CTA.
- [ ] Product demonstration.
- [ ] Pain/problem section.
- [ ] How CleanTrack works.
- [ ] Core features.
- [ ] Multi-branch explanation.
- [ ] Customer communication.
- [ ] Payments/debt visibility.
- [ ] Analytics.
- [ ] Worker operations.
- [ ] Screenshots/video.
- [ ] Pricing.
- [ ] FAQ.
- [ ] Trust/security.
- [ ] Contact/support.
- [ ] Final CTA.
- [ ] SEO metadata.
- [ ] Open Graph/social previews.
- [ ] Analytics.
- [ ] Conversion tracking.
- [ ] Mobile optimization.
- [ ] Fast loading.
- [ ] Accessibility.

---

# 11. Signup and onboarding

The first 10 minutes matter.

## Target onboarding

1. Landing page.
2. Start trial.
3. Create account.
4. Verify email where appropriate.
5. Business profile.
6. Choose operating model.
7. Create first branch.
8. Select branch type.
9. Add services/prices.
10. Add workers.
11. Configure customer communication.
12. Create first order.
13. See first dashboard result.
14. Guided next actions.

## Required

- [ ] Clear setup checklist.
- [ ] Empty states.
- [ ] Helpful defaults.
- [ ] Validation.
- [ ] Error recovery.
- [ ] Trial progress.
- [ ] Activation events.
- [ ] Onboarding emails.
- [ ] Demo mode.
- [ ] Demo data separated from real data.

---

# 12. Auth, roles and permissions

- [ ] Owner role.
- [ ] Worker role.
- [ ] Permission matrix.
- [ ] Branch scope.
- [ ] Operation scope.
- [ ] Password security.
- [ ] Session/JWT security.
- [ ] Password reset.
- [ ] Email verification if required.
- [ ] Account lock/rate limiting.
- [ ] Worker deactivation.
- [ ] Audit log.
- [ ] No privilege escalation through request body/query parameters.

---

# 13. Frontend quality

Every major workflow must work on:

- [ ] Desktop.
- [ ] Mobile.
- [ ] Slow network.
- [ ] Temporary network loss.
- [ ] Refresh/reload.
- [ ] Back navigation.
- [ ] Duplicate clicks.
- [ ] Empty data.
- [ ] Error responses.
- [ ] Permission restrictions.

## React/React Query

- [ ] Query keys include branch/location context where required.
- [ ] Mutations invalidate the right queries.
- [ ] No stale dashboard after mutations.
- [ ] Buttons disable while submitting.
- [ ] Optimistic updates only where safe.
- [ ] 409 conflict UI is understandable.
- [ ] Offline queue is safe.
- [ ] Sync conflict UI exists where needed.

---

# 14. Offline/PWA

Laundry operations may continue when connectivity is poor.

- [ ] PWA installability.
- [ ] Local cache.
- [ ] Offline order view.
- [ ] Offline status updates.
- [ ] Offline pickup support where safe.
- [ ] Sync queue.
- [ ] Idempotency keys.
- [ ] Conflict detection.
- [ ] Conflict resolution.
- [ ] Sync status UI.
- [ ] Failed operation retry.
- [ ] No duplicate financial operations.

---

# 15. Notifications and automation

- [ ] Email.
- [ ] WhatsApp.
- [ ] SMS where commercially justified.
- [ ] In-app notifications.
- [ ] Message queue.
- [ ] Retry.
- [ ] Dead-letter/error handling.
- [ ] Provider failure isolation.
- [ ] Customer preferences.
- [ ] Template management.
- [ ] Automation rules.
- [ ] Delivery tracking.
- [ ] Notification audit history.

---

# 16. Analytics and owner command center

The dashboard must tell the owner what is happening and what needs attention.

## Operational

- [ ] Orders today.
- [ ] Pending.
- [ ] Processing.
- [ ] Ready.
- [ ] Partial pickups.
- [ ] Overdue.
- [ ] Branch workload.
- [ ] Worker workload.
- [ ] Batch workload.

## Financial

- [ ] Revenue.
- [ ] Collected.
- [ ] Outstanding.
- [ ] Expenses.
- [ ] Profit estimate.
- [ ] Subscription cost.
- [ ] Payment trends.

## Customer

- [ ] New customers.
- [ ] Repeat customers.
- [ ] Inactive customers.
- [ ] Outstanding balances.
- [ ] Communication activity.

## Multi-branch

Every metric must explicitly define which branch dimension it uses.

---

# 17. Reliability and observability

- [ ] Health endpoint.
- [ ] Database health.
- [ ] Structured logs.
- [ ] Request IDs.
- [ ] Error monitoring.
- [ ] Background-job monitoring.
- [ ] Queue monitoring.
- [ ] Notification failure monitoring.
- [ ] Backup monitoring.
- [ ] Alert engine.
- [ ] Deployment monitoring.
- [ ] Performance monitoring.
- [ ] Slow-query investigation.
- [ ] Production incident log.

---

# 18. Security and privacy

- [ ] Secret rotation.
- [ ] No credentials in logs.
- [ ] HTTPS.
- [ ] Secure cookies/session handling where applicable.
- [ ] Input validation.
- [ ] SQL/ORM safety.
- [ ] Rate limiting.
- [ ] CSRF review where applicable.
- [ ] XSS review.
- [ ] File upload validation.
- [ ] Webhook signature verification.
- [ ] Tenant isolation tests.
- [ ] Audit logging.
- [ ] Data deletion/export policy.
- [ ] Privacy policy.
- [ ] Terms of service.

---

# 19. Legal/business readiness

- [ ] Business identity.
- [ ] Pricing.
- [ ] Trial terms.
- [ ] Terms of Service.
- [ ] Privacy Policy.
- [ ] Refund policy.
- [ ] Subscription cancellation policy.
- [ ] Contact information.
- [ ] Support policy.
- [ ] Data retention policy.
- [ ] Customer data handling rules.

---

# 20. Marketing and distribution

The product is not finished when the software works.

## Organic

- [ ] TikTok.
- [ ] Instagram.
- [ ] Facebook.
- [ ] Short product demonstrations.
- [ ] Laundry-owner education.
- [ ] Pain-point videos.
- [ ] Before/after workflows.
- [ ] Customer stories.
- [ ] Founder/build-in-public content where useful.

## Paid

- [ ] Meta ads.
- [ ] Conversion tracking.
- [ ] Landing-page experiments.
- [ ] Lead capture.
- [ ] Demo booking.
- [ ] Retargeting.

## Sales

- [ ] Prospect list.
- [ ] Outreach script.
- [ ] Demo script.
- [ ] Trial follow-up.
- [ ] Onboarding call.
- [ ] Activation tracking.
- [ ] Churn interview.

---

# 21. Customer success

Track the customer journey:

Visitor -> signup -> activated -> first order -> repeated orders -> paid -> retained.

Required metrics:

- [ ] Signup conversion.
- [ ] Activation rate.
- [ ] Time to first order.
- [ ] Trial-to-paid.
- [ ] Weekly active laundries.
- [ ] Orders per laundry.
- [ ] Branch adoption.
- [ ] Worker adoption.
- [ ] WhatsApp adoption.
- [ ] Churn.
- [ ] Support volume.
- [ ] Common failure points.

---

# 22. Testing / release certification

## Automated

- [ ] Unit tests.
- [ ] Integration tests.
- [ ] API tests.
- [ ] Permission tests.
- [ ] Tenant-isolation tests.
- [ ] Payment tests.
- [ ] Order lifecycle tests.
- [ ] Branch-location tests.
- [ ] Notification tests.
- [ ] Subscription tests.
- [ ] Webhook tests.

## Manual production certification

Run real workflows:

### Account
- [ ] Signup.
- [ ] Login.
- [ ] Logout.
- [ ] Password recovery.

### Business setup
- [ ] Branch creation.
- [ ] Branch type.
- [ ] Worker.
- [ ] Service.
- [ ] Pricing.

### Order
- [ ] Create.
- [ ] Assign.
- [ ] Process.
- [ ] Batch.
- [ ] Ready.
- [ ] Transfer.
- [ ] Return.
- [ ] Partial pickup.
- [ ] Full pickup.
- [ ] Payment.
- [ ] Receipt.
- [ ] Completion.
- [ ] Cancellation.

### Failure tests
- [ ] Double-click.
- [ ] Double payment.
- [ ] Double pickup.
- [ ] Two workers edit same order.
- [ ] Worker changes branch.
- [ ] Invalid branch.
- [ ] Wrong laundry ID.
- [ ] Network interruption.
- [ ] Expired session.
- [ ] Failed WhatsApp send.
- [ ] Failed email.
- [ ] Failed subscription payment.

---

# 23. Launch readiness

CleanTrack is launch-ready only when all of these are true:

- [ ] Production database is migrated and verified.
- [ ] No known critical tenant-isolation bug.
- [ ] Order lifecycle passes certification.
- [ ] Branch architecture passes certification.
- [ ] Payments pass certification.
- [ ] Subscription billing passes certification.
- [ ] Backup restore passes certification.
- [ ] Customer support works.
- [ ] Landing page converts visitors into signups/trials.
- [ ] Signup/onboarding works.
- [ ] Mobile workflow works.
- [ ] Monitoring works.
- [ ] Error alerts work.
- [ ] Terms/privacy/support pages exist.
- [ ] Pricing is public and accurate.
- [ ] First real customer can be onboarded without developer intervention.
- [ ] A second real customer can use the system independently.
- [ ] We can diagnose and recover a production incident.
- [ ] We can deploy a change and roll back safely.

---

# 24. Post-launch

After the first real users:

- [ ] Interview users.
- [ ] Track activation.
- [ ] Track support tickets.
- [ ] Track churn.
- [ ] Identify repeated operational pain.
- [ ] Improve onboarding.
- [ ] Improve branch workflows.
- [ ] Improve WhatsApp.
- [ ] Improve reporting.
- [ ] Add integrations based on evidence.
- [ ] Build sales/distribution engine.
- [ ] Expand to more laundry businesses.
- [ ] Expand multi-branch capabilities.
- [ ] Expand African-market localization.

---

# Current execution board

## Phase 0 — Production foundation
STATUS: Mostly complete; hardening remains.

## Phase 1 — Order lifecycle hardening
STATUS: Major safety work complete; financial correction/refund and terminal mutation review remain.

## Phase 2.1 — Explicit order locations
STATUS: COMPLETE at database layer.
Production verification:
- 1,008 orders inspected.
- 1,007 fully backfilled.
- 0 mismatches.
- 0 cross-tenant location assignments.
- 1 unassigned legacy order requires investigation.

## Phase 2.2 — Branch-aware order workflow
STATUS: AUDIT IN PROGRESS / route migration not yet complete.

Next sequence:
1. Investigate the one unassigned production order.
2. Replace order branch authorization with operation-specific authorization.
3. Update batches.
4. Add movement/history.
5. Update analytics/search/receipts/notifications.
6. Update frontend.
7. Certify branch scenarios.
8. Deprecate legacy order.branchId only after certification.

## Phase 3 — Complete order/customer/worker operations
STATUS: Pending Phase 2.2.

## Phase 4 — Payments + subscription billing
STATUS: Customer payment core working; subscription production certification remains.

## Phase 5 — WhatsApp
STATUS: Architecture exists; Meta production credentials/configuration remain.

## Phase 6 — Customer service
STATUS: Build required.

## Phase 7 — Landing page + marketing website
STATUS: Build/refinement required.

## Phase 8 — Onboarding + activation
STATUS: Build/refinement required.

## Phase 9 — Reliability/security/privacy
STATUS: Ongoing.

## Phase 10 — Launch certification
STATUS: Pending.

## Phase 11 — Distribution + first 100 laundries
STATUS: Post-production launch phase.

---

# Definition of "CleanTrack is real"

We will call CleanTrack a real SaaS when:

1. A stranger can find it online.
2. They understand the product without talking to us.
3. They can sign up.
4. They can start a trial.
5. They can configure their laundry.
6. They can create branches with the correct operational types.
7. They can create workers and permissions.
8. They can configure services and prices.
9. They can create and process real orders.
10. Orders can move correctly between collection, processing and return locations.
11. Workers can only perform operations they are authorized to perform.
12. Payments and balances remain correct.
13. Customers can be notified reliably.
14. WhatsApp works when configured.
15. Owners can see useful operational and financial information.
16. Subscription billing works.
17. Support works.
18. Backups can actually be restored.
19. Errors are observable.
20. Data belonging to one laundry cannot leak to another.
21. The product survives duplicate requests, concurrent actions and poor networks.
22. We can deploy updates without breaking existing customers.
23. A real laundry can use it without us standing beside them.
24. We can acquire another laundry and repeat the process.

That is the finish line.
