(async function () {
  const notConfigured = document.getElementById('not-configured');
  const appContent = document.getElementById('app-content');
  const loadingLine = document.getElementById('loading-line');
  const syncPill = document.getElementById('sync-pill');
  const rowCountEl = document.getElementById('row-count');

  const companySelect = document.getElementById('f-companies');
  const countrySelect = document.getElementById('f-countries');
  const yearSelect = document.getElementById('f-years');
  const monthSelect = document.getElementById('f-months');
  const rubroSelect = document.getElementById('f-rubro');
  const searchInput = document.getElementById('f-search');

  let lastPivot = { periods: [], items: [] };
  let currentFilteredItems = [];
  let lastAppliedFilters = { years: [], months: [] };
  let multiCompany = true;
  const detailCache = new Map(); // `${sociedad}||${accountNo}` -> detail response

  function totalColumnCount() {
    return 1 /* toggle */ + (multiCompany ? 1 : 0) + 2 /* cuenta, nombre */ + lastPivot.periods.length + 1 /* total */;
  }

  function renderTable(pivot) {
    const filtered = rubroSelect.value ? pivot.items.filter((i) => i.rubro === rubroSelect.value) : pivot.items;
    currentFilteredItems = filtered;
    detailCache.clear();

    const head = document.getElementById('pivot-head');
    const body = document.getElementById('pivot-body');
    const showCompanyCol = multiCompany;

    head.innerHTML = `
      <th style="width:28px;"></th>
      ${showCompanyCol ? '<th class="text">Empresa</th>' : ''}
      <th class="text">N° cuenta</th>
      <th class="text">Nombre cuenta</th>
      ${pivot.periods.map((p) => `<th class="num">${CTB.fmtPeriod(p)}</th>`).join('')}
      <th class="num">Total</th>
    `;

    if (!filtered.length) {
      body.innerHTML = `<tr><td colspan="${totalColumnCount()}" class="hint" style="text-align:center;padding:24px;">Sin resultados para los filtros seleccionados.</td></tr>`;
      rowCountEl.textContent = '0 cuentas';
      return;
    }

    body.innerHTML = filtered.map((item, idx) => `
      <tr class="pivot-row" data-idx="${idx}">
        <td><button class="expand-toggle" data-idx="${idx}" title="Ver detalle de movimientos">▸</button></td>
        ${showCompanyCol ? `<td class="text">${CTB.escapeHtml(item.sociedad)}</td>` : ''}
        <td class="text">${CTB.escapeHtml(item.accountNo)}</td>
        <td class="text">${CTB.escapeHtml(item.name || '')}</td>
        ${pivot.periods.map((p) => `<td class="num">${CTB.fmtMoney(item.periods[p] || 0, { decimals: 2 })}</td>`).join('')}
        <td class="num"><strong>${CTB.fmtMoney(item.total, { decimals: 2 })}</strong></td>
      </tr>
    `).join('');

    rowCountEl.textContent = `${filtered.length} cuenta(s) · ${pivot.periods.length} período(s)`;
  }

  function detailRowHtml(message) {
    return `<tr class="detail-row"><td colspan="${totalColumnCount()}"><div class="detail-wrap">${message}</div></td></tr>`;
  }

  function renderDetailContent(detail) {
    if (!detail.rows.length) {
      return '<div class="hint">Sin movimientos individuales para este cruce de filtros.</div>';
    }
    const rowsHtml = detail.rows.map((r) => `
      <tr>
        <td class="text">${r.Fecha ? new Date(r.Fecha).toLocaleDateString('es-CL') : ''}</td>
        <td class="text">${CTB.escapeHtml(r.TipoDocumento || '')} ${CTB.escapeHtml(r.NumDocumento || '')}</td>
        <td class="text">${CTB.escapeHtml(r.Descripcion || '')}</td>
        <td class="num">${CTB.fmtMoney(r.Importe, { decimals: 0 })}</td>
        <td class="num">${CTB.fmtMoney(r.ImporteDivisa, { decimals: 2 })}</td>
        <td class="text">${CTB.escapeHtml(r.CodUsuario || '')}</td>
      </tr>
    `).join('');
    const truncated = detail.total > detail.rows.length
      ? `<div class="hint">Mostrando ${detail.rows.length} de ${detail.total} movimiento(s). Filtra por año/mes para acotar más.</div>`
      : `<div class="hint">${detail.total} movimiento(s).</div>`;
    return `
      <table>
        <thead><tr>
          <th class="text">Fecha</th><th class="text">Documento</th><th class="text">Descripción</th>
          <th class="num">Importe</th><th class="num">Importe divisa</th><th class="text">Usuario</th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      ${truncated}
    `;
  }

  async function expandRow(idx, btn) {
    const row = document.querySelector(`tr.pivot-row[data-idx="${idx}"]`);
    if (!row) return;
    const item = currentFilteredItems[idx];
    btn.textContent = '▾';
    row.classList.add('expanded');
    row.insertAdjacentHTML('afterend', detailRowHtml('Cargando movimientos…'));

    const cacheKey = `${item.sociedad}||${item.accountNo}`;
    try {
      let detail = detailCache.get(cacheKey);
      if (!detail) {
        const params = CTB.qs({
          company: item.sociedad,
          account: item.accountNo,
          years: lastAppliedFilters.years,
          months: lastAppliedFilters.months,
        });
        detail = await CTB.fetchJSON(`/api/detail?${params}`);
        detailCache.set(cacheKey, detail);
      }
      const detailRow = row.nextElementSibling;
      if (detailRow) detailRow.querySelector('.detail-wrap').innerHTML = renderDetailContent(detail);
    } catch (err) {
      const detailRow = row.nextElementSibling;
      if (detailRow) detailRow.querySelector('.detail-wrap').innerHTML = `<div class="hint">Error: ${CTB.escapeHtml(err.message)}</div>`;
    }
  }

  function collapseRow(idx, btn) {
    const row = document.querySelector(`tr.pivot-row[data-idx="${idx}"]`);
    if (!row) return;
    btn.textContent = '▸';
    row.classList.remove('expanded');
    const detailRow = row.nextElementSibling;
    if (detailRow && detailRow.classList.contains('detail-row')) detailRow.remove();
  }

  document.getElementById('pivot-body').addEventListener('click', (e) => {
    const btn = e.target.closest('.expand-toggle');
    if (!btn) return;
    const idx = Number(btn.dataset.idx);
    const row = document.querySelector(`tr.pivot-row[data-idx="${idx}"]`);
    const isExpanded = row && row.classList.contains('expanded');
    if (isExpanded) collapseRow(idx, btn);
    else expandRow(idx, btn);
  });

  document.getElementById('btn-expand-all').addEventListener('click', () => {
    document.querySelectorAll('.expand-toggle').forEach((btn) => {
      const idx = Number(btn.dataset.idx);
      const row = document.querySelector(`tr.pivot-row[data-idx="${idx}"]`);
      if (row && !row.classList.contains('expanded')) expandRow(idx, btn);
    });
  });

  document.getElementById('btn-collapse-all').addEventListener('click', () => {
    document.querySelectorAll('.expand-toggle').forEach((btn) => {
      const idx = Number(btn.dataset.idx);
      const row = document.querySelector(`tr.pivot-row[data-idx="${idx}"]`);
      if (row && row.classList.contains('expanded')) collapseRow(idx, btn);
    });
  });

  function exportCsv() {
    const filtered = currentFilteredItems;
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
      lastAppliedFilters = {
        years: CTB.selectedValues(yearSelect),
        months: CTB.selectedValues(monthSelect),
      };
      const params = CTB.qs({
        companies,
        countries: CTB.selectedValues(countrySelect),
        years: lastAppliedFilters.years,
        months: lastAppliedFilters.months,
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
    Array.from(countrySelect.options).forEach((o) => (o.selected = false));
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
    const countries = await CTB.fetchJSON('/api/countries');
    countrySelect.innerHTML = countries.map((c) => `<option value="${CTB.escapeHtml(c)}">${CTB.escapeHtml(c)}</option>`).join('');
    await CTB.populateFilters({ companySelect, yearSelect });
    await loadReport();
  } catch (err) {
    notConfigured.style.display = 'block';
    notConfigured.querySelector('p').textContent = 'Error al cargar: ' + err.message;
  }
})();
