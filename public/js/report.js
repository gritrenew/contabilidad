(async function () {
  const notConfigured = document.getElementById('not-configured');
  const appContent = document.getElementById('app-content');
  const loadingLine = document.getElementById('loading-line');
  const syncPill = document.getElementById('sync-pill');
  const rowCountEl = document.getElementById('row-count');

  const companySelect = document.getElementById('f-companies');
  const yearSelect = document.getElementById('f-years');
  const monthSelect = document.getElementById('f-months');
  const rubroSelect = document.getElementById('f-rubro');
  const searchInput = document.getElementById('f-search');

  let lastPivot = { periods: [], items: [] };
  let multiCompany = true;

  function renderTable(pivot) {
    const filtered = rubroSelect.value ? pivot.items.filter((i) => i.rubro === rubroSelect.value) : pivot.items;
    const head = document.getElementById('pivot-head');
    const body = document.getElementById('pivot-body');

    const showCompanyCol = multiCompany;
    head.innerHTML = `
      ${showCompanyCol ? '<th class="text">Empresa</th>' : ''}
      <th class="text">N° cuenta</th>
      <th class="text">Nombre cuenta</th>
      ${pivot.periods.map((p) => `<th class="num">${CTB.fmtPeriod(p)}</th>`).join('')}
      <th class="num">Total</th>
    `;

    if (!filtered.length) {
      body.innerHTML = `<tr><td colspan="${(showCompanyCol ? 1 : 0) + 3 + pivot.periods.length}" class="hint" style="text-align:center;padding:24px;">Sin resultados para los filtros seleccionados.</td></tr>`;
      rowCountEl.textContent = '0 cuentas';
      return;
    }

    body.innerHTML = filtered.map((item) => `
      <tr>
        ${showCompanyCol ? `<td class="text">${CTB.escapeHtml(item.sociedad)}</td>` : ''}
        <td class="text">${CTB.escapeHtml(item.accountNo)}</td>
        <td class="text">${CTB.escapeHtml(item.name || '')}</td>
        ${pivot.periods.map((p) => `<td class="num">${CTB.fmtMoney(item.periods[p] || 0, { decimals: 2 })}</td>`).join('')}
        <td class="num"><strong>${CTB.fmtMoney(item.total, { decimals: 2 })}</strong></td>
      </tr>
    `).join('');

    rowCountEl.textContent = `${filtered.length} cuenta(s) · ${pivot.periods.length} período(s)`;
  }

  function exportCsv() {
    const filtered = rubroSelect.value ? lastPivot.items.filter((i) => i.rubro === rubroSelect.value) : lastPivot.items;
    if (!filtered.length) return;
    const headers = [multiCompany ? 'Empresa' : null, 'N° cuenta', 'Nombre cuenta', ...lastPivot.periods, 'Total'].filter(Boolean);
    const lines = [headers.join(';')];
    filtered.forEach((item) => {
      const row = [
        multiCompany ? item.sociedad : null,
        item.accountNo,
        `"${(item.name || '').replace(/"/g, '""')}"`,
        ...lastPivot.periods.map((p) => String((item.periods[p] || 0)).replace('.', ',')),
        String(item.total).replace('.', ','),
      ].filter((v) => v !== null);
      lines.push(row.join(';'));
    });
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reporte-contabilidad-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function loadReport() {
    loadingLine.style.display = 'block';
    try {
      const companies = CTB.selectedValues(companySelect);
      multiCompany = companies.length !== 1;
      const params = CTB.qs({
        companies,
        years: CTB.selectedValues(yearSelect),
        months: CTB.selectedValues(monthSelect),
        search: searchInput.value.trim(),
      });
      lastPivot = await CTB.fetchJSON(`/api/report${params ? '?' + params : ''}`);
      renderTable(lastPivot);
    } catch (err) {
      rowCountEl.textContent = 'Error: ' + err.message;
    } finally {
      loadingLine.style.display = 'none';
    }
  }

  document.getElementById('btn-apply').addEventListener('click', loadReport);
  document.getElementById('btn-export').addEventListener('click', exportCsv);
  rubroSelect.addEventListener('change', () => renderTable(lastPivot));
  searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadReport(); });
  document.getElementById('btn-clear').addEventListener('click', () => {
    Array.from(companySelect.options).forEach((o) => (o.selected = false));
    Array.from(yearSelect.options).forEach((o) => (o.selected = false));
    Array.from(monthSelect.options).forEach((o) => (o.selected = false));
    rubroSelect.value = '';
    searchInput.value = '';
    loadReport();
  });

  try {
    const status = await CTB.fetchJSON('/api/status');
    if (!status.configured) {
      notConfigured.style.display = 'block';
      syncPill.textContent = 'Sin configurar';
      return;
    }
    syncPill.textContent = 'Conectado';
    appContent.style.display = 'block';
    await CTB.populateFilters({ companySelect, yearSelect });
    await loadReport();
  } catch (err) {
    notConfigured.style.display = 'block';
    notConfigured.querySelector('p').textContent = 'Error al cargar: ' + err.message;
  }
})();
