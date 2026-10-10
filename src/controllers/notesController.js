// src/controllers/notesController.js
import { listUnits, getUnit, createUnit, updateUnit, deleteUnit, createPart, updatePart, deletePart, saveBlocks, listBlocksForPart, getPart } from "../services/notes.js";
import { getReactionCounts } from "../services/reactions.js";

// ===== Public (all logged-in users) =====
export async function listNotes(req, res) {
  try {
    const units = await listUnits();
    res.render("notes/index", { title: "Notes", units });
  } catch (err) {
    console.error("[listNotes]", err);
    res.status(500).render("error/500", { message: err.message });
  }
}

export async function showUnit(req, res) {
  try {
    const unit = await getUnit(req.params.slug);
    if (!unit) return res.status(404).render("error/404");
    // Attach reactions (likes/dislikes/mine) so the partial can render the counts.
    try {
      unit.reactions = await getReactionCounts("unit", unit.id || unit.slug, req.user?._id?.toString?.() || null);
    } catch {
      unit.reactions = { likes: 0, dislikes: 0, mine: null };
    }
    // Defensive: ensure each part has a `blocks` array (avoids EJS crashes when a
    // part has just been created and has no blocks yet).
    if (Array.isArray(unit.parts)) {
      unit.parts = unit.parts.map(p => ({ ...p, blocks: Array.isArray(p.blocks) ? p.blocks : [] }));
    }
    res.render("notes/unit", { title: unit.title, unit });
  } catch (err) {
    console.error("[showUnit]", err);
    res.status(500).render("error/500", { message: err.message });
  }
}

// ===== Sub-Admin / Admin: editor =====
export async function editor(req, res) {
  try {
    const units = await listUnits();
    res.render("notes/editor", { title: "Edit Notes", units });
  } catch (err) {
    console.error("[notes editor]", err);
    res.status(500).render("error/500", { message: err.message });
  }
}

export async function createUnitPost(req, res) {
  try {
    const u = await createUnit(req.body);
    // seed with one part
    await createPart(u.id, { title: "Introduction" });
    res.json({ ok: true, unit: u });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

export async function updateUnitPost(req, res) {
  try {
    const u = await updateUnit(req.params.id, req.body);
    res.json({ ok: true, unit: u });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

export async function deleteUnitPost(req, res) {
  try {
    await deleteUnit(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

export async function createPartPost(req, res) {
  try {
    const p = await createPart(req.params.unitId, req.body);
    res.json({ ok: true, part: p });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

// GET /api/notes/parts/:id — returns { id, title, blocks: [...] }
// Used by the notes editor when opening a part for editing (the editor used to
// call /api/notes/parts/:partId/blocks and only got blocks, missing the title).
export async function getPartPost(req, res) {
  try {
    const p = await getPart(req.params.id);
    if (!p) return res.status(404).json({ ok: false, error: "Part not found." });
    const blocks = await listBlocksForPart(req.params.id);
    res.json({
      ok: true,
      id: p.id,
      title: p.title || "",
      unit_id: p.unit_id?.toString?.() || null,
      blocks,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

export async function updatePartPost(req, res) {
  try {
    const p = await updatePart(req.params.id, req.body);
    res.json({ ok: true, part: p });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

export async function deletePartPost(req, res) {
  try {
    await deletePart(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

// GET /api/notes/parts/:partId/blocks — returns { blocks: [...] }
// Used by the notes editor (legacy fetch kept for backwards compat with the
// openPartEditor() implementation, which expects d.blocks).
export async function getBlocksPost(req, res) {
  try {
    const p = await getPart(req.params.partId);
    if (!p) return res.status(404).json({ ok: false, error: "Part not found." });
    const blocks = await listBlocksForPart(req.params.partId);
    res.json({
      ok: true,
      title: p.title || "",
      id: p.id,
      blocks,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

// Save all blocks for a part (called by the editor on Save)
export async function saveBlocksPost(req, res) {
  try {
    await saveBlocks(req.params.partId, req.body.blocks || []);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}
