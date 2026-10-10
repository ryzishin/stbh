// src/controllers/pagesController.js
import { ObjectId } from "mongodb";
import { getLeaderboard, getRecentActivity } from "../services/leaderboard.js";
import { getActiveLiveSession } from "../services/quizzes.js";
import { listUnits, getUnit } from "../services/notes.js";
import { listFlashcards, getDueCards, getSrsSummary } from "../services/flashcards.js";
import { listQuizzes, listAttemptsForUser } from "../services/quizzes.js";
import { col } from "../config/mongo.js";

function toOid(id) {
  if (!id) return null;
  if (id instanceof ObjectId) return id;
  try { return new ObjectId(String(id)); } catch { return null; }
}

export async function leaderboard(req, res) {
  try {
    const weekly = await getLeaderboard("weekly");
    const alltime = await getLeaderboard("alltime");
    res.render("leaderboard", { title: "Leaderboard", weekly, alltime });
  } catch (err) {
    console.error("[pages leaderboard]", err);
    res.status(500).render("error/500", { message: err.message });
  }
}

// ===== Classmates — now with streak / last-seen / 7-day sparkline per row =====
export async function classmates(req, res) {
  try {
    const profilesC = await col("profiles");
    const attemptsC = await col("quiz_attempts");
    const projection = { projection: { password_hash: 0, email: 0, must_change_password: 0 } };
    const students = await profilesC
      .find({ role: { $ne: "admin" } }, projection)
      .sort({ name: 1 })
      .toArray();

    // Build a 7-day sparkline for each student based on quiz_attempts.
    // (Quiz attempts are the highest-signal activity per day; flashcard reviews
    // also exist but we keep this single-source for simplicity.)
    const sevenDaysAgo = new Date(Date.now() - 6 * 86400000);
    sevenDaysAgo.setHours(0, 0, 0, 0);
    const studentIds = students.map(s => s._id);
    const attemptsByDay = new Map(); // userId -> [7 ints]
    if (studentIds.length > 0) {
      const pipeline = [
        { $match: { user_id: { $in: studentIds }, taken_at: { $gte: sevenDaysAgo } } },
        { $group: { _id: { uid: "$user_id", day: { $dateToString: { format: "%Y-%m-%d", date: "$taken_at" } } }, count: { $sum: 1 } } },
      ];
      const agg = await attemptsC.aggregate(pipeline).toArray();
      for (const row of agg) {
        const uidStr = row._id.uid.toString();
        if (!attemptsByDay.has(uidStr)) attemptsByDay.set(uidStr, new Array(7).fill(0));
        const dayStr = row._id.day;
        const dayDate = new Date(dayStr + "T00:00:00");
        const dayDiff = Math.floor((dayDate - sevenDaysAgo) / 86400000);
        if (dayDiff >= 0 && dayDiff < 7) attemptsByDay.get(uidStr)[dayDiff] = row.count;
      }
    }

    // Compute last_seen from last_active_date.
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const studentsEnriched = students.map(s => {
      const lastSeen = s.last_active_date || null;
      let lastSeenLabel = "—";
      if (lastSeen === today) lastSeenLabel = "today";
      else if (lastSeen === yesterday) lastSeenLabel = "yesterday";
      else if (lastSeen) {
        const d = new Date(lastSeen + "T00:00:00");
        const days = Math.floor((Date.now() - d.getTime()) / 86400000);
        if (days < 7) lastSeenLabel = `${days}d ago`;
        else if (days < 30) lastSeenLabel = `${Math.floor(days / 7)}w ago`;
        else lastSeenLabel = new Date(lastSeen).toLocaleDateString();
      }
      const spark = attemptsByDay.get(s._id.toString()) || new Array(7).fill(0);
      return {
        ...s,
        id: s._id.toString(),
        lastSeenLabel,
        sparkline: spark,
        weekly_points: s.weekly_points || 0,
        streak_days: s.streak_days || 0,
      };
    });

    const adviser = await profilesC.findOne({ role: "admin" }, projection);
    res.render("classmates", { title: "Classmates", students: studentsEnriched, adviser });
  } catch (err) {
    console.error("[pages classmates]", err);
    res.status(500).render("error/500", { message: err.message });
  }
}

// ===== Today view (student) — daily landing page =====
// Pulls from spaced-rep queue, recently-updated notes, quizzes not yet tried,
// and the active live session.
export async function today(req, res) {
  try {
    const userId = req.user._id.toString();
    const lastActiveDate = req.user.last_active_date || null;

    // 1. Spaced-rep summary + due cards (limited preview)
    const srs = await getSrsSummary(userId);
    const duePreview = (await getDueCards(userId)).slice(0, 5);

    // 2. Recently-updated notes (since last_active_date)
    const units = await listUnits();
    let newNotes = [];
    if (lastActiveDate) {
      newNotes = units.filter(u => (u.updated_at || "") >= lastActiveDate && (u.parts || []).length > 0);
    } else {
      // First-time user — show all units as "new"
      newNotes = units.slice(0, 3);
    }

    // 3. Quizzes the student hasn't tried yet
    const practiceQuizzes = await listQuizzes("practice");
    const attempts = await listAttemptsForUser(userId);
    const attemptedQuizIds = new Set(attempts.map(a => a.quiz_id?.toString()));
    const untriedQuizzes = practiceQuizzes.filter(q => !attemptedQuizIds.has(q.id)).slice(0, 3);

    // 4. Active live session (if any)
    const activeSession = await getActiveLiveSession();

    res.render("today", {
      title: "Today",
      srs,
      duePreview,
      newNotes,
      untriedQuizzes,
      activeSession,
      streakDays: req.user.streak_days || 0,
      lastActiveDate,
    });
  } catch (err) {
    console.error("[pages today]", err);
    res.status(500).render("error/500", { message: err.message });
  }
}

// ===== Global search =====
// GET /search?q=<query>  OR  GET /api/search?q=<query>
// Searches across: units (title/description), content_blocks (text/items),
// flashcards (front/back), quiz_items (question).
// Returns HTML page (for /search) or JSON (for /api/search).
// Ranked by recency. 30 per type max.
export async function search(req, res) {
  const q = (req.query.q || "").trim();
  const isApi = req.path.startsWith("/api/");
  if (!q) {
    if (isApi) return res.json({ ok: true, query: "", groups: {} });
    return res.render("search", { title: "Search", query: "", groups: {} });
  }

  try {
    const results = await runSearch(q, req.user?._id?.toString?.() || null);
    if (isApi) return res.json({ ok: true, query: q, groups: results });
    res.render("search", { title: `Search: ${q}`, query: q, groups: results });
  } catch (err) {
    console.error("[search]", err);
    if (isApi) return res.status(500).json({ ok: false, error: err.message });
    res.status(500).render("error/500", { message: err.message });
  }
}

// Internal: actual search logic. Returns { units, parts, cards, quiz_items }
async function runSearch(query, _userId) {
  const safeQuery = String(query).slice(0, 100);
  // Escape regex special chars.
  const escaped = safeQuery.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  const rx = new RegExp(escaped, "i");
  const unitsC = await col("units");
  const blocksC = await col("content_blocks");
  const fcC = await col("flashcards");
  const itemsC = await col("quiz_items");
  const partsC = await col("parts");

  const [units, blocks, cards, items] = await Promise.all([
    unitsC.find({ $or: [{ title: rx }, { description: rx }] }).sort({ updated_at: -1 }).limit(30).toArray(),
    blocksC.find({ $or: [
      { text: rx },
      { items: rx },
      { caption: rx },
    ] }).sort({ created_at: -1 }).limit(30).toArray(),
    fcC.find({ $or: [{ front: rx }, { back: rx }] }).sort({ created_at: -1 }).limit(30).toArray(),
    itemsC.find({ question: rx }).sort({ created_at: -1 }).limit(30).toArray(),
  ]);

  // Attach parts (and their parent units) to blocks so we can link to them.
  const partIds = [...new Set(blocks.map(b => b.part_id?.toString()).filter(Boolean))];
  const parts = partIds.length ? await partsC.find({ _id: { $in: partIds.map(toOid) } }).toArray() : [];
  const partById = new Map(parts.map(p => [p._id.toString(), p]));
  const unitIds = [...new Set(parts.map(p => p.unit_id?.toString()).filter(Boolean))];
  const parentUnits = unitIds.length ? await unitsC.find({ _id: { $in: unitIds.map(toOid) } }).toArray() : [];
  const unitByPartUnit = new Map(parentUnits.map(u => [u._id.toString(), u]));

  const blockResults = blocks.map(b => {
    const part = partById.get(b.part_id?.toString());
    const unit = part ? unitByPartUnit.get(part.unit_id?.toString()) : null;
    return {
      id: b._id.toString(),
      kind: b.kind,
      text: b.text || (b.items || []).join(" / ") || b.caption || b.url || "",
      unit_slug: unit?.slug,
      unit_title: unit?.title,
      part_id: part?._id?.toString(),
      part_title: part?.title,
    };
  });

  // Quiz items → also need quiz_id to link.
  const quizIds = [...new Set(items.map(i => i.quiz_id?.toString()).filter(Boolean))];
  const quizzesC = await col("quizzes");
  const quizzes = quizIds.length ? await quizzesC.find({ _id: { $in: quizIds.map(toOid) } }).toArray() : [];
  const quizById = new Map(quizzes.map(q => [q._id.toString(), q]));

  const itemResults = items.map(i => {
    const quiz = quizById.get(i.quiz_id?.toString());
    return {
      id: i._id.toString(),
      question: i.question,
      type: i.type,
      quiz_id: i.quiz_id?.toString(),
      quiz_title: quiz?.title || "Quiz",
    };
  });

  return {
    units: units.map(u => ({ id: u._id.toString(), title: u.title, slug: u.slug, description: u.description, number: u.number })),
    blocks: blockResults,
    cards: cards.map(c => ({ id: c._id.toString(), front: c.front, back: c.back })),
    quiz_items: itemResults,
  };
}
