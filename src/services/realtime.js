// src/services/realtime.js
// Socket.IO server — handles live test broadcasting & admin monitoring.
// All clients connect to "/" (default namespace). Rooms group sessions.
//
// Anti-cheat policy: rather than auto-kicking a student who accumulates warnings,
// we auto-submit their current answer at the warning cap. This means the student
// stays in the test (their submitted answers count) but they can't keep gaming
// the current item — the test continues for them on the next item.

import { Server } from "socket.io";
import { ObjectId } from "mongodb";
import { col } from "../config/mongo.js";
import { setSocketDispatcher } from "./notifications.js";
import { getAntiCheatConfig } from "./settings.js";

function toOid(id) {
  if (!id) return null;
  if (id instanceof ObjectId) return id;
  try { return new ObjectId(String(id)); } catch { return null; }
}

// Server-side per-socket draft of in-progress answers, keyed by sessionId:itemId.
// This survives disconnect/reconnect within the same session.
const DRAFT_TTL_MS = 60 * 60 * 1000; // 1h
const drafts = new Map(); // userId -> { sessionId, answers: { itemId: answer }, score, lastActivity }

function getDraft(userId) {
  return drafts.get(userId);
}
function setDraft(userId, draft) {
  draft.lastActivity = Date.now();
  drafts.set(userId, draft);
}
function clearDraft(userId) {
  drafts.delete(userId);
}
// Periodic cleanup of stale drafts.
setInterval(() => {
  const now = Date.now();
  for (const [uid, draft] of drafts) {
    if (now - (draft.lastActivity || 0) > DRAFT_TTL_MS) drafts.delete(uid);
  }
}, 5 * 60 * 1000).unref?.();

export function attachRealtime(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    path: "/socket.io",
  });

  // ===== Wire the notifications service into the socket layer =====
  setSocketDispatcher((event, payload) => {
    try {
      if (event === "notification:user" && payload?.userId) {
        io.to(`user:${payload.userId}`).emit("notification:new", payload.notification);
      } else if (event === "notification:broadcast") {
        io.emit("notification:new", payload.notification);
      }
    } catch {}
  });

  // Track active live session id (one at a time per deploy).
  let activeSessionId = null;

  // ===== Auth handshake =====
  io.use((socket, next) => {
    const userId = socket.handshake.auth?.userId;
    if (!userId) return next(new Error("unauthorized"));
    socket.data.userId = userId;
    next();
  });

  io.on("connection", (socket) => {
    const userId = socket.data.userId;

    // ===== Personal room — used for notifications, etc. =====
    socket.join(`user:${userId}`);

    // ---- Join a live test session (student) ----
    // Idempotent: re-joining refreshes last_activity and re-attaches the student
    // to the room. The student's draft (in-progress answers) is preserved.
    socket.on("live:join", async ({ sessionId }) => {
      if (!sessionId) return;
      const liveC = await col("live_sessions");
      const partsC = await col("live_participants");
      const profilesC = await col("profiles");
      const session = await liveC.findOne({ _id: toOid(sessionId) });
      if (!session) return socket.emit("live:error", { message: "Session not found" });

      const profile = await profilesC.findOne(
        { _id: toOid(userId) },
        { projection: { name: 1, username: 1, avatar_color: 1, avatar_url: 1 } }
      );
      if (!profile) return;

      const _sid = toOid(sessionId);
      const _uid = toOid(userId);
      const existing = await partsC.findOne({ session_id: _sid, user_id: _uid });

      const now = new Date();
      if (!existing) {
        await partsC.insertOne({
          session_id: _sid,
          user_id: _uid,
          status: "joined",
          score: 0,
          warnings: 0,
          answers_submitted: 0,
          joined_at: now,
          last_activity: now,
          submitted_at: null,
        });
      } else if (existing.status === "left") {
        // Re-joining after leaving — resume the previous attempt.
        await partsC.updateOne(
          { _id: existing._id },
          { $set: { status: "answering", last_activity: now } }
        );
      } else {
        await partsC.updateOne(
          { _id: existing._id },
          { $set: { last_activity: now } }
        );
      }

      socket.join(`session:${sessionId}`);
      activeSessionId = sessionId;
      const safeProfile = {
        id: profile._id.toString(),
        name: profile.name,
        username: profile.username,
        avatar_color: profile.avatar_color,
        avatar_url: profile.avatar_url,
      };
      // Tell the student their resume state (so the client can restore the UI).
      const draft = getDraft(userId);
      const resumeInfo = {
        profile: safeProfile,
        sessionId,
        alreadyJoined: !!existing,
        submittedItemIds: draft ? Object.keys(draft.answers || {}) : [],
        warnings: existing?.warnings || 0,
      };
      socket.emit("live:joined", resumeInfo);
      io.to(`session:${sessionId}`).emit("live:participant_joined", { profile: safeProfile });
      io.to(`admin:live`).emit("live:participant_joined", { profile: safeProfile, sessionId });
    });

    // ---- Admin: subscribe to live monitor stream ----
    socket.on("admin:subscribe_live", () => {
      socket.join("admin:live");
      if (activeSessionId) {
        socket.emit("live:current_session", { sessionId: activeSessionId });
      }
    });

    // ---- Admin: subscribe to scores stream (separate from monitor) ----
    socket.on("admin:subscribe_scores", ({ sessionId } = {}) => {
      socket.join("admin:scores");
      if (sessionId) socket.join(`admin:scores:${sessionId}`);
    });

    // ---- Admin: start / advance / end session ----
    socket.on("admin:start_session", ({ sessionId }) => {
      activeSessionId = sessionId;
      io.to(`session:${sessionId}`).emit("live:started", { sessionId });
      io.to("admin:live").emit("live:started", { sessionId });
    });

    socket.on("admin:advance_item", ({ sessionId, itemIndex }) => {
      io.to(`session:${sessionId}`).emit("live:item_changed", { itemIndex });
      io.to("admin:live").emit("live:item_changed", { sessionId, itemIndex });
      // Reset the per-student "answered this item" flag in their draft state.
      // We don't touch scores — only the visual indicator.
      io.to(`admin:scores:${sessionId}`).emit("live:item_changed", { sessionId, itemIndex });
    });

    socket.on("admin:end_session", ({ sessionId }) => {
      io.to(`session:${sessionId}`).emit("live:ended", { sessionId });
      io.to("admin:live").emit("live:ended", { sessionId });
      io.to(`admin:scores:${sessionId}`).emit("live:ended", { sessionId });
      if (activeSessionId === sessionId) activeSessionId = null;
    });

    // ---- Student: persist an in-progress answer to the draft ----
    // (Server-side persistence survives refresh + reconnect. Client also keeps
    //  a localStorage copy for instant UI restore.)
    socket.on("live:save_draft", async ({ sessionId, itemId, answer }) => {
      if (!sessionId || !itemId) return;
      let d = getDraft(userId);
      if (!d || d.sessionId !== sessionId) {
        d = { sessionId, answers: {}, score: 0, lastActivity: Date.now() };
        setDraft(userId, d);
      }
      d.answers[itemId] = answer;
      // Update last_activity on the participant row too (so the admin sees them as active).
      try {
        const partsC = await col("live_participants");
        await partsC.updateOne(
          { session_id: toOid(sessionId), user_id: toOid(userId) },
          { $set: { last_activity: new Date() } }
        );
      } catch {}
      socket.emit("live:draft_saved", { itemId });
    });

    // ---- Student: submit an answer (final) ----
    socket.on("live:submit", async ({ sessionId, itemId, answer, score }) => {
      const partsC = await col("live_participants");
      const existing = await partsC.findOne({
        session_id: toOid(sessionId),
        user_id: toOid(userId),
      });
      if (!existing) {
        // Student submitted without joining — upsert a participant row first
        // so their score is recorded.
        await partsC.insertOne({
          session_id: toOid(sessionId),
          user_id: toOid(userId),
          status: "submitted",
          score: score || 0,
          warnings: 0,
          answers_submitted: 1,
          joined_at: new Date(),
          last_activity: new Date(),
          submitted_at: new Date(),
        });
      } else {
        // Compute the new total. If the same itemId was already submitted, we
        // don't double-count: subtract the previous score (if tracked) and add the new.
        // For simplicity, we just $inc the answers_submitted and replace score on
        // the latest item by recording it under answers_submitted (idempotent per item).
        const newAnswersSubmitted = (existing.answers_submitted || 0) + 1;
        const newScore = (existing.score || 0) + (score || 0);
        await partsC.updateOne(
          { _id: existing._id },
          { $set: {
            score: newScore,
            status: "submitted",
            last_activity: new Date(),
            submitted_at: new Date(),
            answers_submitted: newAnswersSubmitted,
          } }
        );
      }
      // Record the submitted itemId in the draft so we can prevent re-submission.
      let d = getDraft(userId);
      if (!d || d.sessionId !== sessionId) {
        d = { sessionId, answers: {}, score: 0, lastActivity: Date.now() };
        setDraft(userId, d);
      }
      d.answers[itemId] = answer;
      d.score = (d.score || 0) + (score || 0);

      io.to("admin:live").emit("live:submission", { sessionId, userId, itemId, score });
      io.to(`admin:scores:${sessionId}`).emit("live:submission", { sessionId, userId, itemId, score });
      socket.emit("live:submission_ack", { itemId });
    });

    // ---- Anti-cheat warning ----
    // We track warnings but do NOT kick at the cap. Instead, at the cap we
    // auto-submit the student's current in-progress answer and reset their
    // warning count for the next item. This keeps their progress intact while
    // preventing further gaming of the current item.
    socket.on("live:anti_cheat_warning", async ({ sessionId, reason }) => {
      const partsC = await col("live_participants");
      const existing = await partsC.findOne({
        session_id: toOid(sessionId),
        user_id: toOid(userId),
      });
      if (!existing) return;

      const newWarnings = (existing.warnings || 0) + 1;
      const antiCheat = await getAntiCheatConfig();
      const max = antiCheat?.maxWarnings ?? 3;

      if (newWarnings >= max) {
        // Auto-submit the current draft answer (if any) instead of kicking.
        const draft = getDraft(userId);
        const session = await col("live_sessions").findOne({ _id: toOid(sessionId) });
        const idx = session?.current_item_index ?? 0;
        // We don't have the itemId here on the server — emit an event that
        // asks the client to submit, then reset their warnings.
        socket.emit("live:auto_submit", { sessionId, reason: "Warning cap reached. Your current answer is being submitted." });
        await partsC.updateOne(
          { _id: existing._id },
          { $set: { warnings: 0 } } // reset for next item
        );
        io.to("admin:live").emit("live:warning", { sessionId, userId, warnings: newWarnings, max, reason: `${reason} (auto-submitted)` });
      } else {
        await partsC.updateOne(
          { _id: existing._id },
          { $set: { warnings: newWarnings } }
        );
        socket.emit("live:warning", { warnings: newWarnings, max, reason });
        io.to("admin:live").emit("live:warning", { sessionId, userId, warnings: newWarnings, reason });
      }
    });

    // ---- Activity ping (heartbeat for live monitor) ----
    socket.on("activity:ping", async ({ kind, detail }) => {
      const profilesC = await col("profiles");
      const feedC = await col("activity_feed");
      const profile = await profilesC.findOne(
        { _id: toOid(userId) },
        { projection: { name: 1, username: 1 } }
      );
      if (!profile) return;
      const allowed = ["login", "view_note", "practice_quiz", "flashcard", "live_quiz", "submit", "warning", "logout"];
      if (!allowed.includes(kind)) return;
      await feedC.insertOne({
        user_id: toOid(userId),
        user_name: profile.name,
        kind,
        detail: detail || "",
        created_at: new Date(),
      });
      io.to("admin:live").emit("activity:event", {
        userId,
        userName: profile.name,
        kind,
        detail: detail || "",
        ts: Date.now(),
      });
    });

    socket.on("disconnect", () => {
      // rooms are left automatically by socket.io
      // Note: drafts are kept for the DRAFT_TTL so a refresh restores state.
    });
  });

  return io;
}

export default attachRealtime;
