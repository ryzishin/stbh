// src/services/quizzes.js
// Quiz + items + options + attempts + live sessions.
// All public IDs are ObjectId strings.
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

export async function listQuizzes(kind = null) {
  const quizzesC = await col("quizzes");
  const q = {};
  if (kind) q.kind = kind;
  const quizzes = await quizzesC.find(q).sort({ created_at: -1 }).toArray();
  for (const quiz of quizzes) {
    quiz.items = await listItems(quiz._id);
    quiz.id = quiz._id.toString();
  }
  return quizzes;
}

export async function getQuiz(id) {
  const quizzesC = await col("quizzes");
  const quiz = await quizzesC.findOne({ _id: toOid(id) });
  if (!quiz) return null;
  quiz.items = await listItems(quiz._id);
  quiz.id = quiz._id.toString();
  return quiz;
}

export async function listItems(quizId) {
  const itemsC = await col("quiz_items");
  const items = await itemsC.find({ quiz_id: toOid(quizId) }).sort({ sort_order: 1 }).toArray();
  for (const it of items) {
    it.options = await listOptions(it._id);
    it.id = it._id.toString();
  }
  return items;
}

export async function createQuiz(payload) {
  const quizzesC = await col("quizzes");
  const doc = {
    title: payload.title,
    description: payload.description || "",
    kind: payload.kind || "practice",
    unit_id: payload.unit_id ? toOid(payload.unit_id) : null,
    shuffle_items: payload.shuffle_items !== false,
    shuffle_options: payload.shuffle_options !== false,
    time_limit_min: payload.time_limit_min || null,
    deadline: payload.deadline || null,
    created_at: new Date(),
  };
  const r = await quizzesC.insertOne(doc);
  return safe({ ...doc, _id: r.insertedId });
}

export async function updateQuiz(id, patch) {
  const quizzesC = await col("quizzes");
  const cleanPatch = { ...patch };
  delete cleanPatch._id; delete cleanPatch.id;
  if (cleanPatch.unit_id !== undefined) {
    cleanPatch.unit_id = cleanPatch.unit_id ? toOid(cleanPatch.unit_id) : null;
  }
  await quizzesC.updateOne({ _id: toOid(id) }, { $set: cleanPatch });
  const q = await quizzesC.findOne({ _id: toOid(id) });
  return safe(q);
}

export async function deleteQuiz(id) {
  const quizzesC = await col("quizzes");
  const itemsC = await col("quiz_items");
  const optionsC = await col("quiz_options");
  const attemptsC = await col("quiz_attempts");
  const _id = toOid(id);
  const items = await itemsC.find({ quiz_id: _id }).toArray();
  if (items.length) {
    await optionsC.deleteMany({ item_id: { $in: items.map(i => i._id) } });
    await itemsC.deleteMany({ quiz_id: _id });
  }
  await attemptsC.deleteMany({ quiz_id: _id });
  await quizzesC.deleteOne({ _id });
}

export async function createItem(quizId, payload) {
  const itemsC = await col("quiz_items");
  const optionsC = await col("quiz_options");
  const last = await itemsC.findOne({ quiz_id: toOid(quizId) }, { sort: { sort_order: -1 } });
  const nextOrder = (last?.sort_order || 0) + 1;
  const doc = {
    quiz_id: toOid(quizId),
    type: payload.type || "multiple_choice",
    question: payload.question,
    image_url: payload.image_url || null,
    correct_answer: payload.correct_answer || null,
    explanation: payload.explanation || null,
    points: payload.points || 1,
    sort_order: nextOrder,
    created_at: new Date(),
  };
  const r = await itemsC.insertOne(doc);
  if (payload.options && payload.options.length > 0) {
    const opts = payload.options.map((o, i) => ({
      item_id: r.insertedId,
      text: o.text,
      image_url: o.image_url || null,
      is_correct: !!o.is_correct,
      sort_order: i,
    }));
    await optionsC.insertMany(opts);
  }
  return safe({ ...doc, _id: r.insertedId, options: await listOptions(r.insertedId) });
}

export async function listOptions(itemId) {
  const optionsC = await col("quiz_options");
  const opts = await optionsC.find({ item_id: toOid(itemId) }).sort({ sort_order: 1 }).toArray();
  return opts.map(o => safe(o));
}

export async function updateItem(id, patch) {
  const itemsC = await col("quiz_items");
  const cleanPatch = { ...patch };
  delete cleanPatch._id; delete cleanPatch.id;
  delete cleanPatch.options; // handled separately by saveOptions
  await itemsC.updateOne({ _id: toOid(id) }, { $set: cleanPatch });
  const it = await itemsC.findOne({ _id: toOid(id) });
  return safe(it);
}

export async function deleteItem(id) {
  const itemsC = await col("quiz_items");
  const optionsC = await col("quiz_options");
  const _id = toOid(id);
  await optionsC.deleteMany({ item_id: _id });
  await itemsC.deleteOne({ _id });
}

export async function saveOptions(itemId, options) {
  const optionsC = await col("quiz_options");
  const _id = toOid(itemId);
  await optionsC.deleteMany({ item_id: _id });
  if (!options || options.length === 0) return;
  const rows = options.map((o, i) => ({
    item_id: _id,
    text: o.text,
    image_url: o.image_url || null,
    is_correct: !!o.is_correct,
    sort_order: i,
  }));
  await optionsC.insertMany(rows);
}

// Attempts
export async function recordAttempt({ userId, quizId, score, total, durationSec, itemAnswers }) {
  const attemptsC = await col("quiz_attempts");
  const doc = {
    user_id: toOid(userId),
    quiz_id: toOid(quizId),
    score,
    total,
    duration_sec: durationSec,
    taken_at: new Date(),
    // Per-item breakdown — { item_id, given_answer, is_correct, points_awarded, points_possible, item_type }
    // Stored alongside the score so we can later compute "weakest items" without
    // re-grading from the (possibly changed) quiz definition.
    item_answers: Array.isArray(itemAnswers) ? itemAnswers : [],
  };
  const r = await attemptsC.insertOne(doc);
  return safe({ ...doc, _id: r.insertedId });
}

export async function listAttemptsForUser(userId) {
  const attemptsC = await col("quiz_attempts");
  const quizzesC = await col("quizzes");
  const attempts = await attemptsC.find({ user_id: toOid(userId) }).sort({ taken_at: -1 }).toArray();
  // Attach the quiz title for each attempt (replaces the Supabase join).
  for (const a of attempts) {
    const q = await quizzesC.findOne({ _id: a.quiz_id });
    a.quiz = q ? { title: q.title } : { title: "Quiz" };
    a.quizzes = a.quiz; // back-compat with the existing view (a.quizzes.title)
    a.id = a._id.toString();
  }
  return attempts;
}

// Live sessions
export async function startLiveSession(quizId) {
  const liveC = await col("live_sessions");
  const doc = {
    quiz_id: toOid(quizId),
    status: "active",
    current_item_index: 0,
    started_at: new Date(),
    ended_at: null,
    created_at: new Date(),
  };
  const r = await liveC.insertOne(doc);
  return safe({ ...doc, _id: r.insertedId });
}

export async function endLiveSession(sessionId) {
  const liveC = await col("live_sessions");
  await liveC.updateOne(
    { _id: toOid(sessionId) },
    { $set: { status: "ended", ended_at: new Date() } }
  );
  const s = await liveC.findOne({ _id: toOid(sessionId) });
  return safe(s);
}

export async function getActiveLiveSession() {
  const liveC = await col("live_sessions");
  const quizzesC = await col("quizzes");
  const partsC = await col("live_participants");
  const profilesC = await col("profiles");
  // Find the latest active session.
  const s = await liveC.findOne({ status: "active" }, { sort: { created_at: -1 } });
  if (!s) return null;
  // Attach quiz.
  s.quiz = await quizzesC.findOne({ _id: s.quiz_id });
  s.quizzes = s.quiz; // back-compat with the existing view code
  s.quizzes.items = await listItems(s.quiz_id);
  // Attach participants (joined, not left).
  const parts = await partsC.find({ session_id: s._id, status: { $ne: "left" } })
    .sort({ last_activity: -1 }).toArray();
  for (const p of parts) {
    const profile = await profilesC.findOne({ _id: p.user_id }, { projection: { name: 1, username: 1, avatar_color: 1, avatar_url: 1 } });
    p.profiles = profile || { name: "Unknown" };
  }
  s.participants = parts;
  s.joined_count = parts.length;
  s.answered_count = parts.filter(p => p.status === "submitted").length;
  s.id = s._id.toString();
  return s;
}

export async function advanceLiveItem(sessionId, newIndex) {
  const liveC = await col("live_sessions");
  const partsC = await col("live_participants");
  await liveC.updateOne({ _id: toOid(sessionId) }, { $set: { current_item_index: newIndex } });
  // Reset participants' status back to "answering" for those still active.
  await partsC.updateMany(
    { session_id: toOid(sessionId), status: { $in: ["submitted", "answering"] } },
    { $set: { status: "answering" } }
  );
  const s = await liveC.findOne({ _id: toOid(sessionId) });
  return safe(s);
}

// Grade an attempt server-side (trustless — never trust the client score).
// Returns { score, total, breakdown } where breakdown is a per-item array:
//   { item_id, item_type, question, given_answer, given_text,
//     correct_answer_id, correct_text, is_correct,
//     points_awarded, points_possible }
// The breakdown is stored in the attempt so we can later aggregate "weakest
// items" without re-grading against a (possibly edited) quiz definition.
export function gradeAttempt(items, answers) {
  let score = 0;
  let total = 0;
  const breakdown = [];
  for (const it of items) {
    const pointsPossible = it.points || 1;
    total += pointsPossible;
    const ans = answers[it.id];
    // Normalize answers for comparison.
    const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    let isCorrect = false;
    let correctOption = null;
    let givenText = "";
    let correctText = "";
    if (it.type === "multiple_choice" || it.type === "true_false") {
      correctOption = (it.options || []).find((o) => o.is_correct);
      if (correctOption) correctText = correctOption.text;
      if (correctOption && ans === correctOption.id) {
        isCorrect = true;
        score += pointsPossible;
      }
      // Look up the text of what the user actually picked.
      const givenOpt = (it.options || []).find((o) => o.id === ans);
      if (givenOpt) givenText = givenOpt.text;
      else if (typeof ans === "string") givenText = ans;
    } else if (it.type === "identification") {
      correctText = it.correct_answer || "";
      givenText = typeof ans === "string" ? ans : "";
      if (ans && norm(ans).includes(norm(it.correct_answer))) {
        isCorrect = true;
        score += pointsPossible;
      }
    } else if (it.type === "open_ended") {
      correctText = it.correct_answer || "";
      givenText = typeof ans === "string" ? ans : "";
      if (ans && String(ans).toLowerCase().includes(String(it.correct_answer || "").toLowerCase())) {
        isCorrect = true;
        score += pointsPossible;
      }
    }
    breakdown.push({
      item_id: it.id,
      item_type: it.type,
      question: it.question || "",
      given_answer: ans != null ? String(ans) : "",
      given_text: givenText,
      correct_answer_id: correctOption?.id || null,
      correct_text: correctText,
      is_correct: isCorrect,
      points_awarded: isCorrect ? pointsPossible : 0,
      points_possible: pointsPossible,
    });
  }
  return { score, total, breakdown };
}

// Aggregate "weakest items" for a user — counts how many times each item was
// answered WRONG across all of the user's attempts. Returns the top N, with
// the question text + the correct answer attached (looked up from the live
// quiz_items collection AND the quiz_options collection, since options are
// stored separately for MC/TF items).
//
// Why aggregate from item_answers instead of re-grading:
//   - The quiz may have been edited since the attempt (item deleted, options
//     changed, points changed). The stored breakdown reflects what the student
//     actually saw + what they actually answered.
//   - We still attach the current question + correct text from the live item
//     so the admin sees the up-to-date phrasing.
export async function getWeakestItemsForUser(userId, limit = 10) {
  if (!userId) return [];
  const attemptsC = await col("quiz_attempts");
  const itemsC = await col("quiz_items");
  const quizzesC = await col("quizzes");
  const optionsC = await col("quiz_options");
  // We can't $unwind on a possibly-missing array, so guard with a $match.
  const pipeline = [
    { $match: { user_id: toOid(userId), item_answers: { $type: "array" } } },
    { $unwind: "$item_answers" },
    { $match: { "item_answers.is_correct": false } },
    { $group: { _id: "$item_answers.item_id", miss_count: { $sum: 1 }, attempts: { $sum: 1 }, last_miss: { $max: "$taken_at" }, question: { $first: "$item_answers.question" }, given_text: { $first: "$item_answers.given_text" }, correct_text: { $first: "$item_answers.correct_text" }, item_type: { $first: "$item_answers.item_type" } } },
    { $sort: { miss_count: -1 } },
    { $limit: limit },
  ];
  const rows = await attemptsC.aggregate(pipeline).toArray();
  // Attach the live quiz title + current correct text (in case the item was edited).
  const itemIds = rows.map(r => toOid(r._id)).filter(Boolean);
  const items = itemIds.length ? await itemsC.find({ _id: { $in: itemIds } }).toArray() : [];
  const itemById = new Map(items.map(i => [i._id.toString(), i]));
  // For MC/TF items, the correct option lives in quiz_options, not on the item.
  // Fetch all correct options for the items in one query.
  const mcItemIds = items.filter(i => i.type === "multiple_choice" || i.type === "true_false").map(i => i._id);
  const correctOptions = mcItemIds.length
    ? await optionsC.find({ item_id: { $in: mcItemIds }, is_correct: true }).toArray()
    : [];
  const correctTextByItem = new Map(correctOptions.map(o => [o.item_id.toString(), o.text]));
  const quizIds = [...new Set(items.map(i => i.quiz_id?.toString()).filter(Boolean))];
  const quizzes = quizIds.length ? await quizzesC.find({ _id: { $in: quizIds.map(toOid) } }).toArray() : [];
  const quizById = new Map(quizzes.map(q => [q._id.toString(), q]));
  return rows.map(r => {
    const item = itemById.get(String(r._id));
    const quiz = item ? quizById.get(item.quiz_id?.toString?.() || "") : null;
    // Prefer the live item's correct text — fall back to the stored breakdown text.
    let correctText = "";
    if (item) {
      if (item.type === "multiple_choice" || item.type === "true_false") {
        // Look up from the options collection (mapped above).
        correctText = correctTextByItem.get(item._id.toString()) || r.correct_text || "";
      } else {
        correctText = item.correct_answer || r.correct_text || "";
      }
    } else {
      correctText = r.correct_text || "";
    }
    return {
      item_id: String(r._id),
      question: item?.question || r.question || "(item removed)",
      item_type: r.item_type || item?.type || "",
      quiz_id: item?.quiz_id?.toString?.() || null,
      quiz_title: quiz?.title || "Quiz",
      miss_count: r.miss_count,
      attempts: r.attempts,
      last_miss: r.last_miss,
      given_text: r.given_text,
      correct_text: correctText,
    };
  });
}
