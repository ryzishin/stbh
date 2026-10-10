// STEM Tesla BioHub — main client JS
// Mobile sidebar toggle, password show/hide, password wrapper state,
// form method override helper.
// Toast / confirmToast / promptToast helpers live in /js/toast.js (loaded before this).

document.addEventListener('DOMContentLoaded', () => {
  // ===== Sidebar toggle (PC + mobile) =====
  // Persisted open/close on PC. On mobile, the sidebar is off-canvas by default.
  const menuToggle = document.getElementById('menu-toggle');
  const sidebar = document.querySelector('.sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  const sidebarClose = document.getElementById('sidebar-close');
  const SIDEBAR_KEY = 'stbh:sidebar-collapsed';

  // Read persisted state (PC only — mobile is always collapsed by default).
  if (sidebar && window.innerWidth > 880) {
    const collapsed = localStorage.getItem(SIDEBAR_KEY) === '1';
    sidebar.classList.toggle('collapsed', collapsed);
    document.body.classList.toggle('sidebar-collapsed', collapsed);
  }

  function openSidebar() {
    if (!sidebar) return;
    sidebar.classList.remove('collapsed');
    sidebar.classList.add('open');
    document.body.classList.remove('sidebar-collapsed');
    if (backdrop) backdrop.classList.add('show');
    if (window.innerWidth > 880) localStorage.setItem(SIDEBAR_KEY, '0');
  }
  function closeSidebar() {
    if (!sidebar) return;
    if (window.innerWidth <= 880) {
      sidebar.classList.remove('open');
    } else {
      sidebar.classList.add('collapsed');
      document.body.classList.add('sidebar-collapsed');
      localStorage.setItem(SIDEBAR_KEY, '1');
    }
    if (backdrop) backdrop.classList.remove('show');
  }
  function toggleSidebar() {
    if (!sidebar) return;
    const isMobile = window.innerWidth <= 880;
    if (isMobile) {
      if (sidebar.classList.contains('open')) closeSidebar();
      else openSidebar();
    } else {
      if (sidebar.classList.contains('collapsed')) {
        openSidebar();
      } else {
        closeSidebar();
      }
    }
  }
  if (menuToggle) menuToggle.addEventListener('click', toggleSidebar);
  if (sidebarClose) sidebarClose.addEventListener('click', closeSidebar);
  if (backdrop) backdrop.addEventListener('click', closeSidebar);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (sidebar?.classList.contains('open')) closeSidebar();
  });
  // Close when a nav link is tapped (mobile only).
  document.querySelectorAll('.sidebar-nav a').forEach(a => {
    a.addEventListener('click', () => {
      if (window.innerWidth <= 880) closeSidebar();
    });
  });

  // ===== Custom dropdowns (themed <select> replacement) =====
  // Convert any <select data-custom> into a styled dropdown. Also watch for
  // dynamically-inserted selects (e.g. notes editor's block form rebuilds) and
  // convert them too.
  document.querySelectorAll('select[data-custom]').forEach(setupCustomSelect);

  // Watch for dynamically-added selects with data-custom and convert them too.
  const selectObserver = new MutationObserver((mutations) => {
    for (const mut of mutations) {
      for (const node of mut.addedNodes || []) {
        if (node.nodeType !== 1) continue;
        if (node.tagName === 'SELECT' && node.dataset.custom === '1' && node.dataset.customReady !== '1') {
          setupCustomSelect(node);
        }
        // Also check children (a wrapper div with selects inside)
        if (node.querySelectorAll) {
          node.querySelectorAll('select[data-custom]:not([data-custom-ready="1"])').forEach(setupCustomSelect);
        }
      }
    }
  });
  selectObserver.observe(document.body, { childList: true, subtree: true });

  // ===== Convert links with data-method="post" into forms =====
  document.querySelectorAll('a[data-method]').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const form = document.createElement('form');
      form.method = a.dataset.method;
      form.action = a.href;
      document.body.appendChild(form);
      form.submit();
    });
  });

  // ===== Show/hide password toggle =====
  document.querySelectorAll('[data-toggle-password]').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.togglePassword);
      if (!target) return;
      const showing = target.type === 'text';
      target.type = showing ? 'password' : 'text';
      const wrap = btn.closest('.password-input');
      if (wrap) wrap.classList.toggle('has-text', !showing);
      btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
      btn.setAttribute('title', showing ? 'Show password' : 'Hide password');
    });
  });

  // ===== Track password fields with text, for eye-icon state =====
  document.querySelectorAll('.password-input input[type="password"]').forEach(inp => {
    inp.addEventListener('input', () => {
      const wrap = inp.closest('.password-input');
      if (wrap) wrap.classList.toggle('has-text', inp.value.length > 0);
    });
  });

  // ===== Surface server-passed flash toast from query string =====
  const params = new URLSearchParams(location.search);
  const flashMsg = params.get('toast');
  const flashType = params.get('toast_type') || 'info';
  if (flashMsg && window.toast) {
    toast(decodeURIComponent(flashMsg), flashType);
    params.delete('toast');
    params.delete('toast_type');
    const qs = params.toString();
    const cleanUrl = qs ? `${location.pathname}?${qs}` : location.pathname;
    history.replaceState({}, '', cleanUrl);
  }
});

// ===== Custom themed dropdown component =====
// Replaces the default <select> with a button + panel that matches the app theme.
// Built once per <select data-custom> element. Updates the underlying <select>
// value when the user picks an option, and dispatches a 'change' event so
// existing handlers keep working.
function setupCustomSelect(sel) {
  // Skip if already done
  if (sel.dataset.customReady === '1') return;
  sel.dataset.customReady = '1';
  sel.tabIndex = -1;

  // Build wrapper
  const wrap = document.createElement('div');
  wrap.className = 'custom-select';
  if (sel.id) wrap.id = sel.id + '-wrap';
  sel.parentNode.insertBefore(wrap, sel);
  wrap.appendChild(sel);
  sel.classList.add('custom-select-source');

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'custom-select-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');

  const label = document.createElement('span');
  label.className = 'custom-select-label';
  const chevron = document.createElement('span');
  chevron.className = 'custom-select-chevron';
  chevron.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
  trigger.appendChild(label);
  trigger.appendChild(chevron);

  const list = document.createElement('div');
  list.className = 'custom-select-panel';
  list.setAttribute('role', 'listbox');

  function buildOptions() {
    list.innerHTML = '';
    Array.from(sel.options).forEach(opt => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'custom-select-option' + (opt.selected ? ' selected' : '');
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', opt.selected ? 'true' : 'false');
      item.dataset.value = opt.value;
      item.textContent = opt.textContent;
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        sel.value = opt.value;
        Array.from(sel.options).forEach(o => o.selected = (o === opt));
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        updateLabel();
        closePanel();
      });
      list.appendChild(item);
    });
  }

  function updateLabel() {
    const sel2 = sel.options[sel.selectedIndex];
    label.textContent = sel2 ? sel2.textContent : '';
  }

  function openPanel() {
    list.classList.add('open');
    trigger.setAttribute('aria-expanded', 'true');
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
    // Scroll selected into view
    const selItem = list.querySelector('.custom-select-option.selected');
    if (selItem) selItem.scrollIntoView({ block: 'nearest' });
  }
  function closePanel() {
    list.classList.remove('open');
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', onDocClick);
    document.removeEventListener('keydown', onKey);
  }
  function onDocClick(e) {
    if (!wrap.contains(e.target)) closePanel();
  }
  function onKey(e) {
    if (e.key === 'Escape') closePanel();
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const items = Array.from(list.querySelectorAll('.custom-select-option'));
      const idx = items.findIndex(i => i.classList.contains('selected'));
      const next = e.key === 'ArrowDown' ? Math.min(items.length - 1, idx + 1) : Math.max(0, idx - 1);
      if (items[next]) items[next].click();
    }
  }

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (list.classList.contains('open')) closePanel();
    else openPanel();
  });

  // Re-render the option list if the underlying <select> changes.
  const observer = new MutationObserver(() => {
    buildOptions();
    updateLabel();
  });
  observer.observe(sel, { childList: true, subtree: false });

  buildOptions();
  updateLabel();
  wrap.appendChild(trigger);
  wrap.appendChild(list);

  // When the underlying <select> value changes (e.g. via JS), update the label.
  sel.addEventListener('change', updateLabel);
}
