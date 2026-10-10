// Quizzes editor — items + options.
// All dialogs go through toast / confirmToast / promptToast (no native alert/confirm/prompt).
// Includes: image upload for question image + per-option image URL, dirty-check,
//           validation (>= 2 options, one correct, all options have text), points clamping.
let currentQuizId = null;
let editingItem = null;
let itemModalDirty = false;

document.addEventListener('DOMContentLoaded', () => {
  // ===== New quiz (prompt → toast-style modal) =====
  document.getElementById('new-quiz-btn')?.addEventListener('click', async () => {
    const kind = window.__QUIZ_KIND__ || 'practice';
    const title = await promptToast({
      title: kind === 'live' ? 'New live test' : 'New quiz',
      message: kind === 'live'
        ? 'Give your new live test a title. Students will see it when you host a session.'
        : 'Give your new quiz a title.',
      placeholder: kind === 'live'
        ? 'e.g. Quarter 1 — Live Test'
        : 'e.g. Unit 3 — Cellular Respiration',
      confirmText: kind === 'live' ? 'Create live test' : 'Create quiz',
      required: true,
    });
    if (title === null) return;
    const r = await fetch('/api/quizzes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title.trim(), description: '', kind }),
    });
    if (r.ok) {
      toast.success(kind === 'live' ? 'Live test created.' : 'Quiz created.');
      location.reload();
    } else {
      const d = await r.json().catch(() => ({}));
      toast.error(d.error || 'Failed to create.');
    }
  });

  // ===== Make the whole item row clickable to open the editor =====
  document.querySelectorAll('.item-row.clickable').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('button, a, input, .item-actions')) return;
      const btn = row.querySelector('.edit-item-btn');
      if (!btn) return;
      const item = JSON.parse(btn.dataset.item);
      openItemModal(btn.dataset.quizId, item);
    });
  });

  document.querySelectorAll('.add-item-btn').forEach(b => b.addEventListener('click', () => openItemModal(b.dataset.quizId, null)));
  document.querySelectorAll('.edit-item-btn').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const item = JSON.parse(b.dataset.item);
    openItemModal(b.dataset.quizId, item);
  }));

  document.querySelectorAll('.delete-item-btn').forEach(b => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    const ok = await confirmToast({
      title: 'Delete this item?',
      message: 'This will permanently remove the question and all of its options. This cannot be undone.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      danger: true,
    });
    if (!ok) return;
    const r = await fetch(`/api/quizzes/items/${b.dataset.itemId}`, { method: 'DELETE' });
    if (r.ok) {
      toast.success('Item deleted.');
      location.reload();
    } else {
      const d = await r.json().catch(() => ({}));
      toast.error(d.error || 'Failed to delete item.');
    }
  }));

  document.querySelectorAll('.delete-quiz-btn').forEach(b => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    const ok = await confirmToast({
      title: 'Delete this quiz?',
      message: 'This will permanently remove the quiz and ALL of its items and options. This cannot be undone.',
      confirmText: 'Delete quiz',
      cancelText: 'Cancel',
      danger: true,
    });
    if (!ok) return;
    const r = await fetch(`/api/quizzes/${b.dataset.quizId}`, { method: 'DELETE' });
    if (r.ok) {
      toast.success('Quiz deleted.');
      location.reload();
    } else {
      const d = await r.json().catch(() => ({}));
      toast.error(d.error || 'Failed to delete quiz.');
    }
  }));

  document.getElementById('item-close')?.addEventListener('click', () => maybeCloseItemModal());
  document.getElementById('item-cancel')?.addEventListener('click', () => maybeCloseItemModal());
  document.getElementById('item-save')?.addEventListener('click', saveItem);
  document.getElementById('add-option-btn')?.addEventListener('click', () => addOptionRow('', false, ''));
  document.getElementById('item-type')?.addEventListener('change', () => { markItemModalDirty(); syncTypeFields(); });

  // ===== Image upload for the question image =====
  setupImageUpload('item-image-upload-btn', 'item-image-file', 'item-image', 'item-image-preview');

  // Track edits inside the item modal so we can warn on close
  ['item-question', 'item-image', 'item-points', 'item-answer', 'item-explanation'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', markItemModalDirty);
  });

  // ===== Edit quiz metadata =====
  document.querySelectorAll('.edit-quiz-btn').forEach(b => b.addEventListener('click', () => {
    const q = JSON.parse(b.dataset.quiz);
    document.getElementById('eq-id').value = q.id;
    document.getElementById('eq-title').value = q.title || '';
    document.getElementById('eq-desc').value = q.description || '';
    document.getElementById('eq-tl').value = q.time_limit_min || '';
    if (q.deadline) {
      document.getElementById('eq-dl').value = q.deadline.slice(0, 16);
    } else {
      document.getElementById('eq-dl').value = '';
    }
    document.getElementById('edit-quiz-modal').classList.remove('hidden');
    eqModalDirty = false;
  }));
  document.getElementById('eq-close')?.addEventListener('click', () => maybeCloseEqModal());
  document.getElementById('eq-cancel')?.addEventListener('click', () => maybeCloseEqModal());
  ['eq-title', 'eq-desc', 'eq-tl', 'eq-dl'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => { eqModalDirty = true; });
  });
  document.getElementById('eq-save')?.addEventListener('click', async () => {
    const id = document.getElementById('eq-id').value;
    const body = {
      title: document.getElementById('eq-title').value,
      description: document.getElementById('eq-desc').value,
      time_limit_min: document.getElementById('eq-tl').value ? Number(document.getElementById('eq-tl').value) : null,
      deadline: document.getElementById('eq-dl').value ? document.getElementById('eq-dl').value + ':00' : null,
    };
    const r = await fetch(`/api/quizzes/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.ok) {
      toast.success('Quiz saved.');
      location.reload();
    } else {
      const d = await r.json().catch(() => ({}));
      toast.error(d.error || 'Failed to save quiz.');
    }
  });

  // ===== ESC closes any open modal (with dirty-check) =====
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const itemModal = document.getElementById('item-modal');
    const eqModal = document.getElementById('edit-quiz-modal');
    if (itemModal && !itemModal.classList.contains('hidden')) {
      maybeCloseItemModal();
    } else if (eqModal && !eqModal.classList.contains('hidden')) {
      maybeCloseEqModal();
    }
  });
});

let eqModalDirty = false;

// ===== Shared image-upload helper =====
// Wires an upload button + hidden file input → fills a URL input + preview <img>.
function setupImageUpload(btnId, fileId, urlInputId, previewId) {
  const btn = document.getElementById(btnId);
  const fileInput = document.getElementById(fileId);
  const urlInput = document.getElementById(urlInputId);
  const preview = document.getElementById(previewId);
  if (!btn || !fileInput || !urlInput) return;
  btn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { toast.warn('Max 5MB.'); fileInput.value = ''; return; }
    if (!/^image\//.test(f.type)) { toast.warn('Only image files.'); fileInput.value = ''; return; }
    const fd = new FormData();
    fd.append('image', f);
    try {
      const r = await fetch('/api/uploads/image', { method: 'POST', body: fd });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        toast.error(d.error || 'Upload failed.');
        return;
      }
      const d = await r.json();
      urlInput.value = d.url;
      urlInput.dispatchEvent(new Event('input'));
      if (preview) { preview.src = d.url; preview.classList.remove('hidden'); }
      toast.success('Image uploaded.');
      markItemModalDirty();
    } catch (err) {
      toast.error('Network error during upload.');
    }
    fileInput.value = '';
  });
  // Live preview for URL
  if (urlInput && preview) {
    urlInput.addEventListener('input', () => {
      if (urlInput.value) { preview.src = urlInput.value; preview.classList.remove('hidden'); }
      else { preview.classList.add('hidden'); }
    });
  }
}

function markItemModalDirty() { itemModalDirty = true; }

async function maybeCloseItemModal() {
  if (itemModalDirty) {
    const ok = await confirmToast({
      title: 'Discard changes?',
      message: 'You have unsaved edits in this item. Discard them and close?',
      confirmText: 'Discard & close',
      cancelText: 'Keep editing',
      danger: true,
    });
    if (!ok) return;
  }
  closeItemModal();
}

async function maybeCloseEqModal() {
  if (eqModalDirty) {
    const ok = await confirmToast({
      title: 'Discard changes?',
      message: 'You have unsaved edits in this quiz. Discard them and close?',
      confirmText: 'Discard & close',
      cancelText: 'Keep editing',
      danger: true,
    });
    if (!ok) return;
  }
  document.getElementById('edit-quiz-modal').classList.add('hidden');
  eqModalDirty = false;
}

function openItemModal(quizId, item) {
  currentQuizId = quizId;
  editingItem = item;
  itemModalDirty = false;
  document.getElementById('item-modal-title').textContent = item ? 'Edit item' : 'New item';
  document.getElementById('item-type').value = item ? item.type : 'multiple_choice';
  document.getElementById('item-question').value = item ? item.question : '';
  document.getElementById('item-image').value = item ? (item.image_url || '') : '';
  // Points — clamp 1..10, default 1
  let pts = item ? Number(item.points) : 1;
  if (!Number.isFinite(pts) || pts < 1) pts = 1;
  if (pts > 10) pts = 10;
  document.getElementById('item-points').value = pts;
  document.getElementById('item-answer').value = item ? (item.correct_answer || '') : '';
  document.getElementById('item-explanation').value = item ? (item.explanation || '') : '';
  // Reset preview image
  const imgPrev = document.getElementById('item-image-preview');
  if (imgPrev) {
    if (item && item.image_url) { imgPrev.src = item.image_url; imgPrev.classList.remove('hidden'); }
    else { imgPrev.classList.add('hidden'); }
  }
  const list = document.getElementById('options-list');
  list.innerHTML = '';
  if (item && item.options) {
    item.options.forEach(o => addOptionRow(o.text, o.is_correct, o.image_url || ''));
  } else {
    addOptionRow('', true, '');
    addOptionRow('', false, '');
  }
  syncTypeFields();
  document.getElementById('item-modal').classList.remove('hidden');
}

function closeItemModal() {
  document.getElementById('item-modal').classList.add('hidden');
  editingItem = null;
  itemModalDirty = false;
}

function syncTypeFields() {
  const type = document.getElementById('item-type').value;
  const isChoice = type === 'multiple_choice' || type === 'true_false';
  document.getElementById('options-block').classList.toggle('hidden', !isChoice);
  document.getElementById('answer-key-block').classList.toggle('hidden', isChoice);
  if (type === 'true_false') {
    const list = document.getElementById('options-list');
    list.innerHTML = '';
    addOptionRow('True', true, '');
    addOptionRow('False', false, '');
  }
}

// text — option text
// correct — bool
// imageUrl — optional, for image-bearing options (e.g. diagrams)
function addOptionRow(text, correct, imageUrl) {
  const list = document.getElementById('options-list');
  const row = document.createElement('div');
  row.className = 'option-row editor-option' + (correct ? ' is-correct' : '');

  const isTrueFalse = document.getElementById('item-type').value === 'true_false';
  row.innerHTML = `
    <div class="opt-main">
      <button type="button" class="opt-correct" data-correct="${correct ? '1' : '0'}" aria-label="Mark as correct"></button>
      <input type="text" class="opt-text" value="${esc(text)}" placeholder="Option text" ${isTrueFalse ? 'disabled' : ''} />
      ${!isTrueFalse ? '<button type="button" class="icon-btn opt-remove" aria-label="Remove option"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>' : ''}
    </div>
    ${!isTrueFalse ? `
      <div class="opt-image-row image-input-row">
        <input type="url" class="opt-image" value="${esc(imageUrl || '')}" placeholder="Optional image URL…" />
        <button type="button" class="btn btn-outline btn-sm opt-upload-btn" aria-label="Upload image" title="Upload image"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></button>
        <input type="file" class="opt-upload-file" accept="image/*" hidden />
        <img class="opt-image-preview image-preview ${imageUrl ? '' : 'hidden'}" src="${esc(imageUrl || '')}" alt="" />
      </div>
    ` : ''}
  `;
  list.appendChild(row);

  const correctBtn = row.querySelector('.opt-correct');
  const markCorrect = () => {
    list.querySelectorAll('.opt-correct').forEach(b => {
      b.dataset.correct = '0';
      b.closest('.option-row').classList.remove('is-correct');
    });
    correctBtn.dataset.correct = '1';
    row.classList.add('is-correct');
    markItemModalDirty();
  };
  correctBtn.addEventListener('click', markCorrect);
  row.querySelector('.opt-text')?.addEventListener('dblclick', markCorrect);

  row.querySelector('.opt-remove')?.addEventListener('click', () => {
    row.remove();
    markItemModalDirty();
  });
  row.querySelector('.opt-text')?.addEventListener('input', markItemModalDirty);
  row.querySelector('.opt-image')?.addEventListener('input', (e) => {
    const prev = row.querySelector('.opt-image-preview');
    if (e.target.value) { prev.src = e.target.value; prev.classList.remove('hidden'); }
    else { prev.classList.add('hidden'); }
    markItemModalDirty();
  });

  // Per-option image upload
  const uploadBtn = row.querySelector('.opt-upload-btn');
  const fileInput = row.querySelector('.opt-upload-file');
  const urlInput = row.querySelector('.opt-image');
  const preview = row.querySelector('.opt-image-preview');
  if (uploadBtn && fileInput) {
    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files[0];
      if (!f) return;
      if (f.size > 5 * 1024 * 1024) { toast.warn('Max 5MB.'); fileInput.value = ''; return; }
      if (!/^image\//.test(f.type)) { toast.warn('Only image files.'); fileInput.value = ''; return; }
      const fd = new FormData();
      fd.append('image', f);
      try {
        const r = await fetch('/api/uploads/image', { method: 'POST', body: fd });
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          toast.error(d.error || 'Upload failed.');
          return;
        }
        const d = await r.json();
        urlInput.value = d.url;
        urlInput.dispatchEvent(new Event('input'));
        toast.success('Option image uploaded.');
        markItemModalDirty();
      } catch (err) {
        toast.error('Network error during upload.');
      }
      fileInput.value = '';
    });
  }
}

async function saveItem() {
  const type = document.getElementById('item-type').value;
  let points = Number(document.getElementById('item-points').value);
  if (!Number.isFinite(points) || points < 1) points = 1;
  if (points > 10) points = 10;
  const body = {
    type,
    question: document.getElementById('item-question').value.trim(),
    image_url: document.getElementById('item-image').value.trim() || null,
    correct_answer: type === 'identification' || type === 'open_ended' ? document.getElementById('item-answer').value.trim() : null,
    explanation: document.getElementById('item-explanation').value.trim() || null,
    points,
    options: type === 'multiple_choice' || type === 'true_false'
      ? Array.from(document.querySelectorAll('#options-list .option-row')).map(r => ({
          text: r.querySelector('.opt-text')?.value?.trim() || '',
          is_correct: r.querySelector('.opt-correct')?.dataset.correct === '1',
          image_url: r.querySelector('.opt-image')?.value?.trim() || null,
        }))
      : null,
  };

  // ===== Validation (clear, inline toasts) =====
  if (!body.question) {
    toast.warn('Question is required.');
    document.getElementById('item-question').focus();
    return;
  }
  if (body.options) {
    if (body.options.length < 2) {
      toast.warn('Multiple choice needs at least 2 options.');
      return;
    }
    if (!body.options.some(o => o.is_correct)) {
      toast.warn('Mark one option as correct (click the green circle, or double-click the option text).');
      return;
    }
    const empty = body.options.find(o => !o.text);
    if (empty) {
      toast.warn('All options must have text.');
      return;
    }
  }

  const url = editingItem
    ? `/api/quizzes/items/${editingItem.id}`
    : `/api/quizzes/${currentQuizId}/items`;
  const method = editingItem ? 'PATCH' : 'POST';
  try {
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.ok) {
      toast.success(editingItem ? 'Item updated.' : 'Item created.');
      location.reload();
    } else {
      const d = await r.json().catch(() => ({}));
      toast.error(d.error || 'Failed to save item.');
    }
  } catch (err) {
    toast.error('Network error — please try again.');
  }
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
