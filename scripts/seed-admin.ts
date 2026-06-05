import { db } from "../lib/db/src/index.js";
import { platformAdmins } from "../lib/db/src/schema/index.js";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

const ADMIN_EMAIL = "admin@cleantrack.internal";
const ADMIN_PASSWORD = "Admin@CleanTrack1";
const ADMIN_NAME = "CleanTrack Platform Admin";

async function seedAdmin() {
  console.log("🔐 Seeding default platform admin...");

  const [existing] = await db.select().from(platformAdmins)
    .where(eq(platformAdmins.email, ADMIN_EMAIL));

  if (existing) {
    console.log(`✓ Admin already exists: ${ADMIN_EMAIL}`);
    process.exit(0);
  }

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  const [admin] = await db.insert(platformAdmins).values({
    name: ADMIN_NAME,
    email: ADMIN_EMAIL,
    passwordHash,
    isActive: true,
  }).returning();

  console.log(`✅ Admin created:`);
  console.log(`   Email    : ${admin.email}`);
  console.log(`   Password : ${ADMIN_PASSWORD}`);
  console.log(`   ID       : ${admin.id}`);
  process.exit(0);
}

seedAdmin().catch((err) => {
  console.error("Failed to seed admin:", err);
  process.exit(1);
});
