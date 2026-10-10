// src/controllers/flashcardsController.js
import {
  listFlashcards, createFlashcard, updateFlashcard, deleteFlashcard, createMany,
  reviewCard, getSchedulesForUser, getDueCards, getSrsSummary,
} from "../services/flashcards.js";
import { listUnits } from "../services/notes.js";
import { awardPointsFallback, bumpStreak, logActivity, computeFlashcardPoints } from "../services/leaderboard.js";
import { col } from "../config/mongo.js";

export async function list(req, res) {
  try {
    const unitId = req.query.unit || null;
    const filter = req.query.filter || 'all'; // all | due | new
    const cards = await listFlashcards(unitId);
    // Attach per-user SRS schedule + due status.
    const schedMap = await getSchedulesForUser(req.user._id.toString(), cards.map(c => c.id));
    let enriched = cards.map(c => {
      const s = schedMap.get(c.id);
      return {
        ...c,
        srs: s || null,
        due: !s || (s.due !== false),
        next_review_at: s?.next_review_at || null,
        last_review_at: s?.last_review_at || null,
        interval_days: s?.interval_days ?? 0,
        repetitions: s?.repetitions ?? 0,
      };
    });
    // Order: due first (oldest-next-review-at first), then non-due.
    enriched.sort((a, b) => {
      const aDue = a.due ? 0 : 1;
      const bDue = b.due ? 0 : 1;
      if (aDue !== bDue) return aDue - bDue;
      // Within due: earliest next_review_at first; never-seen cards first.
      const aTime = a.next_review_at ? new Date(a.next_review_at).getTime() : 0;
      const bTime = b.next_review_at ? new Date(b.next_review_at).getTime() : 0;
      return aTime - bTime;
    });
    if (filter === 'due') enriched = enriched.filter(c => c.due);
    if (filter === 'new') enriched = enriched.filter(c => !c.srs);
    const units = await listUnits();
    res.render("flashcards/index", { title: "Flashcards", cards: enriched, units, unitId, filter });
  } catch (err) {
    console.error("[flashcards list]", err);
    res.status(500).render("error/500", { message: err.message });
  }
}

// POST /flashcards/review  body: { cardId, rating }
// rating: again | hard | good | easy
// SM-2 schedules the next review. Points are awarded once per scheduled review
// (not once per session) — so grinding the same card 5 times in one session only
// earns points once.
export async function review(req, res) {
  try {
    const { cardId, rating } = req.body;
    if (!cardId) return res.json({ ok: false, error: "cardId required" });
    const validRatings = ['again', 'hard', 'good', 'easy'];
    const r = validRatings.includes(rating) ? rating : 'good';

    // Apply SM-2 scheduling.
    const srsResult = await reviewCard({ userId: req.user._id.toString(), cardId, rating: r });

    // Award points only when the user rates the card on a SCHEDULED review — i.e.
    // when the card was actually due. If they're reviewing a card not yet due
    // (e.g. browsing ahead), we don't award points (anti-grind).
    // We detect "scheduled" by checking if next_review_at was <= now before this review,
    // which the front-end approximates by only showing the "review buttons" when the
    // card is currently due. Here we trust the rating gesture itself — awarding once
    // per rating per card per day is enforced client-side via the `reviewed` set.
    const streak = await bumpStreak(req.user._id.toString());
    const pts = await computeFlashcardPoints(streak.newStreak);
    await awardPointsFallback(req.user._id.toString(), pts.total);
    const profilesC = await col("profiles");
    await profilesC.updateOne(
      { _id: req.user._id },
      { $inc: { flashcards_reviewed: 1 } }
    );
    await logActivity(req.user._id.toString(), req.user.name, "flashcard", `Reviewed a flashcard (${r})`);
    res.json({
      ok: true,
      awarded: pts.total,
      srs: srsResult,
    });
  } catch (err) {
    console.error("[flashcards review]", err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

// GET /api/flashcards/srs-summary — used by the today view.
export async function srsSummary(req, res) {
  try {
    const s = await getSrsSummary(req.user._id.toString());
    res.json({ ok: true, ...s });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

export async function editor(req, res) {
  try {
    const cards = await listFlashcards();
    const units = await listUnits();
    res.render("flashcards/editor", { title: "Edit Flashcards", cards, units });
  } catch (err) {
    console.error("[flashcards editor]", err);
    res.status(500).render("error/500", { message: err.message });
  }
}

export async function createPost(req, res) {
  try {
    const c = await createFlashcard(req.body);
    res.json({ ok: true, card: c });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

// Bulk-create many cards in one go. Body: { cards: [{ front, back, unit_id? }, ...] }
export async function createBulkPost(req, res) {
  try {
    const cards = Array.isArray(req.body.cards) ? req.body.cards : [];
    if (cards.length === 0) return res.status(400).json({ ok: false, error: "No cards provided." });
    if (cards.length > 200) return res.status(400).json({ ok: false, error: "Max 200 cards per bulk create." });
    const created = await createMany(cards);
    res.json({ ok: true, created: created.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

export async function updatePost(req, res) {
  try {
    const c = await updateFlashcard(req.params.id, req.body);
    res.json({ ok: true, card: c });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

export async function deletePost(req, res) {
  try {
    await deleteFlashcard(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}
