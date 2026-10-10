// scripts/reset-password.js — dev tool to reset a user's forgotten password.
//
// Resets the password back to the cipher(UID) default IF the UID is a 12-digit LRN.
// If the UID is something else (e.g. an admin's "ms.roa"), a random 8-character
// password is generated and `must_change_password` is set to true.
//
// Usage:
//   node scripts/reset-password.js 123456789012
//   node scripts/reset-password.js ms.roa
//   node scripts/reset-password.js 123456789012 123456789013

import bcrypt from "bcryptjs";
import { getDb, col } from "../src/config/mongo.js";
import { cipher, isValidLRN } from "../src/config/cipher.js";

function randomPassword(len = 8) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: node scripts/reset-password.js <UID> [more UIDs...]");
  process.exit(1);
}

async function main() {
  await getDb();
  const profilesC = await col("profiles");
  for (const uid of args) {
    const profile = await profilesC.findOne(
      { uid: String(uid).trim() },
      { collation: { locale: "en", strength: 2 } }
    );
    if (!profile) {
      console.error(`✗ No account found for UID "${uid}".`);
      continue;
    }
    const isLrn = isValidLRN(profile.uid);
    const plaintext = isLrn ? cipher(profile.uid) : randomPassword(8);
    const newHash = await bcrypt.hash(plaintext, 12);
    await profilesC.updateOne(
      { _id: profile._id },
      { $set: { password_hash: newHash, must_change_password: true } }
    );
    console.log(`✓ Reset password for ${profile.name} (UID ${profile.uid}).`);
    console.log(`  Temporary password: ${plaintext}`);
    console.log(`  The user will be forced to change it on next login.\n`);
  }
  process.exit(0);
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
