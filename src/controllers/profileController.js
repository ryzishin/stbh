// src/controllers/profileController.js
import bcrypt from "bcryptjs";
import { ObjectId } from "mongodb";
import { col } from "../config/mongo.js";
import { listAttemptsForUser } from "../services/quizzes.js";
import { saveUpload, deleteUpload } from "../services/uploads.js";

function toOid(id) {
  if (!id) return null;
  if (id instanceof ObjectId) return id;
  try { return new ObjectId(String(id)); } catch { return null; }
}

// Strip sensitive fields before sending the profile to the client.
// password_hash, email (unused), must_change_password — none belong in the browser.
function sanitizeProfile(p) {
  if (!p) return null;
  const { password_hash, email, must_change_password, ...safe } = p;
  return safe;
}

// Normalize a URL the user pasted for a social profile.
// Accepts:
//  - "" (empty — clears the field)
//  - "username" or "user.name" (we'll prefix with the platform's base URL)
//  - a full URL (we'll use it as-is)
// Returns "" if the value is empty/invalid.
function normalizeSocial(value, baseUrl) {
  if (!value) return "";
  let v = String(value).trim();
  if (!v) return "";
  // Already a full URL
  if (/^https?:\/\//i.test(v)) return v;
  // Strip leading @ or platform prefix
  v = v.replace(/^@+/, "");
  // No dots / no path → treat as username
  if (!/\//.test(v) && !/\s/.test(v)) {
    if (!baseUrl) return v; // website case — leave as user typed
    const sep = baseUrl.endsWith("/") ? "" : "/";
    return `${baseUrl}${sep}${encodeURIComponent(v)}`;
  }
  return v;
}

// Allowed social keys.
const SOCIAL_KEYS = ["facebook", "instagram", "tiktok"];
const SOCIAL_BASES = {
  facebook: "https://facebook.com/",
  instagram: "https://instagram.com/",
  tiktok: "https://tiktok.com/@",
};

export async function show(req, res) {
  try {
    const attempts = await listAttemptsForUser(req.user._id.toString());
    res.render("profile", {
      title: "Profile",
      attempts,
      classmatesCount: 0,
      mustChangePassword: req.query.mustChangePassword === "1",
    });
  } catch (err) {
    console.error("[profile show]", err);
    res.status(500).render("error/500", { message: err.message });
  }
}

// Public profile view — anyone authenticated can view any user's profile
// by visiting /u/:username. Shows stats (points, streak, etc.) + bio + socials.
// PII like password_hash, email, must_change_password, attempts list are NOT exposed.
export async function showPublic(req, res) {
  try {
    const username = decodeURIComponent(req.params.username || "").trim();
    if (!username) return res.status(404).render("error/404", { user: req.user });

    const profilesC = await col("profiles");
    const profile = await profilesC.findOne(
      { username },
      { collation: { locale: "en", strength: 2 } }
    );
    if (!profile) return res.status(404).render("error/404", { user: req.user });

    // Don't expose password_hash / email / must_change_password.
    const safe = sanitizeProfile(profile);

    // Recent attempts — limited to 5, no quiz correct-answer exposure (only title+score+date)
    const attempts = await listAttemptsForUser(profile._id.toString());
    const recentAttempts = attempts.slice(0, 5).map(a => ({
      title: a.quizzes ? a.quizzes.title : "Quiz",
      score: a.score,
      total: a.total,
      taken_at: a.taken_at,
    }));

    res.render("profile-public", {
      title: `${profile.username || profile.name}`,
      profile: safe,
      recentAttempts,
      isOwner: req.user && req.user._id.toString() === profile._id.toString(),
    });
  } catch (err) {
    console.error("[profile public]", err);
    res.status(500).render("error/500", { message: err.message });
  }
}

// Validate that a username is unique (case-insensitive) across all profiles,
// excluding the current user.
async function assertUsernameAvailable(username, currentUserId) {
  if (!username || username.length < 3) {
    throw new Error("Username must be at least 3 characters.");
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
    throw new Error("Username can only contain letters, numbers, dots, underscores, and dashes.");
  }
  const profilesC = await col("profiles");
  const existing = await profilesC.findOne(
    { username, _id: { $ne: toOid(currentUserId) } },
    { collation: { locale: "en", strength: 2 } }
  );
  if (existing) {
    throw new Error("That username is taken.");
  }
}

export async function update(req, res) {
  try {
    const { name, username, bio, socials } = req.body;
    const patch = {};
    if (name !== undefined) patch.name = String(name).trim().slice(0, 64) || req.user.name;

    // Bio: optional, 101 char limit. Empty string allowed (clears the bio).
    if (bio !== undefined) {
      const bioStr = String(bio).slice(0, 101);
      patch.bio = bioStr;
    }

    // Socials: object {facebook, instagram, tiktok}. Each value is normalized.
    if (socials !== undefined) {
      // When sent via multipart (FormData), socials may arrive as a JSON string.
      let parsed = socials;
      if (typeof socials === "string") {
        try { parsed = JSON.parse(socials); } catch { parsed = {}; }
      }
      if (parsed && typeof parsed === "object") {
        const clean = {};
        for (const k of SOCIAL_KEYS) {
          const v = parsed[k] != null ? String(parsed[k]).trim() : "";
          clean[k] = v ? normalizeSocial(v, SOCIAL_BASES[k]) : "";
        }
        patch.socials = clean;
      }
    }

    // Username change requires uniqueness check.
    if (username !== undefined) {
      const newUsername = String(username).trim();
      // Only validate + write if it actually changed.
      if (newUsername.toLowerCase() !== (req.user.username || "").toLowerCase()) {
        try {
          await assertUsernameAvailable(newUsername, req.user._id.toString());
        } catch (err) {
          return res.status(400).json({ ok: false, error: err.message });
        }
        patch.username = newUsername;
      }
    }

    if (req.file) {
      // Save the new avatar to MongoDB and update avatar_url.
      const newUrl = await saveUpload(req.file, req.user._id.toString());
      patch.avatar_url = newUrl;
      // Best-effort cleanup of the old avatar (so we don't leak storage).
      const oldUrl = req.user.avatar_url;
      if (oldUrl && oldUrl.startsWith("/uploads/")) {
        const oldId = oldUrl.slice("/uploads/".length);
        await deleteUpload(oldId);
      }
    }

    const profilesC = await col("profiles");
    const updated = await profilesC.findOneAndUpdate(
      { _id: req.user._id },
      { $set: patch },
      { returnDocument: "after" }
    );
    res.json({ ok: true, profile: sanitizeProfile(updated) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

// ===== Password change =====
// POST /api/profile/password  body: { currentPassword, newPassword }
export async function changePassword(req, res) {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ ok: false, error: "Both current and new passwords are required." });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ ok: false, error: "New password must be at least 6 characters." });
    }

    const match = await bcrypt.compare(currentPassword, req.user.password_hash);
    if (!match) {
      return res.status(401).json({ ok: false, error: "Current password is incorrect." });
    }

    const newHash = await bcrypt.hash(newPassword, 12);
    const profilesC = await col("profiles");
    await profilesC.updateOne(
      { _id: req.user._id },
      { $set: { password_hash: newHash, must_change_password: false } }
    );

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}
