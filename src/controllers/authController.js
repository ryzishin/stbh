// src/controllers/authController.js
// UID + bcrypt login (no Mongo Auth, no role-portal selection).
// The system auto-detects the role from the profile document.
//
// UID = any unique identifier the student/admin chose at account creation.
// For students this is typically their 12-digit LRN. For admins/sub-admins it
// can be a username, email, or LRN. The login form accepts any non-empty string.
// UID lookup is case-insensitive.

import bcrypt from "bcryptjs";
import { col } from "../config/mongo.js";
import { cipher, isValidLRN } from "../config/cipher.js";
import { logActivity, bumpStreak } from "../services/leaderboard.js";
import { notifyUser } from "../services/notifications.js";
import { maybeResetWeeklyPoints } from "../services/settings.js";

export async function showLogin(req, res) {
  // If already logged in, jump straight to the dashboard — no point re-showing /login.
  if (req.user) {
    const dest = req.user.role === "admin" ? "/admin"
      : req.user.role === "subadmin" ? "/subadmin/notes"
      : "/today";
    return res.redirect(dest);
  }
  const flash = req.session?.flash;
  if (req.session?.flash) req.session.flash = null;
  res.render("login", {
    title: "Sign in",
    error: req.query.error || flash?.error,
    mustChangePassword: req.query.mustChangePassword === "1",
  });
}

export async function login(req, res) {
  const { uid, password, mode } = req.body;
  if (!uid || !password) {
    return res.render("login", { title: "Sign in", error: "Identifier and password are required." });
  }

  const identifier = String(uid).trim();

  // Case-insensitive lookup. If mode === "username", look up by username;
  // otherwise (default UID/LRN mode), try uid first, then fall back to username
  // so that an LRN typed into the wrong tab still resolves.
  const profilesC = await col("profiles");
  const filter = mode === "username"
    ? { username: identifier }
    : { $or: [ { uid: identifier }, { username: identifier } ] };
  const profile = await profilesC.findOne(
    filter,
    { collation: { locale: "en", strength: 2 } }
  );

  // Generic error message — do NOT reveal whether the identifier exists (anti-enumeration).
  const INVALID = "Incorrect identifier or password.";

  if (!profile) {
    return res.render("login", { title: "Sign in", error: INVALID });
  }

  const match = await bcrypt.compare(password, profile.password_hash);
  if (!match) {
    return res.render("login", { title: "Sign in", error: INVALID });
  }

  // Success — set session
  req.session.userId = profile._id.toString();

  // Lazy weekly leaderboard reset — fires on the first login of each new Manila-week.
  // Cheap (one settings read + maybe one updateMany), idempotent, safe under concurrency.
  try { await maybeResetWeeklyPoints(); } catch (err) { console.warn("[login] weekly reset check failed:", err.message); }

  // If the dev just reset this password, force the user to change it before going further
  if (profile.must_change_password) {
    return res.redirect("/profile?mustChangePassword=1");
  }

  // Bump the user's daily streak.
  const streak = await bumpStreak(profile._id.toString());
  if (streak.newStreak >= 3) {
    const milestones = { 3: "3-day streak!", 7: "1-week streak!", 14: "2-week streak!", 30: "30-day streak!", 60: "60-day streak!", 100: "100-day streak!" };
    const msg = milestones[streak.newStreak];
    if (msg) {
      await notifyUser(profile._id.toString(), "streak_reminder", msg,
        `You're on a ${streak.newStreak}-day streak. Keep it up!`, null).catch(() => {});
    }
  }

  await logActivity(profile._id.toString(), profile.name, "login", "Signed in");

  // Auto-route by role — no portal selection by the user
  const dest = profile.role === "admin" ? "/admin" : profile.role === "subadmin" ? "/subadmin/notes" : "/today";
  res.redirect(dest);
}

export async function logout(req, res) {
  if (req.user) {
    await logActivity(req.user._id.toString(), req.user.name, "logout", "Signed out");
  }
  req.session.destroy(() => {
    res.redirect("/login");
  });
}

// Exported for scripts that want to re-use the UID lookup helper.
export async function findUserByUid(uid) {
  if (!uid) return null;
  const profilesC = await col("profiles");
  const profile = await profilesC.findOne(
    { uid: String(uid).trim() },
    { collation: { locale: "en", strength: 2 } }
  );
  return profile || null;
}
export { cipher, isValidLRN };
