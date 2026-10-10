// src/controllers/reactionsController.js
import { setReaction, removeReaction, getReactionCounts, getReactionCountsBatch } from "../services/reactions.js";

const VALID_TYPES = ["unit", "quiz", "flashcard", "result"];

export async function react(req, res) {
  try {
    const { target_type, target_id, kind } = req.body;
    if (!VALID_TYPES.includes(target_type)) {
      return res.status(400).json({ ok: false, error: "Invalid target type." });
    }
    if (!target_id) return res.status(400).json({ ok: false, error: "target_id required." });
    const r = await setReaction({
      userId: req.user._id.toString(),
      targetType: target_type,
      targetId: target_id,
      kind,
    });
    res.json({ ok: true, ...r });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

export async function unreact(req, res) {
  try {
    const { target_type, target_id } = req.body;
    if (!VALID_TYPES.includes(target_type)) {
      return res.status(400).json({ ok: false, error: "Invalid target type." });
    }
    if (!target_id) return res.status(400).json({ ok: false, error: "target_id required." });
    const r = await removeReaction({
      userId: req.user._id.toString(),
      targetType: target_type,
      targetId: target_id,
    });
    res.json({ ok: true, ...r });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

export async function counts(req, res) {
  try {
    const { target_type, target_id } = req.query;
    if (!VALID_TYPES.includes(target_type)) {
      return res.status(400).json({ ok: false, error: "Invalid target type." });
    }
    const r = await getReactionCounts(target_type, target_id, req.user?._id?.toString?.() || null);
    res.json({ ok: true, ...r });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}
