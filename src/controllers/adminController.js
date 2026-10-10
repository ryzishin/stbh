// src/controllers/adminController.js
import { ObjectId } from "mongodb";
import bcrypt from "bcryptjs";
import { col } from "../config/mongo.js";
import { getLeaderboard, getRecentActivity } from "../services/leaderboard.js";
import {
  listQuizzes, getQuiz, startLiveSession, endLiveSession,
  getActiveLiveSession, advanceLiveItem,
} from "../services/quizzes.js";
import { getSettings, updateAntiCheat, updatePointsConfig } from "../services/settings.js";
import { notifyRole } from "../services/notifications.js";
import { cipher, isValidLRN } from "../config/cipher.js";

function toOid(id) {
  if (!id) return null;
  if (id instanceof ObjectId) return id;
  try { return new ObjectId(String(id)); } catch { return null; }
}

// Derive a default username from a name: lowercase, ASCII-only, separators → dots.
function deriveUsername(name) {
  const base = String(name || "").toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 20);
  return base || "user";
}

function randomPassword(len = 8) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

// Parse CSV text into rows of { uid, username, name, role }.
// Accepts both 4-col (uid,user,name,role) and 3-col legacy (uid,name,role) formats.
function parseAccountsCsv(text) {
  const lines = String(text || "").trim().split(/\r?\n/);
  if (lines.length === 0) return [];
  const first = lines[0].toLowerCase();
  const hasHeader = (first.includes("uid") || first.includes("lrn") || first.includes("user")) && (first.includes("name") || first.includes("role"));
  const rows = hasHeader ? lines.slice(1) : lines;
  return rows
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const cells = line.split(",").map((s) => (s || "").trim());
      if (cells.length === 4) {
        return { uid: cells[0], username: cells[1], name: cells[2], role: cells[3] };
      } else if (cells.length === 3) {
        const uid = cells[0];
        const name = cells[1];
        const role = cells[2];
        return { uid, username: deriveUsername(name), name, role };
      }
      return { uid: cells[0], username: deriveUsername(cells[1] || cells[0]), name: cells[1] || "", role: cells[2] || "student" };
    });
}

export async function dashboard(req, res) {
  try {
    const profilesC = await col("profiles");
    const quizzesC = await col("quizzes");
    const fcC = await col("flashcards");
    const [studentCount, quizCount, cardCount, students] = await Promise.all([
      profilesC.countDocuments({ role: { $ne: "admin" } }),
      quizzesC.estimatedDocumentCount(),
      fcC.estimatedDocumentCount(),
      profilesC.find(
        { role: { $ne: "admin" } },
        { projection: { password_hash: 0, email: 0, must_change_password: 0 } }
      ).sort({ name: 1 }).toArray(),
    ]);
    const activeSession = await getActiveLiveSession();
    const activity = await getRecentActivity(20);
    res.render("admin/dashboard", { title: "Admin Dashboard", studentCount, quizCount, cardCount, activeSession, activity, students });
  } catch (err) {
    console.error("[admin dashboard]", err);
    res.status(500).render("error/500", { message: err.message });
  }
}

// ===== Accounts panel — full account management UI =====
// Lists all accounts (admins + students + sub-admins). Lets the admin:
//   - Import new accounts from a CSV file (deduped against existing UIDs + usernames)
//   - Reset any user's password to the default (cipher(UID) for LRN users, random for others)
//   - Add a single account inline
//   - Remove an account (with confirm — cascade-deletes their attempts/reactions/uploads)
export async function accounts(req, res) {
  try {
    const profilesC = await col("profiles");
    const accounts = await profilesC.find({}, { projection: { password_hash: 0, email: 0 } })
      .sort({ role: 1, name: 1 }).toArray();
    res.render("admin/accounts", { title: "Accounts", accounts });
  } catch (err) {
    console.error("[admin accounts]", err);
    res.status(500).render("error/500", { message: err.message });
  }
}

// GET /admin/accounts/print-slips — print-optimized page of password slips.
// Query params: ids=<comma-separated user IDs> OR session=<key> to recall the
// last-imported batch from the session. Renders one slip per account, with
// @media print CSS so they cut into strips cleanly.
export async function printSlips(req, res) {
  try {
    const profilesC = await col("profiles");
    let slips = [];
    const ids = (req.query.ids || "").split(",").map(s => s.trim()).filter(Boolean);
    if (ids.length > 0) {
      const users = await profilesC.find({ _id: { $in: ids.map(toOid) } }).toArray();
      // For LRN users, the initial password is the cipher of their UID. For
      // non-LRN users, we can't recover the random password after the fact —
      // the admin would need to reset it to get a new temp. So for slips, we
      // display "LRN cipher" for LRN users and "(reset to generate)" for others.
      slips = users.map(u => ({
        uid: u.uid,
        name: u.name || u.username,
        username: u.username,
        role: u.role,
        isLrn: isValidLRN(u.uid),
        password: isValidLRN(u.uid) ? cipher(u.uid) : '(reset to generate)',
      }));
    }
    res.render("admin/print-slips", { title: "Print Password Slips", slips });
  } catch (err) {
    console.error("[admin printSlips]", err);
    res.status(500).render("error/500", { message: err.message });
  }
}

// GET /admin/student/:id — admin per-student detail page.
// Shows: SRS state (due / learned / mastery %), last 7 days of activity,
// weakest items (per-item breakdown aggregated across all attempts) + weakest
// quizzes (lowest-score attempts), live-test warnings history.
export async function studentDetail(req, res) {
  try {
    const userId = toOid(req.params.id);
    if (!userId) return res.status(400).render("error/404");
    const profilesC = await col("profiles");
    const profile = await profilesC.findOne({ _id: userId }, { projection: { password_hash: 0, email: 0 } });
    if (!profile) return res.status(404).render("error/404");
    profile.id = profile._id.toString();

    // SRS summary — uses the flashcards service.
    const { getSrsSummary } = await import("../services/flashcards.js");
    const srs = await getSrsSummary(profile.id);

    // Last 7 days of activity from the activity_feed collection.
    const feedC = await col("activity_feed");
    const since = new Date(Date.now() - 7 * 86400000);
    const activities = await feedC.find({ user_id: userId, created_at: { $gte: since } })
      .sort({ created_at: -1 }).limit(80).toArray();

    // Weakest ITEMS — aggregated from quiz_attempts.item_answers across all attempts.
    // Requires the new per-item breakdown stored on each attempt.
    const { getWeakestItemsForUser, listAttemptsForUser } = await import("../services/quizzes.js");
    const weakestItems = await getWeakestItemsForUser(profile.id, 10);

    // Weakest QUIZZES — the attempts with the lowest score ratio (still useful
    // even with per-item data, as a high-level summary).
    const attempts = await listAttemptsForUser(profile.id);
    const weakAttempts = attempts
      .filter(a => a.total > 0)
      .map(a => ({ ...a, ratio: (a.score || 0) / a.total }))
      .sort((a, b) => a.ratio - b.ratio)
      .slice(0, 5);
    const weakQuizzes = weakAttempts.map(a => ({
      quiz_id: a.quiz_id?.toString?.() || null,
      quiz_title: a.quizzes?.title || "Quiz",
      score: a.score,
      total: a.total,
      ratio: Math.round(a.ratio * 100),
      taken_at: a.taken_at,
    }));

    // Live-test warnings — pull from live_participants.
    const partsC = await col("live_participants");
    const liveC = await col("live_sessions");
    const liveParts = await partsC.find({ user_id: userId, warnings: { $gt: 0 } }).sort({ last_activity: -1 }).limit(20).toArray();
    const warnings = [];
    for (const p of liveParts) {
      const s = await liveC.findOne({ _id: p.session_id });
      warnings.push({
        session_id: p.session_id?.toString?.() || null,
        warnings: p.warnings || 0,
        status: p.status,
        last_activity: p.last_activity,
        session_label: s ? `Session ${s._id.toString().slice(-6)}` : 'Session',
      });
    }

    res.render("admin/student", {
      title: profile.username || profile.name,
      profile,
      srs,
      activities: activities.map(a => ({ ...a, id: a._id.toString() })),
      weakestItems,
      weakQuizzes,
      warnings,
    });
  } catch (err) {
    console.error("[admin studentDetail]", err);
    res.status(500).render("error/500", { message: err.message });
  }
}

// POST /api/admin/accounts/import — accepts multipart (file=CSV) OR JSON (csv=string)
// Returns { ok, created, skipped, errors }.
export async function importAccounts(req, res) {
  try {
    let csvText = "";
    // From multipart upload
    if (req.file) {
      csvText = req.file.buffer.toString("utf8");
    } else if (req.body && req.body.csv) {
      csvText = String(req.body.csv);
    } else if (req.body && req.body.text) {
      csvText = String(req.body.text);
    } else {
      return res.status(400).json({ ok: false, error: "No CSV data received. Upload a file or paste CSV text." });
    }

    const rows = parseAccountsCsv(csvText);
    if (rows.length === 0) {
      return res.status(400).json({ ok: false, error: "No rows found in the CSV." });
    }

    const profilesC = await col("profiles");
    let created = 0, skipped = 0, errors = 0;
    const skippedRows = [];
    const createdIds = []; // user IDs of newly created accounts (for the print-slips link)

    for (const row of rows) {
      const { uid, username: usernameIn, name, role } = row;
      if (!uid) { errors++; skippedRows.push({ uid: "", reason: "Empty UID" }); continue; }
      if (uid.length < 3) { errors++; skippedRows.push({ uid, reason: "UID too short" }); continue; }
      if (!/^[a-zA-Z0-9_.\-]+$/.test(usernameIn || "")) {
        errors++; skippedRows.push({ uid, reason: `Invalid username "${usernameIn}"` }); continue;
      }
      const validRole = ["student", "subadmin", "admin"].includes(role) ? role : "student";
      const isLrn = isValidLRN(uid);
      const plaintextPassword = isLrn ? cipher(uid) : randomPassword(8);
      const mustChange = !isLrn;
      const displayName = (name?.trim()) || (isLrn ? `Student ${uid.slice(-8)}` : `User ${uid}`);
      let finalUsername = usernameIn || deriveUsername(displayName);

      // Dedup against existing UID (case-insensitive)
      const existingUid = await profilesC.findOne(
        { uid },
        { collation: { locale: "en", strength: 2 }, projection: { _id: 1 } }
      );
      if (existingUid) {
        skipped++;
        skippedRows.push({ uid, reason: "UID already exists" });
        continue;
      }
      // Auto-suffix username conflicts
      const existingUsername = await profilesC.findOne(
        { username: finalUsername },
        { collation: { locale: "en", strength: 2 }, projection: { _id: 1 } }
      );
      if (existingUsername) {
        let candidate = finalUsername;
        let i = 2;
        while (i < 10) {
          candidate = `${finalUsername}${i}`;
          const taken = await profilesC.findOne(
            { username: candidate },
            { collation: { locale: "en", strength: 2 }, projection: { _id: 1 } }
          );
          if (!taken) break;
          i++;
        }
        finalUsername = candidate;
      }

      const passwordHash = await bcrypt.hash(plaintextPassword, 12);
      const insertResult = await profilesC.insertOne({
        uid,
        username: finalUsername,
        name: displayName,
        email: null,
        role: validRole,
        avatar_color: 152,
        avatar_url: null,
        password_hash: passwordHash,
        must_change_password: mustChange,
        points: 0,
        weekly_points: 0,
        streak_days: 0,
        last_active_date: new Date().toISOString().slice(0, 10),
        practice_quizzes_taken: 0,
        flashcards_reviewed: 0,
        created_at: new Date(),
      });
      createdIds.push(insertResult.insertedId.toString());
      created++;
    }

    res.json({
      ok: true,
      created,
      skipped,
      errors,
      skippedRows: skippedRows.slice(0, 50),
      total: rows.length,
      createdIds, // the front-end uses this to build the "Print slips" URL
      slipsUrl: createdIds.length > 0 ? `/admin/accounts/print-slips?ids=${createdIds.join(",")}` : null,
    });
  } catch (err) {
    console.error("[admin importAccounts]", err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

// POST /api/admin/accounts/reset-password  body: { userId }
// Resets to cipher(UID) for LRN users, random 8-char password for others.
// Sets must_change_password = true so the user picks a new one on next login.
export async function resetPassword(req, res) {
  try {
    const userId = req.body.userId;
    if (!userId) return res.status(400).json({ ok: false, error: "userId is required." });
    const profilesC = await col("profiles");
    const profile = await profilesC.findOne({ _id: toOid(userId) });
    if (!profile) return res.status(404).json({ ok: false, error: "Account not found." });
    // Don't let an admin reset their own password via this endpoint (use the profile page).
    if (profile._id.toString() === req.user._id.toString()) {
      return res.status(400).json({ ok: false, error: "Use the Profile page to change your own password." });
    }
    const isLrn = isValidLRN(profile.uid);
    const plaintext = isLrn ? cipher(profile.uid) : randomPassword(8);
    const newHash = await bcrypt.hash(plaintext, 12);
    await profilesC.updateOne(
      { _id: profile._id },
      { $set: { password_hash: newHash, must_change_password: true } }
    );
    // Best-effort: notify the user that their password was reset.
    try {
      await notifyUser(profile._id.toString(), "password_reset",
        "Your password was reset",
        `${req.user.name} reset your password. Use your LRN cipher (or the temporary password your teacher gave you) to sign in. You'll be asked to set a new one.`,
        "/login"
      );
    } catch {}
    res.json({
      ok: true,
      temporaryPassword: plaintext,
      isLrn,
      message: isLrn
        ? `Password reset to the LRN cipher. Tell the student to sign in with their LRN cipher.`
        : `A random temporary password was generated — share it with the user once.`,
    });
  } catch (err) {
    console.error("[admin resetPassword]", err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

// POST /api/admin/accounts/:userId/remove
// Cascade-removes the user's attempts, reactions, uploads, live participants.
// Refuses to remove the last remaining admin (so the class can't be locked out).
export async function removeAccount(req, res) {
  try {
    const userId = toOid(req.params.userId);
    if (!userId) return res.status(400).json({ ok: false, error: "Invalid userId." });
    const profilesC = await col("profiles");
    const profile = await profilesC.findOne({ _id: userId });
    if (!profile) return res.status(404).json({ ok: false, error: "Account not found." });
    if (profile._id.toString() === req.user._id.toString()) {
      return res.status(400).json({ ok: false, error: "You can't remove your own account." });
    }
    if (profile.role === "admin") {
      const adminCount = await profilesC.countDocuments({ role: "admin" });
      if (adminCount <= 1) {
        return res.status(400).json({ ok: false, error: "Can't remove the last admin account." });
      }
    }
    // Cascade delete related collections
    const [attemptsC, reactionsC, uploadsC, partsC, notifC] = await Promise.all([
      col("quiz_attempts"), col("reactions"), col("uploads"), col("live_participants"), col("notifications"),
    ]);
    await Promise.all([
      attemptsC.deleteMany({ user_id: userId }),
      reactionsC.deleteMany({ user_id: userId }),
      partsC.deleteMany({ user_id: userId }),
      notifC.deleteMany({ user_id: userId }),
      // Uploads: only those uploaded by this user
      uploadsC.deleteMany({ uploaded_by: userId }),
    ]);
    await profilesC.deleteOne({ _id: userId });
    res.json({ ok: true });
  } catch (err) {
    console.error("[admin removeAccount]", err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

// POST /api/admin/accounts  body: { uid, username, name, role }
// Inline single-account creation. Same dedup rules as CSV import.
export async function createAccount(req, res) {
  try {
    const { uid, username: usernameIn, name, role } = req.body || {};
    if (!uid || String(uid).length < 3) {
      return res.status(400).json({ ok: false, error: "UID is required (min 3 characters)." });
    }
    if (!/^[a-zA-Z0-9_.\-]+$/.test(usernameIn || "")) {
      return res.status(400).json({ ok: false, error: "Username can only contain letters, digits, dots, underscores, and dashes." });
    }
    const validRole = ["student", "subadmin", "admin"].includes(role) ? role : "student";
    const profilesC = await col("profiles");
    const existingUid = await profilesC.findOne(
      { uid: String(uid).trim() },
      { collation: { locale: "en", strength: 2 }, projection: { _id: 1 } }
    );
    if (existingUid) return res.status(400).json({ ok: false, error: "UID already exists." });
    const isLrn = isValidLRN(uid);
    const plaintextPassword = isLrn ? cipher(uid) : randomPassword(8);
    const mustChange = !isLrn;
    const displayName = (name?.trim()) || (isLrn ? `Student ${String(uid).slice(-8)}` : `User ${uid}`);
    let finalUsername = usernameIn || deriveUsername(displayName);
    const existingUsername = await profilesC.findOne(
      { username: finalUsername },
      { collation: { locale: "en", strength: 2 }, projection: { _id: 1 } }
    );
    if (existingUsername) {
      let candidate = finalUsername; let i = 2;
      while (i < 10) {
        candidate = `${finalUsername}${i}`;
        const taken = await profilesC.findOne(
          { username: candidate },
          { collation: { locale: "en", strength: 2 }, projection: { _id: 1 } }
        );
        if (!taken) break;
        i++;
      }
      finalUsername = candidate;
    }
    const passwordHash = await bcrypt.hash(plaintextPassword, 12);
    await profilesC.insertOne({
      uid: String(uid).trim(),
      username: finalUsername,
      name: displayName,
      email: null,
      role: validRole,
      avatar_color: 152,
      avatar_url: null,
      password_hash: passwordHash,
      must_change_password: mustChange,
      points: 0,
      weekly_points: 0,
      streak_days: 0,
      last_active_date: new Date().toISOString().slice(0, 10),
      practice_quizzes_taken: 0,
      flashcards_reviewed: 0,
      created_at: new Date(),
    });
    res.json({
      ok: true,
      temporaryPassword: plaintextPassword,
      isLrn,
      username: finalUsername,
      message: isLrn
        ? `Account created. The student can sign in with their LRN cipher.`
        : `Account created. Share this temporary password once: ${plaintextPassword}`,
    });
  } catch (err) {
    console.error("[admin createAccount]", err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

// ===== (unchanged below) =====
export async function liveMonitor(req, res) {
  try {
    const activeSession = await getActiveLiveSession();
    const activity = await getRecentActivity(40);
    res.render("admin/live-monitor", { title: "Live Monitor", activeSession, activity, students: activeSession?.participants || [] });
  } catch (err) {
    console.error("[admin liveMonitor]", err);
    res.status(500).render("error/500", { message: err.message });
  }
}

export async function hostLive(req, res) {
  try {
    const liveQuizzes = await listQuizzes("live");
    const activeSession = await getActiveLiveSession();
    res.render("admin/host-live", { title: "Host Live Test", liveQuizzes, activeSession });
  } catch (err) {
    console.error("[admin hostLive]", err);
    res.status(500).render("error/500", { message: err.message });
  }
}

export async function startSession(req, res) {
  try {
    const session = await startLiveSession(req.body.quizId);
    const quizTitle = session?.quiz_id ? (await getQuiz(session.quiz_id))?.title : "Live test";
    await notifyRole("student", "live_test_started",
      `Live test started: ${quizTitle}`,
      `${req.user.name} started a live test. Open the Live Test page to join.`,
      "/live-test"
    );
    res.json({ ok: true, session });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

export async function advanceItem(req, res) {
  try {
    const session = await getActiveLiveSession();
    if (!session) return res.status(404).json({ ok: false, error: "No active session." });
    const next = Number.isFinite(Number(req.body.itemIndex))
      ? Number(req.body.itemIndex)
      : (session.current_item_index || 0) + 1;
    const updated = await advanceLiveItem(req.params.sessionId, next);
    res.json({ ok: true, session: updated });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

export async function endSession(req, res) {
  try {
    const session = await endLiveSession(req.params.sessionId);
    await notifyRole("student", "live_test_ended",
      "Live test ended",
      `${req.user.name} ended the live test. Your submitted answers have been saved.`,
      null
    );
    res.json({ ok: true, session });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

export async function settings(req, res) {
  try {
    const settings = await getSettings();
    const liveQuizzes = await listQuizzes("live");
    res.render("admin/settings", { title: "Settings", settings, liveQuizzes });
  } catch (err) {
    console.error("[admin settings]", err);
    res.status(500).render("error/500", { message: err.message });
  }
}

export async function updateSettings(req, res) {
  try {
    const { anti_cheat, points_config, time_limit_min, deadline, quiz_id } = req.body;
    let settings = await getSettings();
    if (anti_cheat) settings = { ...settings, anti_cheat: await updateAntiCheat(anti_cheat) };
    if (points_config) settings = { ...settings, points_config: await updatePointsConfig(points_config) };
    if (quiz_id && (time_limit_min !== undefined || deadline !== undefined)) {
      const quizzesC = await col("quizzes");
      const patch = {};
      if (time_limit_min !== undefined) patch.time_limit_min = Number(time_limit_min) || null;
      if (deadline !== undefined) patch.deadline = deadline || null;
      await quizzesC.updateOne({ _id: toOid(quiz_id) }, { $set: patch });
    }
    res.json({ ok: true, settings });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

export async function liveQuizEditor(req, res) {
  try {
    const liveQuizzes = await listQuizzes("live");
    res.render("quizzes/editor", { title: "Edit Live Test", quizzes: liveQuizzes, kind: "live" });
  } catch (err) {
    console.error("[admin liveQuizEditor]", err);
    res.status(500).render("error/500", { message: err.message });
  }
}

// ===== Scores & History panel =====
// This is the official record of live-test scores. Separate from the live monitor
// (which shows in-flight submissions) — this panel shows finalized scores with
// timestamps, and a history of every hosted live test.
export async function scoresPanel(req, res) {
  try {
    const liveC = await col("live_sessions");
    const quizzesC = await col("quizzes");
    // History: every session, newest first, with the quiz title attached.
    const sessions = await liveC.find({}).sort({ created_at: -1 }).limit(50).toArray();
    for (const s of sessions) {
      const q = await quizzesC.findOne({ _id: s.quiz_id });
      s.quiz = q ? { title: q.title } : { title: "Quiz" };
      s.quizzes = s.quiz;
      s.id = s._id.toString();
    }
    const activeSession = await getActiveLiveSession();
    res.render("admin/scores", { title: "Scores & History", sessions, activeSession });
  } catch (err) {
    console.error("[admin scoresPanel]", err);
    res.status(500).render("error/500", { message: err.message });
  }
}

// JSON endpoint — returns the full score breakdown for one session.
// Used by the live-updating scores table on /admin/scores.
export async function sessionScores(req, res) {
  try {
    const sessionId = toOid(req.params.sessionId);
    const liveC = await col("live_sessions");
    const partsC = await col("live_participants");
    const profilesC = await col("profiles");
    const quizzesC = await col("quizzes");
    const session = await liveC.findOne({ _id: sessionId });
    if (!session) return res.status(404).json({ ok: false, error: "Session not found." });
    const quiz = await quizzesC.findOne({ _id: session.quiz_id });
    const totalPossible = (quiz?.items || []).reduce((sum, it) => sum + (it.points || 1), 0);
    const parts = await partsC.find({ session_id: sessionId }).sort({ last_activity: 1 }).toArray();
    const rows = [];
    for (const p of parts) {
      const profile = await profilesC.findOne({ _id: p.user_id }, { projection: { name: 1, username: 1, avatar_color: 1, avatar_url: 1, uid: 1 } });
      rows.push({
        user_id: p.user_id?.toString?.() || null,
        name: profile?.name || "Unknown",
        username: profile?.username || null,
        uid: profile?.uid || null,
        avatar_color: profile?.avatar_color || 152,
        avatar_url: profile?.avatar_url || null,
        score: p.score || 0,
        total: totalPossible,
        status: p.status,
        warnings: p.warnings || 0,
        answers_submitted: p.answers_submitted || 0,
        joined_at: p.joined_at || p.last_activity,
        submitted_at: p.submitted_at || p.last_activity,
        last_activity: p.last_activity,
      });
    }
    res.json({
      ok: true,
      session: {
        id: session._id.toString(),
        status: session.status,
        started_at: session.started_at,
        ended_at: session.ended_at,
        quiz_title: quiz?.title || "Quiz",
        total_possible: totalPossible,
      },
      rows,
    });
  } catch (err) {
    console.error("[admin sessionScores]", err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

export async function leaderboard(req, res) {
  try {
    const weekly = await getLeaderboard("weekly");
    const alltime = await getLeaderboard("alltime");
    res.render("leaderboard", { title: "Leaderboard", weekly, alltime });
  } catch (err) {
    console.error("[admin leaderboard]", err);
    res.status(500).render("error/500", { message: err.message });
  }
}

export async function classmates(req, res) {
  try {
    const profilesC = await col("profiles");
    const students = await profilesC.find({ role: { $ne: "admin" } }).sort({ name: 1 }).toArray();
    const adviser = await profilesC.findOne({ role: "admin" });
    res.render("classmates", { title: "Classmates", students, adviser });
  } catch (err) {
    console.error("[admin classmates]", err);
    res.status(500).render("error/500", { message: err.message });
  }
}

export async function promote(req, res) {
  try {
    const { userId, role } = req.body;
    if (!["student", "subadmin", "admin"].includes(role)) {
      return res.status(400).json({ ok: false, error: "Invalid role" });
    }
    const profilesC = await col("profiles");
    const r = await profilesC.findOneAndUpdate(
      { _id: toOid(userId) },
      { $set: { role } },
      { returnDocument: "after", projection: { password_hash: 0, email: 0, must_change_password: 0 } }
    );
    res.json({ ok: true, profile: r });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}
