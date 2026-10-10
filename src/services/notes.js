// src/services/notes.js
// Notes templating engine — units → parts → content_blocks.
// Block kinds: paragraph, heading, bullet, numbered, image, divider, callout.
//
// IDs in MongoDB are ObjectId. We expose them as strings to the view layer
// (EJS can't serialize ObjectIds directly when rendering data attributes for
// fetch URLs). The controller and client code treat every `id` as a string.
import { ObjectId } from "mongodb";
import { col } from "../config/mongo.js";

function toOid(id) {
  if (!id) return null;
  if (id instanceof ObjectId) return id;
  try { return new ObjectId(String(id)); } catch { return null; }
}

// Make a row JSON-safe (for EJS / fetch URLs).
function safe(row) {
  if (!row) return row;
  return { ...row, _id: row._id?.toString?.() || row._id, id: row._id?.toString?.() || row.id };
}

export async function listUnits() {
  const unitsC = await col("units");
  const units = await unitsC.find({}).sort({ sort_order: 1 }).toArray();
  for (const u of units) {
    u.parts = await listPartsForUnit(u._id);
    u.id = u._id.toString();
  }
  return units;
}

export async function getUnit(slug) {
  const unitsC = await col("units");
  const u = await unitsC.findOne({ slug });
  if (!u) return null;
  u.parts = await listPartsForUnit(u._id);
  u.id = u._id.toString();
  return u;
}

// Fetch a single part (no blocks attached). Used by the editor when opening a
// part for editing — blocks are fetched separately by listBlocksForPart().
export async function getPart(id) {
  const partsC = await col("parts");
  const p = await partsC.findOne({ _id: toOid(id) });
  if (!p) return null;
  p.id = p._id.toString();
  return p;
}

async function listPartsForUnit(unitId) {
  const partsC = await col("parts");
  const parts = await partsC.find({ unit_id: unitId }).sort({ sort_order: 1 }).toArray();
  for (const p of parts) {
    p.blocks = await listBlocksForPart(p._id);
    p.id = p._id.toString();
  }
  return parts;
}

export async function listBlocksForPart(partId) {
  const blocksC = await col("content_blocks");
  const blocks = await blocksC.find({ part_id: toOid(partId) }).sort({ sort_order: 1 }).toArray();
  return blocks.map(b => ({ ...b, id: b._id.toString() }));
}

export async function createUnit({ number, title, description, icon, slug }) {
  const unitsC = await col("units");
  const doc = {
    number: number || String(Date.now()).slice(-2),
    title,
    description: description || "",
    icon: icon || "📘",
    slug: slug || title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
    sort_order: Date.now(),
    updated_at: new Date().toISOString().slice(0, 10),
    created_at: new Date(),
  };
  const r = await unitsC.insertOne(doc);
  return safe({ ...doc, _id: r.insertedId });
}

export async function updateUnit(id, patch) {
  const unitsC = await col("units");
  const cleanPatch = { ...patch };
  // Never allow _id overwrite.
  delete cleanPatch._id; delete cleanPatch.id;
  // Coerce unit_id from string to ObjectId if present (unlikely here, defensive).
  if (cleanPatch.unit_id) cleanPatch.unit_id = toOid(cleanPatch.unit_id);
  cleanPatch.updated_at = new Date().toISOString().slice(0, 10);
  await unitsC.updateOne({ _id: toOid(id) }, { $set: cleanPatch });
  const u = await unitsC.findOne({ _id: toOid(id) });
  return safe(u);
}

export async function deleteUnit(id) {
  const unitsC = await col("units");
  const partsC = await col("parts");
  const blocksC = await col("content_blocks");
  const _id = toOid(id);
  // Cascade: delete parts + blocks under this unit.
  const parts = await partsC.find({ unit_id: _id }).toArray();
  if (parts.length) {
    await blocksC.deleteMany({ part_id: { $in: parts.map(p => p._id) } });
    await partsC.deleteMany({ unit_id: _id });
  }
  await unitsC.deleteOne({ _id });
}

export async function createPart(unitId, { title }) {
  const partsC = await col("parts");
  // next sort_order under this unit
  const last = await partsC.findOne({ unit_id: toOid(unitId) }, { sort: { sort_order: -1 } });
  const nextOrder = (last?.sort_order || 0) + 1;
  const doc = {
    unit_id: toOid(unitId),
    title: title || "New Part",
    sort_order: nextOrder,
    created_at: new Date(),
  };
  const r = await partsC.insertOne(doc);
  return safe({ ...doc, _id: r.insertedId });
}

export async function updatePart(id, patch) {
  const partsC = await col("parts");
  const cleanPatch = { ...patch };
  delete cleanPatch._id; delete cleanPatch.id;
  if (cleanPatch.unit_id) cleanPatch.unit_id = toOid(cleanPatch.unit_id);
  await partsC.updateOne({ _id: toOid(id) }, { $set: cleanPatch });
  const p = await partsC.findOne({ _id: toOid(id) });
  return safe(p);
}

export async function deletePart(id) {
  const partsC = await col("parts");
  const blocksC = await col("content_blocks");
  const _id = toOid(id);
  await blocksC.deleteMany({ part_id: _id });
  await partsC.deleteOne({ _id });
}

// Save the entire set of blocks for a part (delete + re-insert).
// `blocks` is the array the editor sent (each block has kind + payload fields).
export async function saveBlocks(partId, blocks) {
  const blocksC = await col("content_blocks");
  const _pid = toOid(partId);
  await blocksC.deleteMany({ part_id: _pid });
  if (!blocks || blocks.length === 0) return;
  const docs = blocks.map((b, i) => ({
    part_id: _pid,
    kind: b.kind,
    sort_order: i,
    text: b.text ?? null,
    level: b.level ?? null,
    items: b.items ?? null,
    url: b.url ?? null,
    caption: b.caption ?? null,
    variant: b.variant ?? null,
    created_at: new Date(),
  }));
  await blocksC.insertMany(docs);
}

// Helper to render a block as EJS-friendly HTML server-side.
export function renderBlockHtml(b) {
  switch (b.kind) {
    case "heading":
      return `<h${b.level || 2}>${esc(b.text)}</h${b.level || 2}>`;
    case "paragraph":
      return `<p>${esc(b.text)}</p>`;
    case "bullet":
      return `<ul>${(b.items || []).map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
    case "numbered":
      return `<ol>${(b.items || []).map((i) => `<li>${esc(i)}</li>`).join("")}</ol>`;
    case "image":
      return `<figure><img src="${esc(b.url)}" alt="${esc(b.caption || "")}" /><figcaption>${esc(b.caption || "")}</figcaption></figure>`;
    case "divider":
      return `<hr/>`;
    case "callout": {
      const cls = b.variant === "warning" ? "callout warning" : b.variant === "success" ? "callout success" : "callout info";
      return `<div class="${cls}">${esc(b.text)}</div>`;
    }
    default:
      return "";
  }
}

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
