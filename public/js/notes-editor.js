// Notes editor — block-based templating engine (client side)
// All dialogs go through toast / confirmToast / promptToast (no native alert/confirm/prompt).
// Features: block picker (grid of buttons with SVG icons), drag-to-reorder, rich per-block editor modal,
//           image upload (POST /api/uploads/image) or URL.

let currentPartId = null;
let currentUnitId = null;
let blocks = [];
let editingBlockIdx = -1;
let partEditorDirty = false;
let unitModalDirty = false;
let editUnitModalDirty = false;
let blockModalDirty = false;
let pendingBlockEdit = null; // { kind, originalBlock } — staged while the modal is open

// Inline SVG strings used inside dynamically-built HTML. Kept here so the client
// doesn't need to fetch /js/icon.js or wait for the partial.
const ICON_SVG = {
  pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
  drag: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="9" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>',
  upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
};

const BLOCK_KINDS = [
  { kind: 'paragraph', label: 'Paragraph' },
  { kind: 'heading', label: 'Heading' },
  { kind: 'bullet', label: 'Bullets' },
  { kind: 'numbered', label: 'Numbered' },
  { kind: 'image', label: 'Image' },
  { kind: 'divider', label: 'Divider' },
  { kind: 'callout', label: 'Callout' },
];

function defaultBlock(kind) {
  switch (kind) {
    case 'paragraph': return { kind, text: 'New paragraph text…' };
    case 'heading': return { kind, text: 'New heading', level: 2 };
    case 'bullet': return { kind, items: ['First point'] };
    case 'numbered': return { kind, items: ['First step'] };
    case 'image': return { kind, url: '', caption: '' };
    case 'divider': return { kind };
    case 'callout': return { kind, text: 'Important callout…', variant: 'info' };
  }
  return null;
}

function openPartEditor(partId, unitId) {
  currentPartId = partId;
  currentUnitId = unitId;
  partEditorDirty = false;
  document.getElementById('editor-modal').classList.remove('hidden');
  fetch(`/api/notes/parts/${partId}/blocks`).then(r => r.json()).then(d => {
    blocks = d.blocks || [];
    renderBlocks();
    document.getElementById('part-title').value = d.title || '';
  }).catch(() => {
    toast.error('Failed to load part.');
    closePartEditorSilent();
  });
}

async function closePartEditor() {
  if (partEditorDirty) {
    const ok = await confirmToast({
      title: 'Discard changes?',
      message: 'You have unsaved edits in this part. Discard them and close?',
      confirmText: 'Discard & close',
      cancelText: 'Keep editing',
      danger: true,
    });
    if (!ok) return;
  }
  closePartEditorSilent();
}

function closePartEditorSilent() {
  document.getElementById('editor-modal').classList.add('hidden');
  currentPartId = null;
  blocks = [];
  editingBlockIdx = -1;
  partEditorDirty = false;
}

function renderBlocks() {
  const ed = document.getElementById('blocks-editor');
  ed.innerHTML = '';
  if (blocks.length === 0) {
    ed.innerHTML = '<p class="muted small" style="padding:0.5rem;text-align:center;">No blocks yet — pick one below to start.</p>';
    return;
  }
  blocks.forEach((b, i) => {
    const card = document.createElement('div');
    card.className = 'block-card';
    card.dataset.idx = String(i);
    card.draggable = true;
    card.innerHTML = `
      <div class="block-card-head">
        <span class="muted small">${b.kind}</span>
        <div class="block-card-tools">
          <span class="drag-handle" title="Drag to reorder">${ICON_SVG.drag}</span>
          <button class="icon-btn edit-block-btn" data-idx="${i}" title="Edit" aria-label="Edit block">${ICON_SVG.pencil}</button>
          <button class="icon-btn del-block-btn" data-idx="${i}" title="Delete" aria-label="Delete block">${ICON_SVG.trash}</button>
        </div>
      </div>
      <div class="block-card-preview">${previewHtml(b)}</div>
    `;
    ed.appendChild(card);
  });

  // Edit / delete buttons
  ed.querySelectorAll('.edit-block-btn').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const idx = Number(e.currentTarget.dataset.idx);
    openBlockModal(idx);
  }));
  ed.querySelectorAll('.del-block-btn').forEach(b => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    const idx = Number(e.currentTarget.dataset.idx);
    const ok = await confirmToast({
      title: 'Delete this block?',
      message: `Remove the ${blocks[idx]?.kind || ''} block from this part.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      danger: true,
    });
    if (!ok) return;
    blocks.splice(idx, 1);
    partEditorDirty = true;
    renderBlocks();
  }));

  // Drag-to-reorder
  let dragIdx = null;
  ed.querySelectorAll('.block-card').forEach(card => {
    card.addEventListener('dragstart', (e) => {
      dragIdx = Number(card.dataset.idx);
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', String(dragIdx)); } catch {}
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      ed.querySelectorAll('.block-card').forEach(c => c.classList.remove('drag-over'));
    });
    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      card.classList.add('drag-over');
    });
    card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      const targetIdx = Number(card.dataset.idx);
      if (dragIdx === null || dragIdx === targetIdx) return;
      const [moved] = blocks.splice(dragIdx, 1);
      blocks.splice(targetIdx, 0, moved);
      partEditorDirty = true;
      dragIdx = null;
      renderBlocks();
    });
  });
}

// ===== Block editor modal (rich form per kind) =====
function openBlockModal(idx) {
  const b = idx >= 0 ? blocks[idx] : null;
  if (!b) return;
  editingBlockIdx = idx;
  pendingBlockEdit = { kind: b.kind, original: { ...b } };
  blockModalDirty = false;
  document.getElementById('block-modal-title').textContent = `Edit ${b.kind}`;
  const body = document.getElementById('block-modal-body');
  body.innerHTML = renderBlockForm(b);
  attachBlockFormHandlers();
  document.getElementById('block-modal').classList.remove('hidden');
  setTimeout(() => body.querySelector('input, textarea, select')?.focus(), 50);
}

function renderBlockForm(b) {
  switch (b.kind) {
    case 'paragraph':
    case 'callout':
      return `
        <label>${b.kind === 'callout' ? 'Callout text' : 'Paragraph text'}</label>
        <textarea id="block-text" rows="6">${esc(b.text || '')}</textarea>
        ${b.kind === 'callout' ? `
          <label>Variant</label>
          <select id="block-variant" data-custom>
            <option value="info" ${b.variant === 'info' ? 'selected' : ''}>Info (blue)</option>
            <option value="warning" ${b.variant === 'warning' ? 'selected' : ''}>Warning (amber)</option>
            <option value="success" ${b.variant === 'success' ? 'selected' : ''}>Success (green)</option>
          </select>
        ` : ''}
      `;
    case 'heading':
      return `
        <label>Heading text</label>
        <input id="block-text" type="text" value="${esc(b.text || '')}" />
        <label>Level</label>
        <select id="block-level" data-custom>
          <option value="2" ${b.level === 2 ? 'selected' : ''}>H2 (section title)</option>
          <option value="3" ${b.level === 3 ? 'selected' : ''}>H3 (subsection)</option>
        </select>
      `;
    case 'bullet':
    case 'numbered':
      return `
        <label>Items <span class="muted small">(one per line)</span></label>
        <textarea id="block-items" rows="6">${esc((b.items || []).join('\n'))}</textarea>
      `;
    case 'image':
      return `
        <label>Image</label>
        <div class="image-input-row">
          <input id="block-url" type="url" value="${esc(b.url || '')}" placeholder="Paste image URL…" />
          <button type="button" class="btn btn-outline btn-sm" id="block-upload-btn">${ICON_SVG.upload} <span>Upload</span></button>
          <input type="file" id="block-file" accept="image/*" hidden />
          <img id="block-preview" class="image-preview ${b.url ? '' : 'hidden'}" src="${esc(b.url || '')}" alt="" />
        </div>
        <label>Caption (optional)</label>
        <input id="block-caption" type="text" value="${esc(b.caption || '')}" />
      `;
    case 'divider':
      return `<p class="muted">A divider has no editable fields.</p>`;
    default:
      return `<p class="muted">Unknown block kind.</p>`;
  }
}

function attachBlockFormHandlers() {
  // Image upload
  const uploadBtn = document.getElementById('block-upload-btn');
  const fileInput = document.getElementById('block-file');
  const urlInput = document.getElementById('block-url');
  const preview = document.getElementById('block-preview');
  if (uploadBtn && fileInput) {
    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files[0];
      if (!f) return;
      if (f.size > 5 * 1024 * 1024) { toast.warn('Max 5MB.'); return; }
      if (!/^image\//.test(f.type)) { toast.warn('Only image files are allowed.'); return; }
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
        if (urlInput) { urlInput.value = d.url; urlInput.dispatchEvent(new Event('input')); }
        if (preview) { preview.src = d.url; preview.classList.remove('hidden'); }
        toast.success('Image uploaded.');
        blockModalDirty = true;
      } catch (err) {
        toast.error('Network error during upload.');
      }
      fileInput.value = '';
    });
  }
  // Live preview for image URL
  if (urlInput && preview) {
    urlInput.addEventListener('input', () => {
      if (urlInput.value) { preview.src = urlInput.value; preview.classList.remove('hidden'); }
      else { preview.classList.add('hidden'); }
    });
  }
  // Mark dirty on any input
  document.getElementById('block-modal-body')?.querySelectorAll('input, textarea, select').forEach(el => {
    el.addEventListener('input', () => { blockModalDirty = true; });
  });
}

function collectBlockFromForm() {
  const b = pendingBlockEdit;
  if (!b) return null;
  const updated = { kind: b.kind };
  switch (b.kind) {
    case 'paragraph':
    case 'callout': {
      const text = document.getElementById('block-text')?.value ?? '';
      updated.text = text;
      if (b.kind === 'callout') {
        const v = document.getElementById('block-variant')?.value || 'info';
        updated.variant = ['info', 'warning', 'success'].includes(v) ? v : 'info';
      }
      break;
    }
    case 'heading': {
      updated.text = document.getElementById('block-text')?.value ?? '';
      const lvl = Number(document.getElementById('block-level')?.value || 2);
      updated.level = lvl === 3 ? 3 : 2;
      break;
    }
    case 'bullet':
    case 'numbered': {
      const itemsStr = document.getElementById('block-items')?.value ?? '';
      updated.items = itemsStr.split('\n').map(s => s.trim()).filter(Boolean);
      break;
    }
    case 'image': {
      updated.url = (document.getElementById('block-url')?.value || '').trim();
      updated.caption = document.getElementById('block-caption')?.value || '';
      break;
    }
    case 'divider':
      // no fields
      break;
  }
  return updated;
}

async function closeBlockModal() {
  if (blockModalDirty) {
    const ok = await confirmToast({
      title: 'Discard block edits?',
      message: 'You have unsaved edits to this block. Discard them and close?',
      confirmText: 'Discard & close',
      cancelText: 'Keep editing',
      danger: true,
    });
    if (!ok) return false;
  }
  document.getElementById('block-modal').classList.add('hidden');
  blockModalDirty = false;
  pendingBlockEdit = null;
  editingBlockIdx = -1;
  return true;
}

function previewHtml(b) {
  switch (b.kind) {
    case 'heading': return `<h${b.level || 2}>${esc(b.text)}</h${b.level || 2}>`;
    case 'paragraph': return `<p>${esc(b.text)}</p>`;
    case 'bullet': return `<ul>${(b.items || []).map(i => `<li>${esc(i)}</li>`).join('')}</ul>`;
    case 'numbered': return `<ol>${(b.items || []).map(i => `<li>${esc(i)}</li>`).join('')}</ol>`;
    case 'image': return b.url
      ? `<figure><img src="${esc(b.url)}" style="max-width:100%;border-radius:8px"/><figcaption class="muted small">${esc(b.caption || '')}</figcaption></figure>`
      : '<p class="muted small">No image URL set.</p>';
    case 'divider': return '<hr/>';
    case 'callout': return `<div class="callout callout-${b.variant || 'info'}">${esc(b.text)}</div>`;
    default: return '';
  }
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function savePart() {
  const title = document.getElementById('part-title').value;
  try {
    await fetch(`/api/notes/parts/${currentPartId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    await fetch(`/api/notes/parts/${currentPartId}/blocks`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocks }),
    });
    toast.success('Part saved');
    partEditorDirty = false;
    closePartEditorSilent();
    location.reload();
  } catch (err) {
    toast.error('Failed to save part.');
  }
}

// ===== Edit unit metadata =====
function openEditUnitModal(unit) {
  editUnitModalDirty = false;
  document.getElementById('eu-id').value = unit.id;
  document.getElementById('eu-number').value = unit.number || '';
  document.getElementById('eu-title').value = unit.title || '';
  document.getElementById('eu-desc').value = unit.description || '';
  document.getElementById('edit-unit-modal').classList.remove('hidden');
}
async function closeEditUnitModal() {
  if (editUnitModalDirty) {
    const ok = await confirmToast({
      title: 'Discard changes?',
      message: 'You have unsaved edits to this unit. Discard them and close?',
      confirmText: 'Discard & close',
      cancelText: 'Keep editing',
      danger: true,
    });
    if (!ok) return;
  }
  document.getElementById('edit-unit-modal').classList.add('hidden');
  editUnitModalDirty = false;
}

document.addEventListener('DOMContentLoaded', () => {
  // ===== Open part editor =====
  document.querySelectorAll('.edit-part-link, .edit-part-btn').forEach(el => el.addEventListener('click', (e) => {
    e.preventDefault();
    openPartEditor(el.dataset.partId, el.dataset.unitId);
  }));
  document.getElementById('editor-close')?.addEventListener('click', closePartEditor);
  document.getElementById('editor-cancel')?.addEventListener('click', closePartEditor);
  document.getElementById('editor-save')?.addEventListener('click', savePart);
  document.getElementById('part-title')?.addEventListener('input', () => { partEditorDirty = true; });

  // ===== Block picker (grid of buttons) =====
  document.querySelectorAll('.block-picker-btn').forEach(btn => btn.addEventListener('click', () => {
    const kind = btn.dataset.kind;
    const def = defaultBlock(kind);
    if (!def) { toast.warn(`Unknown block type "${kind}".`); return; }
    blocks.push(def);
    partEditorDirty = true;
    renderBlocks();
    // Auto-open the editor for the newly added block
    openBlockModal(blocks.length - 1);
  }));

  // ===== Block editor modal =====
  document.getElementById('block-close')?.addEventListener('click', closeBlockModal);
  document.getElementById('block-cancel')?.addEventListener('click', closeBlockModal);
  document.getElementById('block-save')?.addEventListener('click', () => {
    const updated = collectBlockFromForm();
    if (updated == null) { closeBlockModal(); return; }
    // Validation
    if (updated.kind === 'paragraph' || updated.kind === 'callout') {
      if (!updated.text || !updated.text.trim()) { toast.warn('Text is required.'); return; }
    }
    if (updated.kind === 'heading' && !updated.text?.trim()) { toast.warn('Heading text is required.'); return; }
    if ((updated.kind === 'bullet' || updated.kind === 'numbered') && updated.items?.length === 0) {
      toast.warn('Add at least one item.');
      return;
    }
    if (updated.kind === 'image' && !updated.url) { toast.warn('Image URL or upload is required.'); return; }
    blocks[editingBlockIdx] = updated;
    partEditorDirty = true;
    blockModalDirty = false;
    document.getElementById('block-modal').classList.add('hidden');
    pendingBlockEdit = null;
    editingBlockIdx = -1;
    renderBlocks();
  });

  // ===== New unit =====
  document.getElementById('new-unit-btn')?.addEventListener('click', () => {
    unitModalDirty = false;
    document.getElementById('unit-modal').classList.remove('hidden');
    setTimeout(() => document.getElementById('nu-title')?.focus(), 50);
  });
  document.getElementById('unit-close')?.addEventListener('click', () => maybeCloseUnitModal());
  document.getElementById('unit-cancel')?.addEventListener('click', () => maybeCloseUnitModal());
  ['nu-number', 'nu-title', 'nu-desc'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => { unitModalDirty = true; });
  });
  document.getElementById('unit-create')?.addEventListener('click', async () => {
    const body = {
      number: document.getElementById('nu-number').value,
      title: document.getElementById('nu-title').value,
      description: document.getElementById('nu-desc').value,
    };
    if (!body.title.trim()) {
      toast.warn('Title is required.');
      document.getElementById('nu-title').focus();
      return;
    }
    const r = await fetch('/api/notes/units', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.ok) {
      toast.success('Unit created.');
      location.reload();
    } else {
      const d = await r.json().catch(() => ({}));
      toast.error(d.error || 'Failed to create unit.');
    }
  });

  // ===== Edit existing unit =====
  document.querySelectorAll('.edit-unit-btn').forEach(b => b.addEventListener('click', () => {
    const unit = JSON.parse(b.dataset.unit);
    openEditUnitModal(unit);
  }));
  document.getElementById('eu-close')?.addEventListener('click', closeEditUnitModal);
  document.getElementById('eu-cancel')?.addEventListener('click', closeEditUnitModal);
  ['eu-number', 'eu-title', 'eu-desc'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => { editUnitModalDirty = true; });
  });
  document.getElementById('eu-save')?.addEventListener('click', async () => {
    const id = document.getElementById('eu-id').value;
    const body = {
      number: document.getElementById('eu-number').value,
      title: document.getElementById('eu-title').value,
      description: document.getElementById('eu-desc').value,
    };
    if (!body.title.trim()) { toast.warn('Title is required.'); return; }
    const r = await fetch(`/api/notes/units/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.ok) {
      toast.success('Unit saved.');
      location.reload();
    } else {
      const d = await r.json().catch(() => ({}));
      toast.error(d.error || 'Failed to save unit.');
    }
  });

  // ===== Add part =====
  document.querySelectorAll('.add-part-btn').forEach(b => b.addEventListener('click', async () => {
    const r = await fetch(`/api/notes/units/${b.dataset.unitId}/parts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'New Part' }) });
    if (r.ok) {
      toast.success('Part added.');
      location.reload();
    } else {
      const d = await r.json().catch(() => ({}));
      toast.error(d.error || 'Failed to add part.');
    }
  }));

  // ===== Delete unit =====
  document.querySelectorAll('.delete-unit-btn').forEach(b => b.addEventListener('click', async () => {
    const ok = await confirmToast({
      title: 'Delete this unit?',
      message: 'This will permanently remove the unit and ALL of its parts and content blocks. This cannot be undone.',
      confirmText: 'Delete unit',
      cancelText: 'Cancel',
      danger: true,
    });
    if (!ok) return;
    const r = await fetch(`/api/notes/units/${b.dataset.unitId}`, { method: 'DELETE' });
    if (r.ok) {
      toast.success('Unit deleted.');
      location.reload();
    } else {
      const d = await r.json().catch(() => ({}));
      toast.error(d.error || 'Failed to delete unit.');
    }
  }));

  // ===== Delete part =====
  document.querySelectorAll('.delete-part-btn').forEach(b => b.addEventListener('click', async () => {
    const ok = await confirmToast({
      title: 'Delete this part?',
      message: 'This will permanently remove the part and all of its content blocks.',
      confirmText: 'Delete part',
      cancelText: 'Cancel',
      danger: true,
    });
    if (!ok) return;
    const r = await fetch(`/api/notes/parts/${b.dataset.partId}`, { method: 'DELETE' });
    if (r.ok) {
      toast.success('Part deleted.');
      location.reload();
    } else {
      const d = await r.json().catch(() => ({}));
      toast.error(d.error || 'Failed to delete part.');
    }
  }));

  // ===== ESC closes any open modal =====
  document.addEventListener('keydown', (e) => {
    // Cmd/Ctrl+Enter saves the currently-open modal (block modal first, then part editor).
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      const blockModal = document.getElementById('block-modal');
      const editorModal = document.getElementById('editor-modal');
      const unitModal = document.getElementById('unit-modal');
      const euModal = document.getElementById('edit-unit-modal');
      if (blockModal && !blockModal.classList.contains('hidden')) {
        e.preventDefault();
        document.getElementById('block-save')?.click();
        return;
      }
      if (editorModal && !editorModal.classList.contains('hidden')) {
        e.preventDefault();
        document.getElementById('editor-save')?.click();
        return;
      }
      if (euModal && !euModal.classList.contains('hidden')) {
        e.preventDefault();
        document.getElementById('eu-save')?.click();
        return;
      }
      if (unitModal && !unitModal.classList.contains('hidden')) {
        e.preventDefault();
        document.getElementById('unit-create')?.click();
        return;
      }
      return;
    }
    if (e.key !== 'Escape') return;
    const editorModal = document.getElementById('editor-modal');
    const unitModal = document.getElementById('unit-modal');
    const euModal = document.getElementById('edit-unit-modal');
    const blockModal = document.getElementById('block-modal');
    if (blockModal && !blockModal.classList.contains('hidden')) closeBlockModal();
    else if (editorModal && !editorModal.classList.contains('hidden')) closePartEditor();
    else if (unitModal && !unitModal.classList.contains('hidden')) maybeCloseUnitModal();
    else if (euModal && !euModal.classList.contains('hidden')) closeEditUnitModal();
  });
});

async function maybeCloseUnitModal() {
  if (unitModalDirty) {
    const ok = await confirmToast({
      title: 'Discard changes?',
      message: 'You have unsaved edits to this new unit. Discard them and close?',
      confirmText: 'Discard & close',
      cancelText: 'Keep editing',
      danger: true,
    });
    if (!ok) return;
  }
  document.getElementById('unit-modal').classList.add('hidden');
  unitModalDirty = false;
}
