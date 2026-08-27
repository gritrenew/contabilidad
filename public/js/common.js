// Shared helpers used by every page (sidebar, theme, formatting, API access, filters).
const CTB = (() => {
  const THEME_KEY = 'ctb-theme';

  const ICONS = {
    resumen: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>',
    reporte: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="9" x2="9" y2="21"/></svg>',
    anual: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    movimientos: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
    cierre: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4v16h16"/><path d="M9 15l3-3 3 3 4-5"/></svg>',
    mantenedor: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  };

  const NAV_ITEMS = [
    { href: '/', label: 'Resumen', icon: ICONS.resumen },
    { href: '/report.html', label: 'Reporte', icon: ICONS.reporte },
    { href: '/annual.html', label: 'Vista Anual', icon: ICONS.anual },
    { href: '/movimientos.html', label: 'Movimientos', icon: ICONS.movimientos },
    { href: '/cierre.html', label: 'Saldo al Cierre', icon: ICONS.cierre },
  ];
  const ADMIN_NAV_ITEM = { href: '/settings.html', label: 'Mantenedor', icon: ICONS.mantenedor };

  function navLinkHtml(item) {
    const path = location.pathname.replace(/\/index\.html$/, '/');
    const active = item.href === path || (item.href === '/' && path === '/');
    return `<a href="${item.href}"${active ? ' class="active"' : ''}>${item.icon}<span class="nav-label">${item.label}</span></a>`;
  }

  // Renders the sidebar from a single template instead of duplicating the markup
  // in every HTML page — keeps nav items, active-state logic and the admin-only
  // Mantenedor link in one place. Runs synchronously (not on DOMContentLoaded) so
  // that #sync-pill/#theme-toggle exist before each page's own script — which
  // runs right after this one, still during initial parsing — looks them up.
  function renderSidebar() {
    const root = document.getElementById('sidebar-root');
    if (!root) return;
    root.innerHTML = `
      <aside class="sidebar">
        <div class="sidebar-brand">
          <span class="brand-mark">G</span>
          <div class="brand-text"><strong>Grenergy</strong><span>Panel Financiero</span></div>
        </div>
        <nav class="sidebar-nav nav-links" id="sidebar-nav">
          ${NAV_ITEMS.map(navLinkHtml).join('')}
        </nav>
        <div class="sidebar-footer">
          <button class="theme-toggle" id="theme-toggle" title="Cambiar tema" aria-label="Cambiar tema">☽</button>
          <span class="env-pill" id="sync-pill">—</span>
        </div>
      </aside>
    `;
    fetchJSON('/api/settings/whoami').then((status) => {
      if (!status.isAdmin) return;
      const nav = document.getElementById('sidebar-nav');
      if (!nav) return;
      nav.insertAdjacentHTML('beforeend', `<div class="sidebar-divider"></div>${navLinkHtml(ADMIN_NAV_ITEM)}`);
    }).catch(() => {
      // fail-closed on the client for this cosmetic link; the server-side
      // requireAdmin check on /api/settings/* is the real gate either way.
    });
  }

  function initTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved) document.documentElement.setAttribute('data-theme', saved);
    const btn = document.getElementById('theme-toggle');
    if (btn) {
      btn.textContent = currentIsDark() ? '☀' : '☽';
      btn.addEventListener('click', () => {
        const next = currentIsDark() ? 'light' : 'dark';
        localStorage.setItem(THEME_KEY, next);
        document.documentElement.setAttribute('data-theme', next);
        btn.textContent = next === 'dark' ? '☀' : '☽';
      });
    }
  }

  function currentIsDark() {
    const attr = document.documentElement.getAttribute('data-theme');
    if (attr) return attr === 'dark';
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  async function fetchJSON(url, opts) {
    const res = await fetch(url, opts);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Error ${res.status}`);
    return body;
  }

  function fmtMoney(value, opts = {}) {
    const n = Number(value) || 0;
    return new Intl.NumberFormat('es-CL', {
      maximumFractionDigits: opts.decimals ?? 0,
      minimumFractionDigits: opts.decimals ?? 0,
    }).format(n);
  }

  function fmtCompact(value) {
    const n = Number(value) || 0;
    const abs = Math.abs(n);
    if (abs >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'MM';
    if (abs >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (abs >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return fmtMoney(n);
  }

  const MONTH_NAMES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  function fmtPeriod(periodKey) {
    const [y, m] = periodKey.split('-');
    return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
  }

  // Repeats the key for arrays (?companies=A&companies=B) instead of joining with
  // commas — a company/country name can itself contain a comma (e.g. Spanish
  // legal entities like "X, S.L." or "AYORA 123KV RENOVABLES, A.I.E."), and a
  // comma-joined value would get mis-split back into two bogus filter values.
  function qs(params) {
    const usp = new URLSearchParams();
    Object.entries(params).forEach(([key, val]) => {
      if (val === undefined || val === null || val === '') return;
      if (Array.isArray(val)) {
        val.forEach((v) => {
          if (v !== undefined && v !== null && v !== '') usp.append(key, v);
        });
      } else {
        usp.set(key, val);
      }
    });
    return usp.toString();
  }

  // Reads the current location's query string, for pages that restore filters
  // from a shared/bookmarked link (see writeUrlParams).
  function readUrlParams() {
    return new URLSearchParams(location.search);
  }

  // Mirrors the filters actually used for the last successful fetch into the
  // address bar (no navigation/reload) so a link to the current view can be
  // copied and shared, and survives a page refresh.
  function writeUrlParams(paramsString) {
    const url = location.pathname + (paramsString ? '?' + paramsString : '');
    history.replaceState(null, '', url);
  }

  function selectedValues(selectEl) {
    return Array.from(selectEl.selectedOptions).map((o) => o.value);
  }

  // Selects the options whose value is in `values` (used to restore a
  // multiselect from URL params) — a no-op for values that don't exist yet.
  function applySelection(selectEl, values) {
    if (!selectEl || !values) return;
    const set = new Set(values);
    Array.from(selectEl.options).forEach((o) => { o.selected = set.has(o.value); });
    refreshMultiSelect(selectEl);
  }

  async function populateFilters({ companySelect, yearSelect }) {
    const [companies, years] = await Promise.all([
      fetchJSON('/api/companies'),
      fetchJSON('/api/years'),
    ]);
    if (companySelect) {
      companySelect.innerHTML = companies.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
      refreshMultiSelect(companySelect);
    }
    if (yearSelect) {
      yearSelect.innerHTML = years.map((y) => `<option value="${y}">${y}</option>`).join('');
      // Default: select the most recent year so the first paint isn't empty on huge datasets.
      if (years.length && yearSelect.multiple) {
        yearSelect.options[yearSelect.options.length - 1].selected = true;
      }
      refreshMultiSelect(yearSelect);
    }
    return { companies, years };
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------- Searchable multi-select ----------
  // Progressively enhances an existing <select multiple> into a searchable
  // checkbox dropdown with chip-style summary — built as a <details>/<summary>
  // sibling so it's keyboard-operable for free, while the underlying <select>
  // stays the single source of truth (CTB.selectedValues / applySelection keep
  // working unchanged; every page's fetch logic is untouched).
  function enhanceMultiSelect(selectEl, opts = {}) {
    if (!selectEl || selectEl.dataset.msEnhanced) return;
    selectEl.dataset.msEnhanced = '1';
    selectEl.classList.add('ms-native-hidden');
    selectEl.setAttribute('aria-hidden', 'true');
    selectEl.tabIndex = -1;

    const details = document.createElement('details');
    details.className = 'ms';
    const summary = document.createElement('summary');
    summary.className = 'ms-summary';
    const panel = document.createElement('div');
    panel.className = 'ms-panel';
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'ms-search';
    search.placeholder = 'Buscar...';
    search.setAttribute('aria-label', `Buscar en ${opts.label || 'la lista'}`);
    const actions = document.createElement('div');
    actions.className = 'ms-actions';
    const btnAll = document.createElement('button');
    btnAll.type = 'button'; btnAll.className = 'ms-link'; btnAll.textContent = 'Todo';
    const btnNone = document.createElement('button');
    btnNone.type = 'button'; btnNone.className = 'ms-link'; btnNone.textContent = 'Ninguno';
    actions.append(btnAll, btnNone);
    const list = document.createElement('div');
    list.className = 'ms-options';
    panel.append(search, actions, list);
    details.append(summary, panel);
    selectEl.insertAdjacentElement('afterend', details);

    function notify() { if (opts.onChange) opts.onChange(); }

    function renderSummary() {
      const label = opts.label || '';
      const total = selectEl.options.length;
      const selected = Array.from(selectEl.selectedOptions);
      let text;
      if (!selected.length || selected.length === total) text = `${label}: todas`;
      else if (selected.length === 1) text = `${label}: ${selected[0].textContent}`;
      else text = `${label}: ${selected.length} seleccionadas`;
      summary.textContent = text;
    }

    function renderOptions(term = '') {
      const q = term.trim().toLowerCase();
      list.innerHTML = '';
      let shown = 0;
      Array.from(selectEl.options).forEach((opt) => {
        if (q && !opt.textContent.toLowerCase().includes(q)) return;
        shown += 1;
        const row = document.createElement('label');
        row.className = 'ms-option';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = opt.selected;
        cb.addEventListener('change', () => {
          opt.selected = cb.checked;
          renderSummary();
          notify();
        });
        const span = document.createElement('span');
        span.textContent = opt.textContent;
        row.append(cb, span);
        list.appendChild(row);
      });
      if (!shown) list.innerHTML = '<div class="ms-empty">Sin resultados.</div>';
    }

    search.addEventListener('input', () => renderOptions(search.value));
    btnAll.addEventListener('click', () => {
      Array.from(selectEl.options).forEach((o) => { o.selected = true; });
      renderOptions(search.value);
      renderSummary();
      notify();
    });
    btnNone.addEventListener('click', () => {
      Array.from(selectEl.options).forEach((o) => { o.selected = false; });
      renderOptions(search.value);
      renderSummary();
      notify();
    });
    document.addEventListener('click', (e) => {
      if (details.open && !details.contains(e.target)) details.removeAttribute('open');
    });

    selectEl._msRefresh = () => { renderOptions(search.value); renderSummary(); };
    selectEl._msRefresh();
  }

  // Re-renders an enhanced multiselect after its underlying <option>s or
  // .selected state changed from code (e.g. after fetching the option list, or
  // after applySelection restored values from the URL).
  function refreshMultiSelect(selectEl) {
    if (selectEl && selectEl._msRefresh) selectEl._msRefresh();
  }

  // ---------- Inline error banner ----------
  // Looks for #error-banner / #error-banner-text / #error-banner-retry in the
  // page (present on every data page) so a failed fetch is never silent —
  // every page wires the same three ids instead of inventing its own error UI.
  function showError(message, retry) {
    const banner = document.getElementById('error-banner');
    const text = document.getElementById('error-banner-text');
    const retryBtn = document.getElementById('error-banner-retry');
    if (!banner || !text) return;
    text.textContent = message;
    banner.style.display = 'flex';
    if (retryBtn) retryBtn.onclick = retry || null;
  }

  function hideError() {
    const banner = document.getElementById('error-banner');
    if (banner) banner.style.display = 'none';
  }

  return {
    initTheme, renderSidebar, fetchJSON, fmtMoney, fmtCompact, fmtPeriod, qs,
    readUrlParams, writeUrlParams, selectedValues, applySelection, populateFilters,
    escapeHtml, MONTH_NAMES, enhanceMultiSelect, refreshMultiSelect, showError, hideError,
  };
})();

CTB.renderSidebar();
CTB.initTheme();
