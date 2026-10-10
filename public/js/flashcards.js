// Flashcards view — SM-2 spaced repetition
// 4-button rating UI (Again / Hard / Good / Easy). Cards come pre-sorted by the
// server: due first (oldest next-review-at first), then non-due.
(function() {
  const cards = window.__FLASHCARDS__ || [];
  if (cards.length === 0) return;
  let idx = 0;
  let ratedThisSession = new Set(); // (cardId) — for "already rated" UX
  const front = document.getElementById('card-front');
  const back = document.getElementById('card-back');
  const counter = document.getElementById('card-counter');
  const scheduleLine = document.getElementById('card-schedule');
  const card = document.getElementById('flashcard');
  const preFlip = document.getElementById('pre-flip-controls');
  const ratingControls = document.getElementById('rating-controls');

  function isFlipped() { return card.classList.contains('flipped'); }
  function setFlipped(f) { card.classList.toggle('flipped', !!f); }

  function describeSchedule(c) {
    if (!c.srs) return 'New card — first review.';
    const parts = [];
    parts.push(`${c.repetitions || 0} review${(c.repetitions || 0) === 1 ? '' : 's'}`);
    parts.push(`ease ${(c.ease || 2.5).toFixed(2)}`);
    if (c.due) {
      if (c.next_review_at) {
        // Show how overdue.
        const ms = Date.now() - new Date(c.next_review_at).getTime();
        const days = Math.floor(ms / 86400000);
        const hrs = Math.floor(ms / 3600000);
        if (days >= 1) parts.push(`${days}d overdue`);
        else if (hrs >= 1) parts.push(`${hrs}h overdue`);
        else parts.push('due now');
      } else {
        parts.push('due now');
      }
    } else if (c.next_review_at) {
      const ms = new Date(c.next_review_at).getTime() - Date.now();
      const days = Math.floor(ms / 86400000);
      const hrs = Math.floor(ms / 3600000);
      if (days >= 1) parts.push(`next in ${days}d`);
      else if (hrs >= 1) parts.push(`next in ${hrs}h`);
      else parts.push('soon');
    }
    return parts.join(' · ');
  }

  function render() {
    const c = cards[idx];
    front.textContent = c.front;
    back.textContent = c.back;
    counter.textContent = `Card ${idx + 1} of ${cards.length}`;
    if (scheduleLine) {
      scheduleLine.textContent = describeSchedule(c);
      scheduleLine.classList.toggle('hidden', false);
    }
    setFlipped(false);
    preFlip.classList.remove('hidden');
    ratingControls.classList.add('hidden');
  }

  function showRatingControls() {
    preFlip.classList.add('hidden');
    ratingControls.classList.remove('hidden');
  }

  card.addEventListener('click', () => {
    setFlipped(!isFlipped());
    if (isFlipped()) showRatingControls();
  });
  document.getElementById('flip-card').addEventListener('click', (e) => {
    e.stopPropagation();
    setFlipped(true);
    showRatingControls();
  });
  document.getElementById('prev-card').addEventListener('click', (e) => {
    e.stopPropagation();
    if (idx > 0) { idx--; render(); }
  });
  document.getElementById('next-card').addEventListener('click', (e) => {
    e.stopPropagation();
    if (idx < cards.length - 1) { idx++; render(); }
  });

  // Rate the current card. rating ∈ {again, hard, good, easy}.
  async function rate(rating) {
    const c = cards[idx];
    if (!c) return;
    try {
      const r = await fetch('/flashcards/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId: c.id, rating }),
      });
      const d = await r.json().catch(() => ({}));
      if (d.ok) {
        ratedThisSession.add(c.id);
        const srs = d.srs || {};
        const interval = srs.interval_days;
        let msg = '+';
        msg += (d.awarded || 0) + ' pts';
        if (rating === 'again') msg = `See again soon. ${msg}`;
        else if (interval === 0) msg = `Coming up next. ${msg}`;
        else if (interval === 1) msg = `Tomorrow. ${msg}`;
        else msg = `Next in ${interval}d. ${msg}`;
        toast.success(msg);
        // Update the in-memory card with new SRS state.
        c.srs = { ease: srs.ease, repetitions: srs.repetitions, next_review_at: srs.next_review_at };
        c.ease = srs.ease;
        c.repetitions = srs.repetitions;
        c.next_review_at = srs.next_review_at;
        c.due = false;
        // Move to next card (or wrap to the front for "again" cards).
        setTimeout(() => {
          if (rating === 'again' && idx < cards.length - 1) {
            // Push the "again" card to the end of the due queue so it re-shows this session.
            cards.splice(idx + 1, 0, cards.splice(idx, 1)[0]);
            // Re-render the (now-next) card.
            render();
          } else if (idx < cards.length - 1) {
            idx++;
            render();
          } else {
            // End of deck.
            const due = cards.filter(x => x.due).length;
            if (due > 0) {
              toast.info(`${due} card${due === 1 ? '' : 's'} still due — review them again.`);
              // Find next due card and jump to it.
              const nextDueIdx = cards.findIndex(x => x.due);
              if (nextDueIdx >= 0) { idx = nextDueIdx; render(); }
            } else {
              toast.success('Deck complete. Nice work.');
              card.style.opacity = '0.55';
              counter.textContent = '✓ All caught up';
            }
          }
        }, 250);
      } else {
        toast.error(d.error || 'Could not save rating.');
      }
    } catch (err) {
      toast.error('Network error — please try again.');
    }
  }

  ratingControls.querySelectorAll('button[data-rating]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      rate(btn.dataset.rating);
    });
  });

  // Keyboard shortcuts: Space to flip, 1-4 to rate when flipped, J/K prev/next.
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === ' ') { e.preventDefault(); card.click(); }
    else if (e.key === 'j' || e.key === 'ArrowLeft') { document.getElementById('prev-card').click(); }
    else if (e.key === 'k' || e.key === 'ArrowRight') { document.getElementById('next-card').click(); }
    else if (isFlipped() && ['1', '2', '3', '4'].includes(e.key)) {
      const map = { '1': 'again', '2': 'hard', '3': 'good', '4': 'easy' };
      rate(map[e.key]);
    }
  });

  render();
})();
