// src/routes/index.js
import { Router } from "express";
import { attachUser, requireAuth, requireRole, requireStudent, requireSubAdmin, requireAdmin } from "../middleware/auth.js";

import * as auth from "../controllers/authController.js";
import * as notes from "../controllers/notesController.js";
import * as quizzes from "../controllers/quizzesController.js";
import * as flashcards from "../controllers/flashcardsController.js";
import * as admin from "../controllers/adminController.js";
import * as profile from "../controllers/profileController.js";
import * as notifications from "../controllers/notificationsController.js";
import * as uploads from "../controllers/uploadsController.js";
import { leaderboard, classmates, today, search } from "../controllers/pagesController.js";

const router = Router();

router.use(attachUser);

// ===== Landing & About =====
// If the user is logged in, the landing page is no longer relevant —
// redirect to the role-appropriate dashboard so the experience feels seamless.
router.get("/", (req, res) => {
  if (req.user) {
    const dest = req.user.role === "admin" ? "/admin"
      : req.user.role === "subadmin" ? "/subadmin/notes"
      : "/today";
    return res.redirect(dest);
  }
  res.render("landing", { title: "STEM Tesla BioHub" });
});
router.get("/about", (req, res) => {
  if (req.user) {
    const dest = req.user.role === "admin" ? "/admin"
      : req.user.role === "subadmin" ? "/subadmin/notes"
      : "/today";
    return res.redirect(dest);
  }
  res.render("about", { title: "About" });
});

// ===== Today view (student) — daily landing page =====
router.get("/today", requireAuth, requireStudent, today);

// ===== Search — global search across notes, flashcards, quiz items =====
router.get("/search", requireAuth, search);
router.get("/api/search", requireAuth, search);

// ===== Serve uploaded files from MongoDB =====
// Files are stored as BSON BinData in the `uploads` collection.
// GET /uploads/:id streams the binary with the right Content-Type + cache headers.
router.get("/uploads/:id", async (req, res) => {
  try {
    const { getUpload } = await import("../services/uploads.js");
    const up = await getUpload(req.params.id);
    if (!up) return res.status(404).end();
    res.setHeader("Content-Type", up.contentType || "application/octet-stream");
    res.setHeader("Content-Length", String(up.size || up.data.length));
    // Uploads are immutable (we never overwrite — each upload gets a new _id),
    // so we can cache aggressively. This makes profile pictures load instantly
    // on repeat visits and keeps the CDN happy.
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.send(up.data.buffer || up.data);
  } catch (err) {
    res.status(500).end();
  }
});

// ===== Auth (UID + bcrypt — no signup, accounts pre-created via CSV) =====
router.get("/login", auth.showLogin);
router.post("/login", auth.login);
router.post("/logout", auth.logout);

// ===== Classmates & Leaderboard (all logged-in users) =====
router.get("/classmates", requireAuth, classmates);
router.get("/leaderboard", requireAuth, leaderboard);

// ===== Notes (all logged-in users can read) =====
router.get("/notes", requireAuth, notes.listNotes);
router.get("/notes/:slug", requireAuth, notes.showUnit);

// ===== Notes editor (sub-admin + admin) =====
router.get("/subadmin/notes", requireAuth, requireSubAdmin, notes.editor);
router.post("/api/notes/units", requireAuth, requireSubAdmin, notes.createUnitPost);
router.patch("/api/notes/units/:id", requireAuth, requireSubAdmin, notes.updateUnitPost);
router.delete("/api/notes/units/:id", requireAuth, requireSubAdmin, notes.deleteUnitPost);
router.post("/api/notes/units/:unitId/parts", requireAuth, requireSubAdmin, notes.createPartPost);
router.get("/api/notes/parts/:id", requireAuth, requireSubAdmin, notes.getPartPost);
router.patch("/api/notes/parts/:id", requireAuth, requireSubAdmin, notes.updatePartPost);
router.delete("/api/notes/parts/:id", requireAuth, requireSubAdmin, notes.deletePartPost);
router.get("/api/notes/parts/:partId/blocks", requireAuth, requireSubAdmin, notes.getBlocksPost);
router.put("/api/notes/parts/:partId/blocks", requireAuth, requireSubAdmin, notes.saveBlocksPost);

// ===== Practice quizzes (student + sub-admin + admin) =====
router.get("/practice", requireAuth, requireStudent, quizzes.listPractice);
router.get("/practice/:id", requireAuth, requireStudent, quizzes.takePractice);
router.post("/practice/:id/submit", requireAuth, requireStudent, quizzes.submitPractice);

// ===== Practice quiz editor (sub-admin + admin) =====
router.get("/subadmin/practice", requireAuth, requireSubAdmin, quizzes.editor);
router.post("/api/quizzes", requireAuth, requireSubAdmin, quizzes.createQuizPost);
router.patch("/api/quizzes/:id", requireAuth, requireSubAdmin, quizzes.updateQuizPost);
router.delete("/api/quizzes/:id", requireAuth, requireSubAdmin, quizzes.deleteQuizPost);
router.post("/api/quizzes/:quizId/items", requireAuth, requireSubAdmin, quizzes.createItemPost);
router.patch("/api/quizzes/items/:id", requireAuth, requireSubAdmin, quizzes.updateItemPost);
router.delete("/api/quizzes/items/:id", requireAuth, requireSubAdmin, quizzes.deleteItemPost);

// ===== Flashcards =====
router.get("/flashcards", requireAuth, requireStudent, flashcards.list);
router.post("/flashcards/review", requireAuth, requireStudent, flashcards.review);
router.get("/subadmin/flashcards", requireAuth, requireSubAdmin, flashcards.editor);
router.post("/api/flashcards", requireAuth, requireSubAdmin, flashcards.createPost);
router.post("/api/flashcards/bulk", requireAuth, requireSubAdmin, flashcards.createBulkPost);
router.patch("/api/flashcards/:id", requireAuth, requireSubAdmin, flashcards.updatePost);
router.delete("/api/flashcards/:id", requireAuth, requireSubAdmin, flashcards.deletePost);

// ===== Notifications (any authenticated user) =====
router.get("/api/notifications", requireAuth, notifications.list);
router.get("/api/notifications/unread-count", requireAuth, notifications.unreadCount);
router.post("/api/notifications/read-all", requireAuth, notifications.markAllReadPost);
router.post("/api/notifications/:id/read", requireAuth, notifications.markReadPost);
router.post("/api/notifications/test", requireAuth, notifications.testPost);

// ===== Content image upload (sub-admin + admin) =====
router.post("/api/uploads/image", requireAuth, requireSubAdmin, (req, res, next) => {
  const upload = req.upload.single("image");
  upload(req, res, (err) => {
    if (err) return res.status(400).json({ ok: false, error: err.message });
    next();
  });
}, uploads.uploadContentImage);

// ===== Profile (with password change + username + bio + socials) =====
router.get("/profile", requireAuth, profile.show);
// Public profile — any logged-in user can view any other user's profile.
// Used by the View Profile button on Classmates, Leaderboard, and anywhere else
// a profile is clickable. Username is URL-safe chars only.
router.get("/u/:username", requireAuth, profile.showPublic);
// POST /api/profile accepts multipart/form-data (avatar upload) OR application/json.
// multer.single("avatar") parses the file into req.file (memoryStorage) when present,
// and gracefully passes through when the request is JSON (no file).
router.post("/api/profile", requireAuth, (req, res, next) => {
  // Wrap multer to ignore "no file" — JSON requests have no multipart body.
  const upload = req.upload.single("avatar");
  upload(req, res, (err) => {
    if (err) {
      // Multer errors (e.g. file too large, wrong mimetype).
      return res.status(400).json({ ok: false, error: err.message });
    }
    next();
  });
}, profile.update);
router.post("/api/profile/password", requireAuth, profile.changePassword);

// ===== Admin (admin only) =====
router.get("/admin", requireAuth, requireAdmin, admin.dashboard);
router.get("/admin/live-monitor", requireAuth, requireAdmin, admin.liveMonitor);
router.get("/admin/scores", requireAuth, requireAdmin, admin.scoresPanel);
router.get("/admin/host-live", requireAuth, requireAdmin, admin.hostLive);
router.get("/admin/live-editor", requireAuth, requireAdmin, admin.liveQuizEditor);
router.get("/admin/settings", requireAuth, requireAdmin, admin.settings);
router.get("/admin/accounts", requireAuth, requireAdmin, admin.accounts);
router.get("/admin/student/:id", requireAuth, requireAdmin, admin.studentDetail);
router.get("/admin/accounts/print-slips", requireAuth, requireAdmin, admin.printSlips);
router.post("/api/admin/start-session", requireAuth, requireAdmin, admin.startSession);
router.post("/api/admin/advance-item/:sessionId", requireAuth, requireAdmin, admin.advanceItem);
router.post("/api/admin/end-session/:sessionId", requireAuth, requireAdmin, admin.endSession);
router.post("/api/admin/settings", requireAuth, requireAdmin, admin.updateSettings);
router.post("/api/admin/promote", requireAuth, requireAdmin, admin.promote);
router.get("/api/admin/sessions/:sessionId/scores", requireAuth, requireAdmin, admin.sessionScores);
// ===== Admin: account management (CSV import, password reset, dedup, remove) =====
router.post("/api/admin/accounts/import", requireAuth, requireAdmin, (req, res, next) => {
  // multer multipart: parse a CSV file upload OR a JSON body with raw CSV text.
  // We use multer.single("file") — empty bodies (no file) pass through to JSON handler.
  const upload = req.upload.single("file");
  upload(req, res, (err) => {
    if (err) return res.status(400).json({ ok: false, error: err.message });
    next();
  });
}, admin.importAccounts);
router.post("/api/admin/accounts/reset-password", requireAuth, requireAdmin, admin.resetPassword);
router.post("/api/admin/accounts/:userId/remove", requireAuth, requireAdmin, admin.removeAccount);
router.post("/api/admin/accounts", requireAuth, requireAdmin, admin.createAccount);

// ===== Reactions (like/dislike) on notes units, quizzes, flashcards, results =====
import * as reactions from "../controllers/reactionsController.js";
router.post("/api/reactions", requireAuth, reactions.react);
router.delete("/api/reactions", requireAuth, reactions.unreact);
router.get("/api/reactions/counts", requireAuth, reactions.counts);

// ===== Live test take (student) =====
router.get("/live-test", requireAuth, requireStudent, (req, res) => {
  res.render("live-test/take", { title: "Live Test" });
});

// API endpoint for the live-test taking page (fetches current item)
router.get("/api/live-test/current", requireAuth, requireStudent, async (req, res) => {
  try {
    const { getActiveLiveSession } = await import("../services/quizzes.js");
    const { getAntiCheatConfig } = await import("../services/settings.js");
    const session = await getActiveLiveSession();
    if (!session) return res.json({ session: null });
    // Strip correct_answer / is_correct from items before sending to student
    const safeItems = (session.quizzes.items || []).map((it) => ({
      id: it.id,
      type: it.type,
      question: it.question,
      image_url: it.image_url,
      points: it.points,
      options: it.options ? it.options.map((o) => ({ id: o.id, text: o.text, image_url: o.image_url })) : null,
    }));
    const antiCheat = await getAntiCheatConfig();
    res.json({
      session: {
        id: session.id,
        status: session.status,
        current_item_index: session.current_item_index,
        quiz: { id: session.quizzes.id, title: session.quizzes.title, items: safeItems },
      },
      anti_cheat: antiCheat,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
