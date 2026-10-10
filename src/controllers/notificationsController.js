// src/controllers/notificationsController.js
import { listForUser, countUnread, markRead, markAllRead, notifyUser } from "../services/notifications.js";

// GET /api/notifications  → list current user's notifications
export async function list(req, res) {
  try {
    const unreadOnly = req.query.unread === "1";
    const items = await listForUser(req.user.id, { unreadOnly, limit: 50 });
    res.json({ ok: true, notifications: items });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

// GET /api/notifications/unread-count
export async function unreadCount(req, res) {
  try {
    const count = await countUnread(req.user.id);
    res.json({ ok: true, count });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

// POST /api/notifications/:id/read
export async function markReadPost(req, res) {
  try {
    await markRead(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

// POST /api/notifications/read-all
export async function markAllReadPost(req, res) {
  try {
    await markAllRead(req.user.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

// POST /api/notifications/test  (dev only — useful for testing the bell)
export async function testPost(req, res) {
  try {
    const n = await notifyUser(req.user.id, "system",
      "Test notification",
      "If you can see this, the notifications system is working.",
      null);
    res.json({ ok: true, notification: n });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}
