(async function () {
  const notConfigured = document.getElementById('not-configured');
  const appContent = document.getElementById('app-content');
  const loadingLine = document.getElementById('loading-line');
  const syncPill = document.getElementById('sync-pill');
  const rowCountEl = document.getElementById('row-count');

  const companySelect = document.getElementById('f-companies');
  const countrySelect = document.getElementById('f-countries');
  const grupoSelect = document.getElementById('f-grupos');
  const yearSelect = document.getElementById('f-years');
  const monthSelect = document.getElementById('f-months');
  const rubroSelect = document.getElementById('f-rubro');
  const searchInput = document.getElementById('f-search');

  let lastPivot = { periods: [], items: [] };
  let currentFilteredItems = [];
  let lastAppliedFilters = { years: [], months: [] };
  let multiCompany = true;
  const detailCache = new Map(); // `${sociedad}||${accountNo}` -> detail response
  const expandedPairs = new Map(); // `${sociedad}||${accountNo}` -> { company, accountNo } — rows currently expanded on screen, fed to Excel export

  function totalColumnCount() {
    return 1 /* toggle */ + (multiCompany ? 2 : 0) /* empresa, grupo */ + 2 /* cuenta, nombre */ + lastPivot.periods.length + 1 /* total */;
  }

  function renderTable(pivot) {
    const filtered = rubroSelect.value ? pivot.items.filter((i) => i.rubro === rubroSelect.value) : pivot.items;
    currentFilteredItems = filtered;
    detailCache.clear();
    expandedPairs.clear();

    const head = document.getElementById('pivot-head');
    const body = document.getElementById('pivot-body');
    const showCompanyCol = multiCompany;

    head.innerHTML = `
      <th style="width:28px;"></th>
      ${showCompanyCol ? '<th class="text">Empresa</th><th class="text">Grupo</th>' : ''}
      <th class="text">N° cuenta</th>
      <th class="text">Nombre cuenta</th>
      ${pivot.periods.map((p) => `<th class="num">${CTB.fmtPeriod(p)}</th>`).join('')}
      <th class="num">Total</th>
    `;

    if (!filtered.length) {
      body.innerHTML = `<tr><td colspan="${totalColumnCount()}" class="hint" style="text-align:center;padding:24px;">Sin resultados para los filtros seleccionados.</td></tr>`;
      rowCountEl.textContent = '0 cuentas';
      renderGroupSummary();
      return;
    }

    body.innerHTML = filtered.map((item, idx) => `
      <tr class="pivot-row" data-idx="${idx}">
        <td><button class="expand-toggle" data-idx="${idx}" title="Ver detalle de movimientos" aria-label="Ver detalle de movimientos" aria-expanded="false">▸</button></td>
        ${showCompanyCol ? `<td class="text">${CTB.escapeHtml(item.sociedad)}</td><td class="text">${CTB.escapeHtml(item.grupo || 'Sin grupo')}</td>` : ''}
        <td class="text">${CTB.escapeHtml(item.accountNo)}</td>
        <td class="text">${CTB.escapeHtml(item.name || '')}</td>
        ${pivot.periods.map((p) => `<td class="num">${CTB.fmtMoney(item.periods[p] || 0, { decimals: 2 })}</td>`).join('')}
        <td class="num"><strong>${CTB.fmtMoney(item.total, { decimals: 2 })}</strong></td>
      </tr>
    `).join('');

    rowCountEl.textContent = `${filtered.length} cuenta(s) · ${pivot.periods.length} período(s)`;
    renderGroupSummary();
  }

  /** "Resumen por Grupo" panel — computed client-side from the pivot already fetched, no extra request. */
  function renderGroupSummary() {
    const card = document.getElementById('group-summary-card');
    if (!multiCompany || !currentFilteredItems.length) { card.style.display = 'none'; return; }

    const byGroup = new Map();
    currentFilteredItems.forEach((item) => {
      const key = item.grupo || 'Sin grupo';
      if (!byGroup.has(key)) byGroup.set(key, { grupo: key, periods: {}, total: 0 });
      const bucket = byGroup.get(key);
      Object.entries(item.periods).forEach(([p, v]) => { bucket.periods[p] = (bucket.periods[p] || 0) + v; });
      bucket.total += item.total;
    });
    const groups = Array.from(byGroup.values()).sort((a, b) => a.grupo.localeCompare(b.grupo, 'es'));
    if (groups.length <= 1) { card.style.display = 'none'; return; }

    card.style.display = 'block';
    document.getElementById('group-summary-head').innerHTML = `
      <th class="text">Grupo</th>
      ${lastPivot.periods.map((p) => `<th class="num">${CTB.fmtPeriod(p)}</th>`).join('')}
      <th class="num">Total</th>
    `;
    document.getElementById('group-summary-body').innerHTML = groups.map((g) => `
      <tr>
        <td class="text">${CTB.escapeHtml(g.grupo)}</td>
        ${lastPivot.periods.map((p) => `<td class="num">${CTB.fmtMoney(g.periods[p] || 0, { decimals: 2 })}</td>`).join('')}
        <td class="num"><strong>${CTB.fmtMoney(g.total, { decimals: 2 })}</strong></td>
      </tr>
    `).join('');
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
    btn.setAttribute('aria-expanded', 'true');
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
      expandedPairs.set(cacheKey, { company: item.sociedad, accountNo: item.accountNo });
    } catch (err) {
      const detailRow = row.nextElementSibling;
      if (detailRow) detailRow.querySelector('.detail-wrap').innerHTML = `<div class="hint">Error: ${CTB.escapeHtml(err.message)}</div>`;
    }
  }

  function collapseRow(idx, btn) {
    const row = document.querySelector(`tr.pivot-row[data-idx="${idx}"]`);
    if (!row) return;
    const item = currentFilteredItems[idx];
    btn.textContent = '▸';
    btn.setAttribute('aria-expanded', 'false');
    row.classList.remove('expanded');
    const detailRow = row.nextElementSibling;
    if (detailRow && detailRow.classList.contains('detail-row')) detailRow.remove();
    expandedPairs.delete(`${item.sociedad}||${item.accountNo}`);
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
    const headers = [multiCompany ? 'Empresa' : null, multiCompany ? 'Grupo' : null, 'N° cuenta', 'Nombre cuenta', ...lastPivot.periods, 'Total'].filter(Boolean);
    const lines = [headers.join(';')];
    filtered.forEach((item) => {
      const row = [
        multiCompany ? item.sociedad : null,
        multiCompany ? (item.grupo || 'Sin grupo') : null,
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

  function currentFilterState() {
    return {
      companies: CTB.selectedValues(companySelect),
      countries: CTB.selectedValues(countrySelect),
      grupos: CTB.selectedValues(grupoSelect),
      years: CTB.selectedValues(yearSelect),
      months: CTB.selectedValues(monthSelect),
      search: searchInput.value.trim(),
    };
  }

  async function exportExcel() {
    const btn = document.getElementById('btn-export-excel');
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Generando…';
    try {
      const res = await fetch('/api/report/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filters: currentFilterState(),
          pairs: Array.from(expandedPairs.values()),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Error ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `reporte-contabilidad-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      CTB.showError('No se pudo generar el Excel: ' + err.message, exportExcel);
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  }

  async function loadReport() {
    loadingLine.style.display = 'block';
    CTB.hideError();
    try {
      const filterState = currentFilterState();
      multiCompany = filterState.companies.length !== 1;
      lastAppliedFilters = { years: filterState.years, months: filterState.months };
      const params = CTB.qs(filterState);
      lastPivot = await CTB.fetchJSON(`/api/report${params ? '?' + params : ''}`);
      // Rubro isn't a server-side filter (see renderTable) but is folded into the
      // URL too so a shared link also restores it — the backend ignores unknown
      // params. Built from the query string (not an object) so repeated keys
      // like companies=A&companies=B survive instead of collapsing to one value.
      const urlParams = new URLSearchParams(params);
      if (rubroSelect.value) urlParams.set('rubro', rubroSelect.value); else urlParams.delete('rubro');
      CTB.writeUrlParams(urlParams.toString());
      renderTable(lastPivot);
    } catch (err) {
      rowCountEl.textContent = '';
      CTB.showError('No se pudo cargar el reporte: ' + err.message, loadReport);
    } finally {
      loadingLine.style.display = 'none';
    }
  }

  document.getElementById('btn-apply').addEventListener('click', loadReport);
  document.getElementById('btn-export').addEventListener('click', exportCsv);
  document.getElementById('btn-export-excel').addEventListener('click', exportExcel);
  document.getElementById('btn-toggle-group-summary').addEventListener('click', (e) => {
    const wrap = document.getElementById('group-summary-wrap');
    const collapsed = wrap.style.display === 'none';
    wrap.style.display = collapsed ? 'block' : 'none';
    e.target.textContent = collapsed ? 'Ocultar' : 'Mostrar';
  });
  rubroSelect.addEventListener('change', () => renderTable(lastPivot));
  searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadReport(); });
  document.getElementById('btn-clear').addEventListener('click', () => {
    CTB.applySelection(companySelect, []);
    CTB.applySelection(countrySelect, []);
    CTB.applySelection(grupoSelect, []);
    CTB.applySelection(yearSelect, []);
    CTB.applySelection(monthSelect, []);
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

    CTB.enhanceMultiSelect(companySelect, { label: 'Empresas' });
    CTB.enhanceMultiSelect(countrySelect, { label: 'País' });
    CTB.enhanceMultiSelect(grupoSelect, { label: 'Grupo' });
    CTB.enhanceMultiSelect(yearSelect, { label: 'Años' });
    CTB.enhanceMultiSelect(monthSelect, { label: 'Meses' });

    const [countries, groups] = await Promise.all([
      CTB.fetchJSON('/api/countries'),
      CTB.fetchJSON('/api/groups'),
    ]);
    countrySelect.innerHTML = countries.map((c) => `<option value="${CTB.escapeHtml(c)}">${CTB.escapeHtml(c)}</option>`).join('');
    CTB.refreshMultiSelect(countrySelect);
    grupoSelect.innerHTML = groups.distinctGroups.map((g) => `<option value="${CTB.escapeHtml(g)}">${CTB.escapeHtml(g)}</option>`).join('');
    CTB.refreshMultiSelect(grupoSelect);
    await CTB.populateFilters({ companySelect, yearSelect });

    // Restore filters from a shared/bookmarked link when present; otherwise
    // keep the existing default (most recent year, via populateFilters above).
    const url = CTB.readUrlParams();
    if (url.has('companies') || url.has('countries') || url.has('grupos') || url.has('years') || url.has('months') || url.has('rubro') || url.has('search')) {
      CTB.applySelection(companySelect, url.getAll('companies'));
      CTB.applySelection(countrySelect, url.getAll('countries'));
      CTB.applySelection(grupoSelect, url.getAll('grupos'));
      CTB.applySelection(yearSelect, url.getAll('years'));
      CTB.applySelection(monthSelect, url.getAll('months'));
      if (url.get('search')) searchInput.value = url.get('search');
      if (url.get('rubro')) rubroSelect.value = url.get('rubro');
    }
    await loadReport();
  } catch (err) {
    notConfigured.style.display = 'block';
    notConfigured.querySelector('p').textContent = 'Error al cargar: ' + err.message;
  }
})();
