// scripts/promote.js — promote or demote a user (UID → role).
//
// Usage:
//   node scripts/promote.js ms.roa admin            # make this UID the admin (adviser)
//   node scripts/promote.js 123456789012 subadmin   # promote a trusted student to sub-admin
//   node scripts/promote.js 123456789013 student    # demote back to student

import { getDb, col } from "../src/config/mongo.js";

const [uid, role] = process.argv.slice(2);
if (!uid || !role) {
  console.error("Usage: node scripts/promote.js <UID> <student|subadmin|admin>");
  process.exit(1);
}
if (!["student", "subadmin", "admin"].includes(role)) {
  console.error("Role must be one of: student, subadmin, admin");
  process.exit(1);
}

async function main() {
  await getDb();
  const profilesC = await col("profiles");
  const profile = await profilesC.findOne(
    { uid: String(uid).trim() },
    { collation: { locale: "en", strength: 2 } }
  );
  if (!profile) {
    console.error(`✗ No account found for UID "${uid}".`);
    process.exit(1);
  }
  await profilesC.updateOne({ _id: profile._id }, { $set: { role } });
  console.log(`✓ ${profile.name} (UID ${profile.uid}) is now ${role}.`);
  process.exit(0);
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
