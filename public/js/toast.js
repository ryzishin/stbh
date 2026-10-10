// STEM Tesla BioHub — toast, confirm, and prompt helpers.
// Replaces every native alert() / confirm() / prompt() in the app.
// Loaded from layouts/main.ejs BEFORE any other view script.

(function () {
  // ===== Styles are injected once. Real CSS lives in /css/style.css (.toast-stack, .toast, .toast-modal) — this is just a fallback. =====
  const fallbackCss = `
    .toast-stack{position:fixed;bottom:1.25rem;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;gap:0.5rem;z-index:300;pointer-events:none;width:max-content;max-width:calc(100vw - 2rem);}
    .toast{pointer-events:auto;display:flex;align-items:flex-start;gap:0.6rem;padding:0.75rem 1rem;border-radius:8px;background:rgba(10,18,40,0.96);border:1px solid rgba(255,255,255,0.12);color:#f5f7fb;font-size:0.875rem;line-height:1.4;box-shadow:0 8px 24px rgba(0,0,0,0.4);backdrop-filter:blur(10px);min-width:280px;max-width:480px;animation:toast-in 0.18s ease-out;}
    .toast.success{border-color:rgba(16,185,129,0.5);background:rgba(6,40,30,0.96);}
    .toast.error{border-color:rgba(239,68,68,0.55);background:rgba(50,12,12,0.96);}
    .toast.warn{border-color:rgba(245,158,11,0.55);background:rgba(50,36,8,0.96);}
    .toast.info{border-color:rgba(56,189,248,0.55);background:rgba(8,30,46,0.96);}
    .toast .toast-icon{font-size:1rem;line-height:1.2;flex-shrink:0;}
    .toast .toast-body{flex:1;word-break:break-word;}
    .toast .toast-close{background:transparent;border:0;color:inherit;opacity:0.55;cursor:pointer;font-size:1rem;line-height:1;padding:0 0.25rem;}
    .toast .toast-close:hover{opacity:1;}
    .toast.removing{animation:toast-out 0.18s ease-in forwards;}
    @keyframes toast-in{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:translateY(0);}}
    @keyframes toast-out{from{opacity:1;}to{opacity:0;transform:translateY(8px);}}
    .toast-modal{position:fixed;inset:0;background:rgba(0,0,0,0.7);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:1rem;z-index:400;}
    .toast-modal-card{background:#0a1228;border:1px solid rgba(255,255,255,0.12);border-radius:12px;width:100%;max-width:440px;box-shadow:0 20px 60px rgba(0,0,0,0.6);overflow:hidden;animation:toast-in 0.2s ease-out;}
    .toast-modal-head{padding:1rem 1.25rem;border-bottom:1px solid rgba(255,255,255,0.08);}
    .toast-modal-head h3{font-size:1rem;font-weight:600;margin:0;}
    .toast-modal-body{padding:1rem 1.25rem;font-size:0.875rem;line-height:1.5;color:#f5f7fb;}
    .toast-modal-body input,.toast-modal-body textarea{width:100%;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.12);border-radius:6px;padding:0.5rem 0.7rem;color:#f5f7fb;font-family:inherit;font-size:0.875rem;margin-top:0.5rem;}
    .toast-modal-body input:focus,.toast-modal-body textarea:focus{outline:none;border-color:#10b981;}
    .toast-modal-foot{display:flex;gap:0.5rem;justify-content:flex-end;padding:0.9rem 1.25rem;border-top:1px solid rgba(255,255,255,0.08);}
    .toast-modal-foot .btn-danger{background:#ef4444;color:#fff;border-color:#ef4444;}
    .toast-modal-foot .btn-danger:hover{background:#dc2626;}
  `;
  if (!document.getElementById('toast-fallback-css')) {
    const s = document.createElement('style');
    s.id = 'toast-fallback-css';
    s.textContent = fallbackCss;
    document.head.appendChild(s);
  }

  // ===== Stack container (created lazily on first toast — see ensureStack) =====
  let stack = null;
  function getOrCreateStack() {
    if (stack && document.body && document.body.contains(stack)) return stack;
    stack = document.querySelector('.toast-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'toast-stack';
      stack.setAttribute('role', 'status');
      stack.setAttribute('aria-live', 'polite');
    }
    return stack;
  }

  // SVG icons rendered inline — no emoji, scales crisply at any DPR.
  const SVG_ICONS = {
    default: '',
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  };

  function ensureStack() {
    if (!document.body) return null;
    getOrCreateStack();
    if (!document.body.contains(stack)) document.body.appendChild(stack);
    return stack;
  }

  function dismiss(el) {
    if (!el || el.dataset.dismissed === '1') return;
    el.dataset.dismissed = '1';
    el.classList.add('removing');
    setTimeout(() => el.remove(), 200);
  }

  // ===== toast(message, type?, opts?) =====
  // opts: { duration?: number (ms, 0 = sticky), action?: { label, onClick } }
  function toast(message, type = 'default', opts = {}) {
    const duration = opts.duration ?? 3500;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');

    const icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.innerHTML = SVG_ICONS[type] || '';
    // Make the SVG fill the icon span.
    const svg = icon.querySelector('svg');
    if (svg) { svg.setAttribute('width', '16'); svg.setAttribute('height', '16'); svg.style.display = 'block'; }
    el.appendChild(icon);

    const body = document.createElement('div');
    body.className = 'toast-body';
    if (typeof message === 'string') {
      body.textContent = message;
    } else if (message instanceof Node) {
      body.appendChild(message);
    } else {
      body.textContent = String(message);
    }
    el.appendChild(body);

    if (opts.action && opts.action.label) {
      const a = document.createElement('button');
      a.type = 'button';
      a.className = 'btn btn-sm btn-outline';
      a.textContent = opts.action.label;
      a.addEventListener('click', (ev) => {
        ev.stopPropagation();
        try { opts.action.onClick?.(); } finally { dismiss(el); }
      });
      el.appendChild(a);
    }

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast-close';
    close.setAttribute('aria-label', 'Dismiss');
    close.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" style="display:block"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    close.addEventListener('click', () => dismiss(el));
    el.appendChild(close);

    el.addEventListener('click', () => dismiss(el));
    const target = ensureStack();
    if (target) {
      target.appendChild(el);
    } else {
      // body not ready yet — try again on DOMContentLoaded
      const tryAppend = () => { ensureStack()?.appendChild(el); };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', tryAppend, { once: true });
      } else {
        setTimeout(tryAppend, 0);
      }
    }

    if (duration > 0) {
      setTimeout(() => dismiss(el), duration);
    }
    return el;
  }

  toast.success = (m, o) => toast(m, 'success', o);
  toast.error = (m, o) => toast(m, 'error', { duration: 6000, ...o });
  toast.warn = (m, o) => toast(m, 'warn', { duration: 5000, ...o });
  toast.info = (m, o) => toast(m, 'info', o);

  // ===== confirmToast(opts): Promise<boolean> =====
  // opts: { title?, message, confirmText?, cancelText?, danger? }
  function confirmToast(opts = {}) {
    return new Promise((resolve) => {
      const { title = 'Are you sure?', message = '', confirmText = 'Confirm', cancelText = 'Cancel', danger = false } = opts;

      const overlay = document.createElement('div');
      overlay.className = 'toast-modal';
      overlay.setAttribute('role', 'alertdialog');
      overlay.setAttribute('aria-modal', 'true');

      const card = document.createElement('div');
      card.className = 'toast-modal-card';

      const head = document.createElement('div');
      head.className = 'toast-modal-head';
      const h3 = document.createElement('h3');
      h3.textContent = title;
      head.appendChild(h3);
      card.appendChild(head);

      const body = document.createElement('div');
      body.className = 'toast-modal-body';
      if (message) {
        const p = document.createElement('p');
        p.textContent = message;
        body.appendChild(p);
      }
      card.appendChild(body);

      const foot = document.createElement('div');
      foot.className = 'toast-modal-foot';

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn btn-outline';
      cancelBtn.textContent = cancelText;

      const confirmBtn = document.createElement('button');
      confirmBtn.type = 'button';
      confirmBtn.className = danger ? 'btn btn-danger' : 'btn btn-primary';
      confirmBtn.textContent = confirmText;

      foot.appendChild(cancelBtn);
      foot.appendChild(confirmBtn);
      card.appendChild(foot);
      overlay.appendChild(card);
      document.body.appendChild(overlay);

      confirmBtn.focus();

      let resolved = false;
      const cleanup = (val) => {
        if (resolved) return;
        resolved = true;
        overlay.remove();
        document.removeEventListener('keydown', onKey);
        resolve(val);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') cleanup(false);
        else if (e.key === 'Enter') { e.preventDefault(); cleanup(true); }
      };
      cancelBtn.addEventListener('click', () => cleanup(false));
      confirmBtn.addEventListener('click', () => cleanup(true));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(false); });
      document.addEventListener('keydown', onKey);
    });
  }

  // ===== promptToast(opts): Promise<string|null> =====
  // opts: { title?, message?, placeholder?, defaultValue?, multiline?, confirmText?, cancelText?, required? }
  function promptToast(opts = {}) {
    return new Promise((resolve) => {
      const {
        title = 'Input',
        message = '',
        placeholder = '',
        defaultValue = '',
        multiline = false,
        confirmText = 'Save',
        cancelText = 'Cancel',
        required = false,
      } = opts;

      const overlay = document.createElement('div');
      overlay.className = 'toast-modal';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');

      const card = document.createElement('div');
      card.className = 'toast-modal-card';

      const head = document.createElement('div');
      head.className = 'toast-modal-head';
      const h3 = document.createElement('h3');
      h3.textContent = title;
      head.appendChild(h3);
      card.appendChild(head);

      const body = document.createElement('div');
      body.className = 'toast-modal-body';
      if (message) {
        const p = document.createElement('p');
        p.textContent = message;
        body.appendChild(p);
      }
      const input = document.createElement(multiline ? 'textarea' : 'input');
      input.placeholder = placeholder;
      input.value = defaultValue;
      if (multiline) input.rows = 3;
      body.appendChild(input);
      card.appendChild(body);

      const foot = document.createElement('div');
      foot.className = 'toast-modal-foot';
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn btn-outline';
      cancelBtn.textContent = cancelText;
      const confirmBtn = document.createElement('button');
      confirmBtn.type = 'button';
      confirmBtn.className = 'btn btn-primary';
      confirmBtn.textContent = confirmText;
      foot.appendChild(cancelBtn);
      foot.appendChild(confirmBtn);
      card.appendChild(foot);
      overlay.appendChild(card);
      document.body.appendChild(overlay);

      setTimeout(() => { input.focus(); input.select?.(); }, 50);

      let resolved = false;
      const cleanup = (val) => {
        if (resolved) return;
        resolved = true;
        overlay.remove();
        document.removeEventListener('keydown', onKey);
        resolve(val);
      };
      const submit = () => {
        const v = input.value;
        if (required && !v.trim()) {
          input.focus();
          input.style.borderColor = '#ef4444';
          toast.warn('This field is required.');
          return;
        }
        cleanup(v);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') cleanup(null);
        else if (e.key === 'Enter' && !multiline) { e.preventDefault(); submit(); }
      };
      cancelBtn.addEventListener('click', () => cleanup(null));
      confirmBtn.addEventListener('click', submit);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(null); });
      document.addEventListener('keydown', onKey);
    });
  }

  // ===== Expose =====
  window.toast = toast;
  window.confirmToast = confirmToast;
  window.promptToast = promptToast;
})();
