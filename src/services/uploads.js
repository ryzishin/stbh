// src/services/uploads.js
// File uploads stored directly in MongoDB as BSON BinData.
//
// Why MongoDB (not disk)?
//   - Render free tier has ephemeral disk — files saved to /uploads vanish on every deploy.
//   - MongoDB is persistent and already our data store, so we get atomic writes + backups for free.
//
// Why not GridFS?
//   - GridFS is for files >16MB. We cap uploads at 5MB, well under the BSON document limit.
//   - A single document per file is simpler to query, simpler to delete, simpler to reason about.
//
// Each upload is one document: { _id, filename, contentType, size, data: Buffer, uploadedBy, createdAt }.
// Served via GET /uploads/:id which streams the binary with the right Content-Type.

import { ObjectId } from "mongodb";
import { col } from "../config/mongo.js";

function toOid(id) {
  if (!id) return null;
  if (id instanceof ObjectId) return id;
  try { return new ObjectId(String(id)); } catch { return null; }
}

// Save an uploaded file to MongoDB. `file` is multer's file object (memoryStorage).
// Returns the new URL path that the file can be served from: `/uploads/<id>`.
export async function saveUpload(file, uploadedBy = null) {
  if (!file || !file.buffer) throw new Error("No file buffer.");
  const uploadsC = await col("uploads");
  const doc = {
    filename: file.originalname || "upload",
    contentType: file.mimetype || "application/octet-stream",
    size: file.size || file.buffer.length,
    data: file.buffer,
    uploaded_by: uploadedBy ? toOid(uploadedBy) : null,
    created_at: new Date(),
  };
  const r = await uploadsC.insertOne(doc);
  return `/uploads/${r.insertedId.toString()}`;
}

// Fetch an upload by its _id (string or ObjectId). Returns the document or null.
export async function getUpload(id) {
  const _id = toOid(id);
  if (!_id) return null;
  const uploadsC = await col("uploads");
  return await uploadsC.findOne({ _id });
}

// Delete an upload by its _id. Used when the referencing entity is deleted
// (e.g. a profile picture is replaced, or a content image's parent block is removed).
// Best-effort — failures are logged but not thrown.
export async function deleteUpload(id) {
  const _id = toOid(id);
  if (!_id) return;
  try {
    const uploadsC = await col("uploads");
    await uploadsC.deleteOne({ _id });
  } catch (err) {
    console.warn("[uploads] delete failed:", err.message);
  }
}
