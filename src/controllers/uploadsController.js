// src/controllers/uploadsController.js
// Handles image uploads for content (notes blocks, quiz question/option images).
// Stores the file in MongoDB (uploads collection) and returns the public URL.
//
// On Render free tier, the local disk is ephemeral — files saved to /uploads
// vanish on every deploy. MongoDB is persistent, so we use it for uploads too.

import { saveUpload } from "../services/uploads.js";

export async function uploadContentImage(req, res) {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: "No file uploaded." });
    const url = await saveUpload(req.file, req.user?._id?.toString?.() || null);
    res.json({ ok: true, url });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}
