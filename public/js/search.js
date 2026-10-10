// Search command palette + global keyboard shortcuts.
// Wires the topbar search trigger + Cmd/Ctrl+K shortcut to open a palette that
// fetches from /api/search as the user types (debounced).

(function () {
  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function highlight(text, q) {
    if (!text) return '';
    const safe = escapeHtml(text);
    if (!q) return safe;
    const escaped = q.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    try {
      return safe.replace(new RegExp(`(${escaped})`, "ig"), '<mark>$1</mark>');
    } catch { return safe; }
  }

  let palette = null;
  let activeIdx = -1;
  let lastQuery = "";
  let debounceTimer = null;
  let abortController = null;

  function openPalette() {
    if (palette) return;
    palette = document.createElement("div");
    palette.className = "search-palette";
    palette.setAttribute("role", "dialog");
    palette.setAttribute("aria-modal", "true");

    const card = document.createElement("div");
    card.className = "search-palette-card";

    const inputRow = document.createElement("div");
    inputRow.className = "search-palette-input";
    inputRow.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input type="search" placeholder="Search notes, flashcards, quizzes…" autocomplete="off" />
    `;
    const input = inputRow.querySelector("input");
    input.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => runSearch(input.value), 220);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); closePalette(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); moveActive(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); moveActive(-1); }
      else if (e.key === "Enter") {
        e.preventDefault();
        const link = palette.querySelector(".search-result.active");
        if (link) link.click();
        else if (palette.querySelectorAll(".search-result").length > 0) {
          palette.querySelectorAll(".search-result")[0].click();
        }
      }
    });

    const body = document.createElement("div");
    body.className = "search-palette-body";
    body.innerHTML = `<div class="search-empty">Type to search across notes, flashcards, and quizzes.</div>`;

    card.appendChild(inputRow);
    card.appendChild(body);
    palette.appendChild(card);
    document.body.appendChild(palette);
    palette.addEventListener("click", (e) => { if (e.target === palette) closePalette(); });
    setTimeout(() => input.focus(), 30);
  }

  function closePalette() {
    if (!palette) return;
    palette.remove();
    palette = null;
    activeIdx = -1;
    if (abortController) abortController.abort();
  }

  function moveActive(delta) {
    if (!palette) return;
    const results = Array.from(palette.querySelectorAll(".search-result"));
    if (results.length === 0) return;
    const next = Math.max(0, Math.min(results.length - 1, activeIdx + delta));
    if (activeIdx >= 0) results[activeIdx].classList.remove("active");
    results[next].classList.add("active");
    results[next].scrollIntoView({ block: "nearest" });
    activeIdx = next;
  }

  async function runSearch(q) {
    if (!palette) return;
    lastQuery = q;
    const body = palette.querySelector(".search-palette-body");
    if (!q || q.trim().length === 0) {
      body.innerHTML = `<div class="search-empty">Type to search across notes, flashcards, and quizzes.</div>`;
      return;
    }
    body.innerHTML = `<div class="search-empty">Searching…</div>`;
    if (abortController) abortController.abort();
    abortController = new AbortController();
    try {
      const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: abortController.signal });
      const d = await r.json();
      if (q !== lastQuery) return; // stale
      renderResults(d.groups || {}, q);
    } catch (err) {
      if (err.name === "AbortError") return;
      body.innerHTML = `<div class="search-empty">Network error — try again.</div>`;
    }
  }

  function renderResults(groups, q) {
    const body = palette.querySelector(".search-palette-body");
    const unitResults = groups.units || [];
    const blockResults = groups.blocks || [];
    const cardResults = groups.cards || [];
    const itemResults = groups.quiz_items || [];
    const total = unitResults.length + blockResults.length + cardResults.length + itemResults.length;

    if (total === 0) {
      body.innerHTML = `<div class="search-empty">No results for "${escapeHtml(q)}".</div>`;
      return;
    }

    body.innerHTML = "";
    activeIdx = -1;

    const renderGroup = (label, items, renderRow) => {
      if (items.length === 0) return;
      const head = document.createElement("div");
      head.className = "search-group-head";
      head.textContent = `${label} · ${items.length}`;
      body.appendChild(head);
      items.forEach((it, i) => {
        const a = renderRow(it, i);
        a.addEventListener("mouseenter", () => {
          palette.querySelectorAll(".search-result.active").forEach(el => el.classList.remove("active"));
          a.classList.add("active");
          // Compute index across ALL results (not just within this group).
          const all = Array.from(palette.querySelectorAll(".search-result"));
          activeIdx = all.indexOf(a);
        });
        body.appendChild(a);
      });
    };

    renderGroup("Units", unitResults, (u) => {
      const a = document.createElement("a");
      a.href = `/notes/${u.slug}`;
      a.className = "search-result";
      a.innerHTML = `
        <span class="sr-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg></span>
        <span class="sr-text">
          <div class="sr-title">${highlight(u.title, q)} <span style="color: var(--fg-faint); font-weight: 400;">· Unit ${escapeHtml(u.number || '')}</span></div>
          <div class="sr-sub">${highlight(u.description, q)}</div>
        </span>
      `;
      return a;
    });

    renderGroup("Note sections", blockResults, (b) => {
      const a = document.createElement("a");
      a.href = b.unit_slug ? `/notes/${b.unit_slug}#part-${b.part_id}` : "/notes";
      a.className = "search-result";
      a.innerHTML = `
        <span class="sr-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 4v16"/><path d="M17 4v16"/><path d="M19 4H9.5a4.5 4.5 0 0 0 0 9H13"/></svg></span>
        <span class="sr-text">
          <div class="sr-title">${highlight((b.text || "").slice(0, 100), q)}</div>
          <div class="sr-sub">${escapeHtml(b.unit_title || "Unit")}<% if (b.part_title) { %> · ${escapeHtml(b.part_title)}<% } %></div>
        </span>
      `;
      // The above uses EJS-style syntax — replace with plain JS:
      a.innerHTML = `
        <span class="sr-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 4v16"/><path d="M17 4v16"/><path d="M19 4H9.5a4.5 4.5 0 0 0 0 9H13"/></svg></span>
        <span class="sr-text">
          <div class="sr-title">${highlight((b.text || "").slice(0, 100), q)}</div>
          <div class="sr-sub">${escapeHtml(b.unit_title || "Unit")}${b.part_title ? " · " + escapeHtml(b.part_title) : ""}</div>
        </span>
      `;
      return a;
    });

    renderGroup("Flashcards", cardResults, (c) => {
      const a = document.createElement("a");
      a.href = "/flashcards";
      a.className = "search-result";
      a.innerHTML = `
        <span class="sr-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="2" y1="9" x2="22" y2="9"/></svg></span>
        <span class="sr-text">
          <div class="sr-title">${highlight(c.front, q)}</div>
          <div class="sr-sub">${highlight((c.back || "").slice(0, 80), q)}</div>
        </span>
      `;
      return a;
    });

    renderGroup("Quiz items", itemResults, (it) => {
      const div = document.createElement("a");
      div.href = `/practice/${it.quiz_id}`;
      div.className = "search-result";
      div.innerHTML = `
        <span class="sr-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3 3 3 0 0 0-3 3 3 3 0 0 0-1 5.83V17a3 3 0 0 0 3 3 3 3 0 0 0 4 0 3 3 0 0 0 4 0 3 3 0 0 0 3-3v-3.17A3 3 0 0 0 18 8a3 3 0 0 0-3-3 3 3 0 0 0-3-3z"/></svg></span>
        <span class="sr-text">
          <div class="sr-title">${highlight(it.question, q)}</div>
          <div class="sr-sub">${escapeHtml(it.quiz_title)} · ${escapeHtml(it.type.replace(/_/g, " "))}</div>
        </span>
      `;
      return div;
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    const trigger = document.getElementById("search-trigger");
    trigger?.addEventListener("click", (e) => { e.preventDefault(); openPalette(); });
    document.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (palette) closePalette();
        else openPalette();
      }
    });
  });

  // Expose for the shareable notes URL feature (when a hash link is followed,
  // we want to close the palette if it's open).
  window.__searchPalette = { close: closePalette, open: openPalette };
})();
