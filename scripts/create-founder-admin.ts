/**
 * Founder Admin Setup Script
 *
 * Creates the real founder admin account and deactivates the generic seed account.
 * Run once after initial deployment.
 *
 * Usage:
 *   FOUNDER_EMAIL="you@yourdomain.com" FOUNDER_NAME="Your Name" FOUNDER_PASSWORD="YourPass123!" \
 *     npx tsx scripts/create-founder-admin.ts
 *
 * Or use the defaults defined below for a quick start (change the password immediately after).
 */

import { db } from "../lib/db/src/index.js";
import { platformAdmins } from "../lib/db/src/schema/index.js";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

const GENERIC_SEED_EMAIL = "admin@cleantrack.internal";

const FOUNDER_EMAIL    = process.env.FOUNDER_EMAIL    ?? "";
const FOUNDER_NAME     = process.env.FOUNDER_NAME     ?? "";
const FOUNDER_PASSWORD = process.env.FOUNDER_PASSWORD ?? "";

async function main() {
  if (!FOUNDER_EMAIL || !FOUNDER_NAME || !FOUNDER_PASSWORD) {
    console.error(`
╔══════════════════════════════════════════════════════════╗
║  ERROR: Missing required environment variables           ║
╚══════════════════════════════════════════════════════════╝

Set these before running:

  FOUNDER_EMAIL="you@yourdomain.com"
  FOUNDER_NAME="Your Full Name"
  FOUNDER_PASSWORD="StrongPass123!"

Then run:
  FOUNDER_EMAIL="..." FOUNDER_NAME="..." FOUNDER_PASSWORD="..." npx tsx scripts/create-founder-admin.ts
`);
    process.exit(1);
  }

  if (FOUNDER_PASSWORD.length < 12) {
    console.error("❌ FOUNDER_PASSWORD must be at least 12 characters.");
    process.exit(1);
  }

  console.log("🔐 Setting up founder admin account...\n");

  // Check if founder account already exists
  const [existing] = await db.select().from(platformAdmins)
    .where(eq(platformAdmins.email, FOUNDER_EMAIL.toLowerCase()));

  if (existing) {
    console.log(`✓ Founder admin already exists: ${FOUNDER_EMAIL}`);
    console.log("  If you need to reset the password, use the admin dashboard or update directly via DB.");
    process.exit(0);
  }

  const passwordHash = await bcrypt.hash(FOUNDER_PASSWORD, 12);

  const [founder] = await db.insert(platformAdmins).values({
    name:         FOUNDER_NAME,
    email:        FOUNDER_EMAIL.toLowerCase(),
    passwordHash,
    role:         "super_admin",
    isActive:     true,
  }).returning();

  console.log(`✅ Founder admin created:`);
  console.log(`   Name  : ${founder.name}`);
  console.log(`   Email : ${founder.email}`);
  console.log(`   Role  : ${founder.role}`);
  console.log(`   ID    : ${founder.id}`);

  // Deactivate the generic seed account if it still exists
  const [seedAccount] = await db.select().from(platformAdmins)
    .where(eq(platformAdmins.email, GENERIC_SEED_EMAIL));

  if (seedAccount && seedAccount.isActive) {
    await db.update(platformAdmins)
      .set({ isActive: false })
      .where(eq(platformAdmins.email, GENERIC_SEED_EMAIL));
    console.log(`\n🔒 Generic seed account deactivated: ${GENERIC_SEED_EMAIL}`);
  }

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Admin Portal URL : /admin/login
  Login Email      : ${founder.email}
  Password         : (as provided)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

  process.exit(0);
}

main().catch((err) => {
  console.error("Failed to create founder admin:", err);
  process.exit(1);
});
