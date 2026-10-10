// src/services/flashcards.js
import { ObjectId } from "mongodb";
import { col } from "../config/mongo.js";

function toOid(id) {
  if (!id) return null;
  if (id instanceof ObjectId) return id;
  try { return new ObjectId(String(id)); } catch { return null; }
}

function safe(row) {
  if (!row) return row;
  return { ...row, _id: row._id?.toString?.() || row._id, id: row._id?.toString?.() || row.id };
}

export async function listFlashcards(unitId = null) {
  const fc = await col("flashcards");
  const q = {};
  if (unitId) q.unit_id = toOid(unitId);
  const cards = await fc.find(q).sort({ created_at: -1 }).toArray();
  return cards.map(c => safe(c));
}

export async function createFlashcard({ front, back, unit_id, image_url }) {
  const fc = await col("flashcards");
  const doc = {
    front,
    back,
    unit_id: unit_id ? toOid(unit_id) : null,
    image_url: image_url || null,
    created_at: new Date(),
  };
  const r = await fc.insertOne(doc);
  return safe({ ...doc, _id: r.insertedId });
}

// Bulk-create many flashcards in one insertMany. Skips rows with empty front/back.
export async function createMany(cards) {
  const fc = await col("flashcards");
  const docs = (cards || [])
    .map(c => ({
      front: String(c.front || "").trim(),
      back: String(c.back || "").trim(),
      unit_id: c.unit_id ? toOid(c.unit_id) : null,
      image_url: c.image_url || null,
      created_at: new Date(),
    }))
    .filter(r => r.front && r.back);
  if (docs.length === 0) return [];
  const r = await fc.insertMany(docs);
  return docs.map((d, i) => safe({ ...d, _id: r.insertedIds[i] }));
}

export async function updateFlashcard(id, patch) {
  const fc = await col("flashcards");
  const cleanPatch = { ...patch };
  delete cleanPatch._id; delete cleanPatch.id;
  if (cleanPatch.unit_id !== undefined) {
    cleanPatch.unit_id = cleanPatch.unit_id ? toOid(cleanPatch.unit_id) : null;
  }
  await fc.updateOne({ _id: toOid(id) }, { $set: cleanPatch });
  const c = await fc.findOne({ _id: toOid(id) });
  return safe(c);
}

export async function deleteFlashcard(id) {
  const fc = await col("flashcards");
  const sched = await col("card_schedules");
  await fc.deleteOne({ _id: toOid(id) });
  // Cascade: delete all per-user schedule rows for this card.
  await sched.deleteMany({ card_id: toOid(id) });
}

// ===== SM-2 spaced repetition =====
// Per-user per-card schedule. Stored in the `card_schedules` collection.
// Schema:
//   { user_id, card_id, ease: 2.5, interval_days: 0, repetitions: 0,
//     last_review_at: Date|null, next_review_at: Date, created_at: Date }
//
// SM-2 (Piotr Wozniak, 1987) — adapted for a 4-button UI:
//   Again (q=0) → reset, interval = 0 days (due again now)
//   Hard  (q=3) → ease -= 0.15 (min 1.3); interval = max(1, prev * 1.2)
//   Good  (q=4) → ease unchanged; if rep 0 → 1d; if 1 → 3d; else prev * ease
//   Easy  (q=5) → ease += 0.15 (max 3.0); interval = prev * ease * 1.3

const RATING_TO_QUALITY = { again: 0, hard: 3, good: 4, easy: 5 };
const RATING_INTERVAL_FIRST = { again: 0, hard: 1, good: 1, easy: 4 };
const RATING_INTERVAL_SECOND = { again: 0, hard: 2, good: 3, easy: 6 };

// Pure function — easy to unit-test.
export function sm2NextInterval(prev, rating) {
  const q = RATING_TO_QUALITY[rating];
  if (q === undefined) throw new Error(`Unknown rating: ${rating}`);
  if (rating === 'again') return 0;
  if (prev.repetitions === 0) return RATING_INTERVAL_FIRST[rating];
  if (prev.repetitions === 1) return RATING_INTERVAL_SECOND[rating];
  let ease = prev.ease ?? 2.5;
  if (rating === 'hard') ease = Math.max(1.3, ease - 0.15);
  if (rating === 'easy') ease = Math.min(3.0, ease + 0.15);
  let next;
  if (rating === 'hard') next = Math.max(1, Math.round(prev.interval_days * 1.2));
  else if (rating === 'easy') next = Math.round(prev.interval_days * ease * 1.3);
  else next = Math.round(prev.interval_days * ease);
  return Math.max(1, next);
}

// Apply a rating. Updates ease, interval, repetitions, last/next review timestamps.
export async function reviewCard({ userId, cardId, rating }) {
  const schedC = await col("card_schedules");
  const _uid = toOid(userId);
  const _cid = toOid(cardId);
  let s = await schedC.findOne({ user_id: _uid, card_id: _cid });
  if (!s) {
    s = {
      user_id: _uid,
      card_id: _cid,
      ease: 2.5,
      interval_days: 0,
      repetitions: 0,
      last_review_at: null,
      next_review_at: new Date(),
    };
  }
  const prevForCalc = {
    repetitions: s.repetitions || 0,
    interval_days: s.interval_days || 0,
    ease: s.ease ?? 2.5,
  };
  const newIntervalDays = sm2NextInterval(prevForCalc, rating);
  let newEase = prevForCalc.ease;
  if (rating === 'hard') newEase = Math.max(1.3, newEase - 0.15);
  if (rating === 'easy') newEase = Math.min(3.0, newEase + 0.15);
  const newRepetitions = rating === 'again' ? 0 : (s.repetitions || 0) + 1;
  const now = new Date();
  const next = new Date(now.getTime() + newIntervalDays * 86400000);
  await schedC.updateOne(
    { user_id: _uid, card_id: _cid },
    {
      $set: {
        ease: newEase,
        interval_days: newIntervalDays,
        repetitions: newRepetitions,
        last_review_at: now,
        next_review_at: next,
      },
      $setOnInsert: { user_id: _uid, card_id: _cid, created_at: now },
    },
    { upsert: true }
  );
  return {
    ok: true,
    rating,
    interval_days: newIntervalDays,
    ease: newEase,
    repetitions: newRepetitions,
    next_review_at: next,
  };
}

// Per-card schedule map for a user. Used by the flashcards view to determine
// due status + to drive the "due first" queue ordering.
export async function getSchedulesForUser(userId, cardIds = null) {
  const schedC = await col("card_schedules");
  const q = { user_id: toOid(userId) };
  if (cardIds && cardIds.length) q.card_id = { $in: cardIds.map(toOid) };
  const rows = await schedC.find(q).toArray();
  const map = new Map();
  for (const r of rows) {
    map.set(r.card_id.toString(), {
      ease: r.ease,
      interval_days: r.interval_days,
      repetitions: r.repetitions,
      last_review_at: r.last_review_at,
      next_review_at: r.next_review_at,
      due: r.next_review_at ? new Date(r.next_review_at) <= new Date() : true,
    });
  }
  return map;
}

// Cards due for review now (next_review_at <= now, or never reviewed).
export async function getDueCards(userId, unitId = null) {
  const fc = await col("flashcards");
  const schedC = await col("card_schedules");
  const _uid = toOid(userId);
  const q = {};
  if (unitId) q.unit_id = toOid(unitId);
  const allCards = await fc.find(q).toArray();
  const schedules = await schedC.find({ user_id: _uid, card_id: { $in: allCards.map(c => c._id) } }).toArray();
  const schedByCard = new Map(schedules.map(s => [s.card_id.toString(), s]));
  const now = new Date();
  const due = [];
  for (const c of allCards) {
    const s = schedByCard.get(c._id.toString());
    if (!s || !s.next_review_at || new Date(s.next_review_at) <= now) {
      due.push(safe(c));
    }
  }
  return due;
}

// Summary of a user's spaced-rep state. Used by the today view + admin student detail.
export async function getSrsSummary(userId) {
  const fc = await col("flashcards");
  const schedC = await col("card_schedules");
  const _uid = toOid(userId);
  const totalCards = await fc.estimatedDocumentCount();
  const schedules = await schedC.find({ user_id: _uid }).toArray();
  const now = new Date();
  let due = 0;
  let learned = 0;  // repetitions >= 3
  let reviewed = 0; // has any last_review_at
  for (const s of schedules) {
    if (s.last_review_at) reviewed++;
    if ((s.repetitions || 0) >= 3) learned++;
    if (!s.next_review_at || new Date(s.next_review_at) <= now) due++;
  }
  const unseen = Math.max(0, totalCards - schedules.length);
  due += unseen;
  const mastery = totalCards > 0 ? Math.round((learned / totalCards) * 100) : 0;
  return { totalCards, due, learned, reviewed, mastery, unseen };
}
