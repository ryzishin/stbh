// src/services/bootstrap.js
// On boot, if there are zero admins in the DB and ADMIN_UID + ADMIN_PASSWORD
// are both set in env, auto-create the first admin. Idempotent — safe to call
// on every boot.
import bcrypt from "bcryptjs";
import { col } from "../config/mongo.js";
import { config } from "../config/env.js";

export async function bootstrapAdminIfEmpty() {
  const uid = config.bootstrapAdminUid?.trim();
  const password = config.bootstrapAdminPassword?.trim();
  if (!uid || !password) {
    // Nothing to bootstrap. Tell the operator if no admins exist.
    const profilesC = await col("profiles");
    const adminCount = await profilesC.countDocuments({ role: "admin" });
    if (adminCount === 0) {
      console.warn("[bootstrap] DB has zero admins. Set ADMIN_UID + ADMIN_PASSWORD env vars to auto-create one on boot, or run `node scripts/create-accounts.js scripts/accounts.csv`.");
    }
    return;
  }
  const profilesC = await col("profiles");
  const adminCount = await profilesC.countDocuments({ role: "admin" });
  if (adminCount > 0) {
    return; // admin exists; nothing to do
  }
  // Create the bootstrap admin.
  const hash = await bcrypt.hash(password, 12);
  const username = config.bootstrapAdminUsername?.trim() || "admin";
  const name = config.bootstrapAdminName?.trim() || "Administrator";
  await profilesC.insertOne({
    uid,
    username,
    name,
    email: null,
    role: "admin",
    avatar_color: 152,
    avatar_url: null,
    password_hash: hash,
    must_change_password: false,
    points: 0,
    weekly_points: 0,
    streak_days: 0,
    last_active_date: new Date().toISOString().slice(0, 10),
    practice_quizzes_taken: 0,
    flashcards_reviewed: 0,
    created_at: new Date(),
  });
  console.log(`[bootstrap] Created first admin: UID=${uid}  username=${username}`);
}
