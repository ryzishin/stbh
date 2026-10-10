// src/controllers/quizzesController.js
import {
  listQuizzes, getQuiz, createQuiz, updateQuiz, deleteQuiz,
  createItem, updateItem, deleteItem, saveOptions,
  recordAttempt, listAttemptsForUser, gradeAttempt,
} from "../services/quizzes.js";
import { awardPointsFallback, bumpStreak, logActivity, computePracticePoints } from "../services/leaderboard.js";
import { col } from "../config/mongo.js";

// ===== Practice quizzes (student view) =====
export async function listPractice(req, res) {
  try {
    const quizzes = await listQuizzes("practice");
    const attempts = await listAttemptsForUser(req.user._id.toString());
    res.render("quizzes/practice", { title: "Practice Quizzes", quizzes, attempts });
  } catch (err) {
    console.error("[listPractice]", err);
    res.status(500).render("error/500", { message: err.message });
  }
}

export async function takePractice(req, res) {
  try {
    const quiz = await getQuiz(req.params.id);
    if (!quiz) return res.status(404).render("error/404");
    let items = quiz.items;
    if (quiz.shuffle_items) items = shuffle(items);
    if (quiz.shuffle_options) {
      items = items.map((it) => ({ ...it, options: it.options ? shuffle(it.options) : it.options }));
    }
    res.render("quizzes/take", { title: quiz.title, quiz, items });
  } catch (err) {
    console.error("[takePractice]", err);
    res.status(500).render("error/500", { message: err.message });
  }
}

export async function submitPractice(req, res) {
  try {
    const quiz = await getQuiz(req.params.id);
    if (!quiz) return res.status(404).render("error/404");
    const answers = req.body.answers || {};
    // Grade server-side and capture per-item breakdown.
    const { score, total, breakdown } = gradeAttempt(quiz.items, answers);
    const durationSec = Number(req.body.durationSec) || 0;
    const attempt = await recordAttempt({
      userId: req.user._id.toString(),
      quizId: quiz.id,
      score, total, durationSec,
      itemAnswers: breakdown,
    });

    const streak = await bumpStreak(req.user._id.toString());
    const pts = await computePracticePoints(score, streak.newStreak);
    await awardPointsFallback(req.user._id.toString(), pts.total);

    // bump practice counter (atomic)
    const profilesC = await col("profiles");
    await profilesC.updateOne(
      { _id: req.user._id },
      { $inc: { practice_quizzes_taken: 1 } }
    );

    await logActivity(req.user._id.toString(), req.user.name, "practice_quiz", `Completed ${quiz.title} — ${score}/${total}`);

    res.render("quizzes/result", {
      title: "Result",
      quiz, score, total, attempt,
      // Per-item breakdown — the quiz definition is shuffled per-attempt, so we
      // use the un-shuffled items to match the breakdown's item_ids. The student
      // sees: their answer + the correct answer for each item.
      breakdown,
      items: quiz.items,
      pointsEarned: pts.total,
      pointsBreakdown: pts,
    });
  } catch (err) {
    console.error("[submitPractice]", err);
    res.status(500).render("error/500", { message: err.message });
  }
}

// ===== Editor (sub-admin / admin) =====
export async function editor(req, res) {
  try {
    const quizzes = await listQuizzes("practice");
    res.render("quizzes/editor", { title: "Edit Practice Quizzes", quizzes, kind: "practice" });
  } catch (err) {
    console.error("[quizzes editor]", err);
    res.status(500).render("error/500", { message: err.message });
  }
}

export async function createQuizPost(req, res) {
  try {
    // Allow kind from body, but clamp to "practice" or "live" only (defensive).
    const kind = req.body.kind === "live" ? "live" : "practice";
    const q = await createQuiz({ ...req.body, kind });
    res.json({ ok: true, quiz: q });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

export async function updateQuizPost(req, res) {
  try {
    const q = await updateQuiz(req.params.id, req.body);
    res.json({ ok: true, quiz: q });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

export async function deleteQuizPost(req, res) {
  try {
    await deleteQuiz(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

export async function createItemPost(req, res) {
  try {
    const payload = sanitizeItemPayload(req.body);
    const errs = validateItemPayload(payload);
    if (errs.length) return res.status(400).json({ ok: false, error: errs.join(" ") });
    const it = await createItem(req.params.quizId, payload);
    res.json({ ok: true, item: it });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

export async function updateItemPost(req, res) {
  try {
    const payload = sanitizeItemPayload(req.body);
    const errs = validateItemPayload(payload);
    if (errs.length) return res.status(400).json({ ok: false, error: errs.join(" ") });
    const { question, image_url, correct_answer, explanation, points, type } = payload;
    const it = await updateItem(req.params.id, { question, image_url, correct_answer, explanation, points, type });
    if (payload.options) await saveOptions(req.params.id, payload.options);
    res.json({ ok: true, item: it });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

export async function deleteItemPost(req, res) {
  try {
    await deleteItem(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

// ===== Helpers =====
function sanitizeItemPayload(body) {
  const out = { ...body };
  if (out.points !== undefined && out.points !== null && out.points !== "") {
    let pts = Number(out.points);
    if (!Number.isFinite(pts)) pts = 1;
    pts = Math.max(1, Math.min(10, Math.round(pts)));
    out.points = pts;
  }
  if (out.question !== undefined) out.question = String(out.question || "").trim();
  if (out.image_url === "") out.image_url = null;
  if (out.correct_answer === "") out.correct_answer = null;
  if (out.explanation === "") out.explanation = null;
  if (Array.isArray(out.options)) {
    out.options = out.options
      .map(o => ({
        text: String(o.text || "").trim(),
        image_url: o.image_url ? String(o.image_url) : null,
        is_correct: !!o.is_correct,
      }))
      .filter(o => o.text.length > 0);
  }
  return out;
}

function validateItemPayload(p) {
  const errs = [];
  if (!p.question) errs.push("Question is required.");
  if (p.type === "multiple_choice" || p.type === "true_false") {
    if (!Array.isArray(p.options) || p.options.length < 2) errs.push("Multiple choice needs at least 2 options.");
    else if (!p.options.some(o => o.is_correct)) errs.push("Mark one option as correct.");
  }
  return errs;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
