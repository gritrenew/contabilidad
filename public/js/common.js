// Shared helpers used by every page (theme, formatting, API access, filters).
const CTB = (() => {
  const THEME_KEY = 'ctb-theme';

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

  function markActiveNav() {
    const path = location.pathname.replace(/\/index\.html$/, '/');
    document.querySelectorAll('.nav-links a').forEach((a) => {
      const href = a.getAttribute('href');
      if (href === path || (href === '/' && path === '/')) a.classList.add('active');
    });
  }

  // Hides the Mantenedor nav link for anyone who isn't one of the allowed admin
  // accounts. This is a UX convenience only — the real gate is server-side
  // (requireAdmin on /api/settings/*), since a hidden link never stops someone
  // from typing the URL directly.
  async function applyAdminVisibility() {
    try {
      const status = await fetchJSON('/api/settings/whoami');
      if (!status.isAdmin) {
        document.querySelectorAll('a[href="/settings.html"]').forEach((a) => { a.style.display = 'none'; });
      }
    } catch (err) {
      // fail-open on the client; server-side check still applies
    }
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

  function selectedValues(selectEl) {
    return Array.from(selectEl.selectedOptions).map((o) => o.value);
  }

  async function populateFilters({ companySelect, yearSelect }) {
    const [companies, years] = await Promise.all([
      fetchJSON('/api/companies'),
      fetchJSON('/api/years'),
    ]);
    if (companySelect) {
      companySelect.innerHTML = companies.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    }
    if (yearSelect) {
      yearSelect.innerHTML = years.map((y) => `<option value="${y}">${y}</option>`).join('');
      // Default: select the most recent year so the first paint isn't empty on huge datasets.
      if (years.length && yearSelect.multiple) {
        yearSelect.options[yearSelect.options.length - 1].selected = true;
      }
    }
    return { companies, years };
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  return { initTheme, markActiveNav, applyAdminVisibility, fetchJSON, fmtMoney, fmtCompact, fmtPeriod, qs, selectedValues, populateFilters, escapeHtml, MONTH_NAMES };
})();

document.addEventListener('DOMContentLoaded', () => {
  CTB.initTheme();
  CTB.markActiveNav();
  CTB.applyAdminVisibility();
});
