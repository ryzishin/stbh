// Flashcards editor
// All dialogs go through toast / confirmToast / promptToast (no native alert/confirm/prompt).
// Features: single card edit, duplicate card, bulk-add mode (paste many cards at once).
let editingCard = null;
let cardModalDirty = false;
let bulkModalDirty = false;

document.addEventListener('DOMContentLoaded', () => {
  // ===== Single card =====
  document.getElementById('new-card-btn')?.addEventListener('click', () => openCardModal(null));
  document.getElementById('card-close')?.addEventListener('click', () => maybeCloseCardModal());
  document.getElementById('card-cancel')?.addEventListener('click', () => maybeCloseCardModal());

  document.querySelectorAll('.edit-card').forEach(b => b.addEventListener('click', () => {
    const card = JSON.parse(b.dataset.card);
    openCardModal(card);
  }));

  // ===== Duplicate card =====
  document.querySelectorAll('.duplicate-card').forEach(b => b.addEventListener('click', async () => {
    const card = JSON.parse(b.dataset.card);
    // Open the card modal pre-filled with the duplicate's data — the user can tweak before saving.
    openCardModal({ ...card, id: null });
    toast.info('Card duplicated — review and save.');
  }));

  // ===== Delete card =====
  document.querySelectorAll('.delete-card').forEach(b => b.addEventListener('click', async () => {
    const ok = await confirmToast({
      title: 'Delete this card?',
      message: 'This will permanently remove the flashcard.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      danger: true,
    });
    if (!ok) return;
    const r = await fetch(`/api/flashcards/${b.dataset.cardId}`, { method: 'DELETE' });
    if (r.ok) {
      toast.success('Card deleted.');
      location.reload();
    } else {
      const d = await r.json().catch(() => ({}));
      toast.error(d.error || 'Failed to delete card.');
    }
  }));

  // ===== Save single card =====
  document.getElementById('card-save')?.addEventListener('click', async () => {
    const body = {
      front: document.getElementById('card-front').value,
      back: document.getElementById('card-back').value,
      unit_id: document.getElementById('card-unit').value || null,
    };
    if (!body.front.trim() || !body.back.trim()) {
      toast.warn('Both fields are required.');
      return;
    }
    const url = editingCard ? `/api/flashcards/${editingCard.id}` : '/api/flashcards';
    const method = editingCard ? 'PATCH' : 'POST';
    try {
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (r.ok) {
        toast.success(editingCard ? 'Card updated.' : 'Card created.');
        location.reload();
      } else {
        const d = await r.json().catch(() => ({}));
        toast.error(d.error || 'Failed to save card.');
      }
    } catch (err) {
      toast.error('Network error — please try again.');
    }
  });

  ['card-front', 'card-back', 'card-unit'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => { cardModalDirty = true; });
  });

  // ===== Bulk add =====
  document.getElementById('bulk-card-btn')?.addEventListener('click', () => openBulkModal());
  document.getElementById('bulk-close')?.addEventListener('click', () => maybeCloseBulkModal());
  document.getElementById('bulk-cancel')?.addEventListener('click', () => maybeCloseBulkModal());
  document.getElementById('bulk-input')?.addEventListener('input', () => { bulkModalDirty = true; updateBulkPreview(); });
  document.getElementById('bulk-unit')?.addEventListener('change', updateBulkPreview);

  document.getElementById('bulk-save')?.addEventListener('click', async () => {
    const result = parseBulkInput();
    const cards = result.cards;
    if (cards.length === 0) {
      toast.warn('No valid cards found. Try the formats shown below the textarea.');
      return;
    }
    const ok = await confirmToast({
      title: `Create ${cards.length} card${cards.length === 1 ? '' : 's'}?`,
      message: `Detected format: ${formatBadgeLabel(result.format)}. You can edit them individually afterwards.`,
      confirmText: `Create ${cards.length} card${cards.length === 1 ? '' : 's'}`,
      cancelText: 'Cancel',
    });
    if (!ok) return;
    try {
      const r = await fetch('/api/flashcards/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cards }),
      });
      if (r.ok) {
        const d = await r.json();
        toast.success(`Created ${d.created} card${d.created === 1 ? '' : 's'}.`);
        location.reload();
      } else {
        const d = await r.json().catch(() => ({}));
        toast.error(d.error || 'Bulk create failed.');
      }
    } catch (err) {
      toast.error('Network error — please try again.');
    }
  });

  // ===== ESC closes =====
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const modal = document.getElementById('card-modal');
    const bulk = document.getElementById('bulk-modal');
    if (modal && !modal.classList.contains('hidden')) maybeCloseCardModal();
    else if (bulk && !bulk.classList.contains('hidden')) maybeCloseBulkModal();
  });
});

async function maybeCloseCardModal() {
  if (cardModalDirty) {
    const ok = await confirmToast({
      title: 'Discard changes?',
      message: 'You have unsaved edits to this card. Discard them and close?',
      confirmText: 'Discard & close',
      cancelText: 'Keep editing',
      danger: true,
    });
    if (!ok) return;
  }
  document.getElementById('card-modal').classList.add('hidden');
  cardModalDirty = false;
}

async function maybeCloseBulkModal() {
  if (bulkModalDirty) {
    const ok = await confirmToast({
      title: 'Discard bulk input?',
      message: 'You have unsaved text in the bulk-add box. Discard it and close?',
      confirmText: 'Discard & close',
      cancelText: 'Keep editing',
      danger: true,
    });
    if (!ok) return;
  }
  document.getElementById('bulk-modal').classList.add('hidden');
  bulkModalDirty = false;
}

function openCardModal(card) {
  editingCard = card && card.id ? card : null;
  cardModalDirty = false;
  document.getElementById('card-modal-title').textContent = editingCard ? 'Edit flashcard' : (card && !card.id ? 'Duplicate flashcard' : 'New flashcard');
  document.getElementById('card-front').value = card ? card.front : '';
  document.getElementById('card-back').value = card ? card.back : '';
  document.getElementById('card-unit').value = card && card.unit_id ? card.unit_id : '';
  document.getElementById('card-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('card-front')?.focus(), 50);
}

function openBulkModal() {
  bulkModalDirty = false;
  document.getElementById('bulk-input').value = '';
  document.getElementById('bulk-modal').classList.remove('hidden');
  updateBulkPreview();
  setTimeout(() => document.getElementById('bulk-input')?.focus(), 50);
}

// Parse the bulk input into [{ front, back, unit_id? }, ...].
//
// Supports three input formats (auto-detected):
//   1. Pipe-separated: `front|back` (one per line). Legacy format.
//      Also accepts 3-col `Unit Name|front|back`.
//   2. Tab-separated: `front\tback` (Quizlet / Anki "Import" default).
//   3. Term/Definition pairs: alternating lines, separated by blank lines:
//        Term 1
//        Definition 1
//
//        Term 2
//        Definition 2
//      This is Quizlet's "Copy this set" → paste format on some platforms.
//
// Lines starting with `#` are treated as comments and skipped.
// Returns { cards, format, linesDetected } so the UI can show which
// format was detected.
function parseBulkInput() {
  const text = document.getElementById('bulk-input')?.value || '';
  const defaultUnit = document.getElementById('bulk-unit')?.value || null;
  const lines = text.split('\n');
  const cards = [];

  // Detect format: check if any non-comment, non-empty line has a tab.
  const sampleLines = lines
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));
  if (sampleLines.length === 0) {
    return { cards: [], format: 'empty', linesDetected: 0 };
  }
  const hasTabs = sampleLines.some(l => l.includes('\t'));
  const hasPipes = sampleLines.some(l => l.includes('|'));
  // Pair format: count blank-line-separated groups with exactly 2 lines each.
  const groups = text.split(/\n\s*\n/).map(g => g.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')));
  const pairShaped = groups.length >= 2 && groups.every(g => g.length === 2) && !hasTabs && !hasPipes;

  let format = 'pipe';
  if (hasTabs) format = 'tab';
  else if (pairShaped) format = 'pair';

  if (format === 'pair') {
    for (const g of groups) {
      if (g.length === 2) {
        const [front, back] = g;
        if (front && back) cards.push({ front, back, unit_id: defaultUnit });
      }
    }
  } else if (format === 'tab') {
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const parts = trimmed.split('\t').map(s => s.trim());
      if (parts.length < 2) continue;
      if (parts.length === 2) {
        const [front, back] = parts;
        if (front && back) cards.push({ front, back, unit_id: defaultUnit });
      } else {
        // 3+ tab-separated cols: first is front, rest joined as back.
        // (Anki decks sometimes export Front[TAB]Back[TAB]Tags — we drop tags.)
        const [front, ...rest] = parts;
        const back = rest.join(' / ');
        if (front && back) cards.push({ front, back, unit_id: defaultUnit });
      }
    }
  } else {
    // Pipe format (legacy)
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const parts = trimmed.split('|').map(s => s.trim());
      if (parts.length < 2) continue;
      if (parts.length === 2) {
        const [front, back] = parts;
        if (!front || !back) continue;
        cards.push({ front, back, unit_id: defaultUnit });
      } else {
        // 3+ pipe-separated cols: first is unit name (we ignore it client-side,
        // server uses unit_id), second is front, third+ joined as back.
        const [, front, ...rest] = parts;
        const back = rest.join(' | ');
        if (!front || !back) continue;
        cards.push({ front, back, unit_id: defaultUnit });
      }
    }
  }
  return { cards, format, linesDetected: sampleLines.length };
}

function formatBadgeLabel(format) {
  if (format === 'tab') return 'Tab-separated (Quizlet/Anki)';
  if (format === 'pair') return 'Term/Definition pairs';
  if (format === 'pipe') return 'Pipe-separated (front|back)';
  return 'No cards yet';
}

function updateBulkPreview() {
  const result = parseBulkInput();
  const preview = document.getElementById('bulk-preview');
  if (!preview) return;
  // Re-render the format badge + card count.
  const badgeCls = result.format === 'empty' || result.format === 'unknown' ? 'bulk-format-badge unknown' : 'bulk-format-badge';
  preview.innerHTML = `
    <span class="${badgeCls}">${formatBadgeLabel(result.format)}</span>
    ${result.cards.length > 0 ? `<span class="muted tiny" style="margin-left:0.5rem;">${result.cards.length} card${result.cards.length === 1 ? '' : 's'} will be created.</span>` : ''}
  `;
}
