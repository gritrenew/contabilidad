(async function () {
  const notConfigured = document.getElementById('not-configured');
  const appContent = document.getElementById('app-content');
  const loadingLine = document.getElementById('loading-line');
  const syncPill = document.getElementById('sync-pill');
  const rowCountEl = document.getElementById('row-count');

  const companySelect = document.getElementById('f-company');
  const yearSelect = document.getElementById('f-years');
  const rubroSelect = document.getElementById('f-rubro');
  const searchInput = document.getElementById('f-search');

  let lastResult = { periods: [], items: [] };
  let yearPlan = []; // [{ year, months: ['01','02',...] | null }] — months null means single annual column

  function buildYearPlan(periods) {
    const byYear = new Map();
    periods.forEach((p) => {
      const [y, m] = p.split('-');
      if (!byYear.has(y)) byYear.set(y, []);
      byYear.get(y).push(m);
    });
    return Array.from(byYear.keys())
      .sort()
      .map((year) => {
        const months = byYear.get(year).sort();
        return { year, months: months.length > 1 ? months : null, soleMonth: months.length === 1 ? months[0] : null };
      });
  }

  function colsForYear(plan) {
    // number of <td> this year occupies: one per month, plus a year-total column when there's more than one month.
    return plan.months ? plan.months.length + 1 : 1;
  }

  function renderHeaders() {
    const yearsRow = document.getElementById('pivot-head-years');
    const monthsRow = document.getElementById('pivot-head-months');

    yearsRow.innerHTML = `
      <th class="text" rowspan="2">N° cuenta</th>
      <th class="text" rowspan="2">Nombre cuenta</th>
      ${yearPlan.map((p) => `<th class="num" colspan="${colsForYear(p)}">${p.year}</th>`).join('')}
      <th class="num" rowspan="2">Total general</th>
    `;

    monthsRow.innerHTML = yearPlan.map((p) => {
      if (!p.months) return '<th class="num"></th>';
      const monthCells = p.months.map((m) => `<th class="num">${CTB.MONTH_NAMES[Number(m) - 1]}</th>`).join('');
      return monthCells + `<th class="num">Total ${p.year}</th>`;
    }).join('');
  }

  function yearSum(item, plan) {
    if (!plan.months) return item.periods[`${plan.year}-${plan.soleMonth}`] || 0;
    return plan.months.reduce((sum, m) => sum + (item.periods[`${plan.year}-${m}`] || 0), 0);
  }

  function renderRow(item) {
    const cells = yearPlan.map((p) => {
      if (!p.months) {
        return `<td class="num">${CTB.fmtMoney(item.periods[`${p.year}-${p.soleMonth}`] || 0, { decimals: 2 })}</td>`;
      }
      const monthCells = p.months.map((m) => `<td class="num">${CTB.fmtMoney(item.periods[`${p.year}-${m}`] || 0, { decimals: 2 })}</td>`).join('');
      return monthCells + `<td class="num"><strong>${CTB.fmtMoney(yearSum(item, p), { decimals: 2 })}</strong></td>`;
    }).join('');
    return `
      <tr>
        <td class="text">${CTB.escapeHtml(item.accountNo)}</td>
        <td class="text">${CTB.escapeHtml(item.name || '')}</td>
        ${cells}
        <td class="num"><strong>${CTB.fmtMoney(item.total, { decimals: 2 })}</strong></td>
      </tr>
    `;
  }

  function renderFooter(items) {
    const foot = document.getElementById('pivot-foot');
    if (!items.length) { foot.innerHTML = ''; return; }
    const cells = yearPlan.map((p) => {
      if (!p.months) {
        const sum = items.reduce((s, it) => s + (it.periods[`${p.year}-${p.soleMonth}`] || 0), 0);
        return `<td class="num">${CTB.fmtMoney(sum, { decimals: 2 })}</td>`;
      }
      const monthCells = p.months.map((m) => {
        const sum = items.reduce((s, it) => s + (it.periods[`${p.year}-${m}`] || 0), 0);
        return `<td class="num">${CTB.fmtMoney(sum, { decimals: 2 })}</td>`;
      }).join('');
      const yearTotal = items.reduce((s, it) => s + yearSum(it, p), 0);
      return monthCells + `<td class="num">${CTB.fmtMoney(yearTotal, { decimals: 2 })}</td>`;
    }).join('');
    const grandTotal = items.reduce((s, it) => s + it.total, 0);
    foot.innerHTML = `
      <tr>
        <td class="text"><strong>Total general</strong></td>
        <td class="text"></td>
        ${cells}
        <td class="num"><strong>${CTB.fmtMoney(grandTotal, { decimals: 2 })}</strong></td>
      </tr>
    `;
  }

  function renderTable() {
    const filtered = rubroSelect.value ? lastResult.items.filter((i) => i.rubro === rubroSelect.value) : lastResult.items;
    yearPlan = buildYearPlan(lastResult.periods);
    renderHeaders();

    const body = document.getElementById('pivot-body');
    const totalCols = 2 + yearPlan.reduce((s, p) => s + colsForYear(p), 0) + 1;
    if (!filtered.length) {
      body.innerHTML = `<tr><td colspan="${totalCols}" class="hint" style="text-align:center;padding:24px;">Sin resultados para los filtros seleccionados.</td></tr>`;
      document.getElementById('pivot-foot').innerHTML = '';
      rowCountEl.textContent = '0 cuentas';
      return;
    }
    body.innerHTML = filtered.map(renderRow).join('');
    renderFooter(filtered);
    rowCountEl.textContent = `${filtered.length} cuenta(s) · ${yearPlan.length} año(s)`;
  }

  function exportCsv() {
    const filtered = rubroSelect.value ? lastResult.items.filter((i) => i.rubro === rubroSelect.value) : lastResult.items;
    if (!filtered.length) return;
    const headerCols = [];
    yearPlan.forEach((p) => {
      if (!p.months) { headerCols.push(p.year); return; }
      p.months.forEach((m) => headerCols.push(`${p.year}-${m}`));
      headerCols.push(`Total ${p.year}`);
    });
    const headers = ['N° cuenta', 'Nombre cuenta', ...headerCols, 'Total general'];
    const lines = [headers.join(';')];
    filtered.forEach((item) => {
      const cols = [];
      yearPlan.forEach((p) => {
        if (!p.months) { cols.push(String(item.periods[`${p.year}-${p.soleMonth}`] || 0).replace('.', ',')); return; }
        p.months.forEach((m) => cols.push(String(item.periods[`${p.year}-${m}`] || 0).replace('.', ',')));
        cols.push(String(yearSum(item, p)).replace('.', ','));
      });
      lines.push([item.accountNo, `"${(item.name || '').replace(/"/g, '""')}"`, ...cols, String(item.total).replace('.', ',')].join(';'));
    });
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vista-anual-${companySelect.value}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function loadPivot() {
    if (!companySelect.value) return;
    loadingLine.style.display = 'block';
    CTB.hideError();
    try {
      const params = CTB.qs({
        companies: [companySelect.value],
        years: CTB.selectedValues(yearSelect),
        search: searchInput.value.trim(),
      });
      lastResult = await CTB.fetchJSON(`/api/report${params ? '?' + params : ''}`);
      const urlParams = new URLSearchParams(params);
      if (rubroSelect.value) urlParams.set('rubro', rubroSelect.value); else urlParams.delete('rubro');
      CTB.writeUrlParams(urlParams.toString());
      renderTable();
    } catch (err) {
      rowCountEl.textContent = '';
      CTB.showError('No se pudo cargar la vista anual: ' + err.message, loadPivot);
    } finally {
      loadingLine.style.display = 'none';
    }
  }

  document.getElementById('btn-apply').addEventListener('click', loadPivot);
  document.getElementById('btn-export').addEventListener('click', exportCsv);
  document.getElementById('btn-clear').addEventListener('click', () => {
    CTB.applySelection(yearSelect, []);
    rubroSelect.value = '';
    searchInput.value = '';
    loadPivot();
  });
  rubroSelect.addEventListener('change', renderTable);
  searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadPivot(); });

  try {
    const status = await CTB.fetchJSON('/api/status');
    if (!status.configured) {
      notConfigured.style.display = 'block';
      syncPill.textContent = 'Sin configurar';
      return;
    }
    syncPill.textContent = 'Conectado';
    appContent.style.display = 'block';

    CTB.enhanceMultiSelect(yearSelect, { label: 'Años' });

    const [companies] = await Promise.all([
      CTB.fetchJSON('/api/companies'),
      CTB.populateFilters({ yearSelect }),
    ]);
    // Vista Anual defaults to "todos los años disponibles" (see hint under the
    // Años field) — populateFilters pre-selects the most recent year, which is
    // meant for Reporte's multi-company view, not this single-company one: the
    // auto-picked company may simply have no data in that one year and the
    // page would open on a false "sin resultados".
    CTB.applySelection(yearSelect, []);
    companySelect.innerHTML = companies.map((c) => `<option value="${CTB.escapeHtml(c)}">${CTB.escapeHtml(c)}</option>`).join('');

    // Restore from a shared/bookmarked link when present.
    const url = CTB.readUrlParams();
    if (url.has('companies')) companySelect.value = url.getAll('companies')[0] || '';
    if (url.has('years')) CTB.applySelection(yearSelect, url.getAll('years'));
    if (url.get('search')) searchInput.value = url.get('search');
    if (url.get('rubro')) rubroSelect.value = url.get('rubro');

    await loadPivot();
  } catch (err) {
    notConfigured.style.display = 'block';
    notConfigured.querySelector('p').textContent = 'Error al cargar: ' + err.message;
  }
})();
