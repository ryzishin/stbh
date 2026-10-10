// src/services/notifications.js
// Notifications service — stored in MongoDB.
// Also exposes a `dispatchToSocket` hook so the realtime layer can push them live.

import { ObjectId } from "mongodb";
import { col } from "../config/mongo.js";

let socketDispatcher = null;
export function setSocketDispatcher(fn) { socketDispatcher = fn; }
function dispatch(event, payload) {
  try { socketDispatcher?.(event, payload); } catch {}
}

function toOid(id) {
  if (!id) return null;
  if (id instanceof ObjectId) return id;
  try { return new ObjectId(String(id)); } catch { return null; }
}

function safe(row) {
  if (!row) return row;
  return { ...row, _id: row._id?.toString?.() || row._id, id: row._id?.toString?.() || row.id };
}

// Insert a notification for a single user (or a broadcast if userId is null).
export async function createNotification({ userId = null, kind, title, body, link = null }) {
  const notificationsC = await col("notifications");
  const doc = {
    user_id: userId ? toOid(userId) : null,
    kind: kind || "system",
    title,
    body: body || null,
    link,
    read_at: null,
    created_at: new Date(),
  };
  const r = await notificationsC.insertOne(doc);
  const data = safe({ ...doc, _id: r.insertedId });
  if (userId) {
    dispatch("notification:user", { userId: String(userId), notification: data });
  } else {
    dispatch("notification:broadcast", { notification: data });
  }
  return data;
}

export async function notifyUser(userId, kind, title, body, link) {
  return createNotification({ userId, kind, title, body, link });
}

export async function notifyBroadcast(kind, title, body, link) {
  return createNotification({ userId: null, kind, title, body, link });
}

// Notify everyone in a role (e.g. all students when a live test starts).
export async function notifyRole(role, kind, title, body, link) {
  const profilesC = await col("profiles");
  const notificationsC = await col("notifications");
  const users = await profilesC.find({ role }, { projection: { _id: 1 } }).toArray();
  if (users.length === 0) return [];
  const docs = users.map(u => ({
    user_id: u._id,
    kind: kind || "system",
    title,
    body: body || null,
    link,
    read_at: null,
    created_at: new Date(),
  }));
  const r = await notificationsC.insertMany(docs);
  const inserted = docs.map((d, i) => safe({ ...d, _id: r.insertedIds[i] }));
  inserted.forEach(n => dispatch("notification:user", { userId: n.user_id.toString(), notification: n }));
  return inserted;
}

// List notifications for a user (their own + broadcasts).
export async function listForUser(userId, opts = {}) {
  const notificationsC = await col("notifications");
  const limit = opts.limit || 30;
  const unreadOnly = !!opts.unreadOnly;
  const uid = toOid(userId);
  const q = {
    $or: [{ user_id: uid }, { user_id: null }],
  };
  if (unreadOnly) q.read_at = null;
  const items = await notificationsC.find(q).sort({ created_at: -1 }).limit(limit).toArray();
  return items.map(i => safe(i));
}

export async function countUnread(userId) {
  const notificationsC = await col("notifications");
  const uid = toOid(userId);
  return await notificationsC.countDocuments({
    $or: [{ user_id: uid }, { user_id: null }],
    read_at: null,
  });
}

export async function markRead(id) {
  const notificationsC = await col("notifications");
  await notificationsC.updateOne({ _id: toOid(id) }, { $set: { read_at: new Date() } });
}

export async function markAllRead(userId) {
  const notificationsC = await col("notifications");
  const uid = toOid(userId);
  await notificationsC.updateMany(
    { $or: [{ user_id: uid }, { user_id: null }], read_at: null },
    { $set: { read_at: new Date() } }
  );
}

export async function deleteNotification(id) {
  const notificationsC = await col("notifications");
  await notificationsC.deleteOne({ _id: toOid(id) });
}
