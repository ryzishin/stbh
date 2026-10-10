// src/services/reactions.js
// Lightweight like/dislike reactions on notes units, quiz results, flashcards.
// Schema:
//   reactions { target_type, target_id, user_id, kind, created_at }
//   - target_type: "unit" | "quiz" | "flashcard" | "result"
//   - target_id: ObjectId or string id of the target
//   - kind: "like" | "dislike"
// Unique index on (target_type, target_id, user_id) — one reaction per user per target.
// Changing from like to dislike just overwrites kind (upsert).

import { ObjectId } from "mongodb";
import { col } from "../config/mongo.js";

function toOid(id) {
  if (!id) return null;
  if (id instanceof ObjectId) return id;
  try { return new ObjectId(String(id)); } catch { return null; }
}

const VALID_TYPES = ["unit", "quiz", "flashcard", "result"];
const VALID_KINDS = ["like", "dislike"];

export async function setReaction({ userId, targetType, targetId, kind }) {
  if (!VALID_TYPES.includes(targetType)) throw new Error("Invalid target type.");
  if (!VALID_KINDS.includes(kind)) throw new Error("Invalid reaction kind.");
  if (!userId) throw new Error("User required.");
  // targetId may be a slug (for units) or an ObjectId string. Store as string.
  const tid = String(targetId);
  const reactionsC = await col("reactions");
  await reactionsC.updateOne(
    { target_type: targetType, target_id: tid, user_id: toOid(userId) },
    { $set: { kind, updated_at: new Date() }, $setOnInsert: { created_at: new Date() } },
    { upsert: true }
  );
  return await getReactionCounts(targetType, tid, userId);
}

export async function removeReaction({ userId, targetType, targetId }) {
  if (!VALID_TYPES.includes(targetType)) throw new Error("Invalid target type.");
  const tid = String(targetId);
  const reactionsC = await col("reactions");
  await reactionsC.deleteOne({ target_type: targetType, target_id: tid, user_id: toOid(userId) });
  return await getReactionCounts(targetType, tid, userId);
}

export async function getReactionCounts(targetType, targetId, userId = null) {
  if (!VALID_TYPES.includes(targetType)) return { likes: 0, dislikes: 0, mine: null };
  const tid = String(targetId);
  const reactionsC = await col("reactions");
  const [likes, dislikes, mine] = await Promise.all([
    reactionsC.countDocuments({ target_type: targetType, target_id: tid, kind: "like" }),
    reactionsC.countDocuments({ target_type: targetType, target_id: tid, kind: "dislike" }),
    userId ? reactionsC.findOne({ target_type: targetType, target_id: tid, user_id: toOid(userId) }) : null,
  ]);
  return { likes, dislikes, mine: mine?.kind || null };
}

// Bulk fetch counts for a list of target ids (used to render lists of cards/units).
export async function getReactionCountsBatch(targetType, targetIds, userId = null) {
  if (!VALID_TYPES.includes(targetType) || targetIds.length === 0) return {};
  const tids = targetIds.map(String);
  const reactionsC = await col("reactions");
  // Aggregate counts per target_id, plus find the user's reaction per target.
  const pipeline = [
    { $match: { target_type: targetType, target_id: { $in: tids } } },
    { $group: { _id: { tid: "$target_id", kind: "$kind" }, count: { $sum: 1 } } },
  ];
  const agg = await reactionsC.aggregate(pipeline).toArray();
  const out = {};
  for (const tid of tids) out[tid] = { likes: 0, dislikes: 0, mine: null };
  for (const row of agg) {
    const tid = row._id.tid;
    if (row._id.kind === "like") out[tid].likes = row.count;
    else if (row._id.kind === "dislike") out[tid].dislikes = row.count;
  }
  if (userId) {
    const mine = await reactionsC.find({
      target_type: targetType,
      target_id: { $in: tids },
      user_id: toOid(userId),
    }).toArray();
    for (const m of mine) out[String(m.target_id)].mine = m.kind;
  }
  return out;
}
