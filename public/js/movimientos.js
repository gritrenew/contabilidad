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
  const searchInput = document.getElementById('f-search');

  function renderTable(result) {
    const head = document.getElementById('pivot-head');
    const body = document.getElementById('pivot-body');

    head.innerHTML = `
      <th class="text">Fecha</th>
      <th class="text">Empresa</th>
      <th class="text">Grupo</th>
      <th class="text">N° cuenta</th>
      <th class="text">Nombre cuenta</th>
      <th class="text">Documento</th>
      <th class="text">Descripción</th>
      <th class="num">Importe</th>
      <th class="num">Importe divisa</th>
      <th class="text">Usuario</th>
    `;

    if (!result.rows.length) {
      body.innerHTML = `<tr><td colspan="10" class="hint" style="text-align:center;padding:24px;">Sin resultados para los filtros seleccionados.</td></tr>`;
      rowCountEl.textContent = '0 movimientos';
      return;
    }

    body.innerHTML = result.rows.map((r) => `
      <tr>
        <td class="text">${r.Fecha ? new Date(r.Fecha).toLocaleDateString('es-CL') : ''}</td>
        <td class="text">${CTB.escapeHtml(r.Sociedad)}</td>
        <td class="text">${CTB.escapeHtml(r.Grupo || 'Sin grupo')}</td>
        <td class="text">${CTB.escapeHtml(r.G_L_Account_No)}</td>
        <td class="text">${CTB.escapeHtml(r.G_L_Account_Name || '')}</td>
        <td class="text">${CTB.escapeHtml(r.TipoDocumento || '')} ${CTB.escapeHtml(r.NumDocumento || '')}</td>
        <td class="text">${CTB.escapeHtml(r.Descripcion || '')}</td>
        <td class="num">${CTB.fmtMoney(r.Importe, { decimals: 0 })}</td>
        <td class="num">${CTB.fmtMoney(r.ImporteDivisa, { decimals: 2 })}</td>
        <td class="text">${CTB.escapeHtml(r.CodUsuario || '')}</td>
      </tr>
    `).join('');

    rowCountEl.textContent = result.truncated
      ? `Mostrando ${result.rows.length} de ${result.total} movimiento(s) — acota los filtros para ver el resto, o usa Exportar Excel.`
      : `${result.total} movimiento(s)`;
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

  async function loadMovimientos() {
    loadingLine.style.display = 'block';
    CTB.hideError();
    try {
      const filterState = currentFilterState();
      const params = CTB.qs(filterState);
      const result = await CTB.fetchJSON(`/api/movimientos${params ? '?' + params : ''}`);
      CTB.writeUrlParams(params);
      renderTable(result);
    } catch (err) {
      rowCountEl.textContent = '';
      CTB.showError('No se pudo cargar el listado: ' + err.message, loadMovimientos);
    } finally {
      loadingLine.style.display = 'none';
    }
  }

  async function exportExcel() {
    const btn = document.getElementById('btn-export-excel');
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Generando…';
    try {
      const res = await fetch('/api/movimientos/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filters: currentFilterState() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Error ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `movimientos-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      CTB.showError('No se pudo generar el Excel: ' + err.message, exportExcel);
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  }

  document.getElementById('btn-apply').addEventListener('click', loadMovimientos);
  document.getElementById('btn-export-excel').addEventListener('click', exportExcel);
  searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadMovimientos(); });
  document.getElementById('btn-clear').addEventListener('click', () => {
    CTB.applySelection(companySelect, []);
    CTB.applySelection(countrySelect, []);
    CTB.applySelection(grupoSelect, []);
    CTB.applySelection(yearSelect, []);
    CTB.applySelection(monthSelect, []);
    searchInput.value = '';
    loadMovimientos();
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

    const [countries, groups, companies, years] = await Promise.all([
      CTB.fetchJSON('/api/countries'),
      CTB.fetchJSON('/api/groups'),
      CTB.fetchJSON('/api/companies'),
      CTB.fetchJSON('/api/years'),
    ]);
    countrySelect.innerHTML = countries.map((c) => `<option value="${CTB.escapeHtml(c)}">${CTB.escapeHtml(c)}</option>`).join('');
    grupoSelect.innerHTML = groups.distinctGroups.map((g) => `<option value="${CTB.escapeHtml(g)}">${CTB.escapeHtml(g)}</option>`).join('');
    companySelect.innerHTML = companies.map((c) => `<option value="${CTB.escapeHtml(c)}">${CTB.escapeHtml(c)}</option>`).join('');
    yearSelect.innerHTML = years.map((y) => `<option value="${y}">${y}</option>`).join('');
    CTB.refreshMultiSelect(countrySelect);
    CTB.refreshMultiSelect(grupoSelect);
    CTB.refreshMultiSelect(companySelect);
    CTB.refreshMultiSelect(yearSelect);
    // No auto-selected year here (unlike Reporte): this page's whole point is
    // "all historical movements" by default, not the most recent year only.

    const url = CTB.readUrlParams();
    if (url.has('companies') || url.has('countries') || url.has('grupos') || url.has('years') || url.has('months') || url.has('search')) {
      CTB.applySelection(companySelect, url.getAll('companies'));
      CTB.applySelection(countrySelect, url.getAll('countries'));
      CTB.applySelection(grupoSelect, url.getAll('grupos'));
      CTB.applySelection(yearSelect, url.getAll('years'));
      CTB.applySelection(monthSelect, url.getAll('months'));
      if (url.get('search')) searchInput.value = url.get('search');
    }

    await loadMovimientos();
  } catch (err) {
    notConfigured.style.display = 'block';
    notConfigured.querySelector('p').textContent = 'Error al cargar: ' + err.message;
  }
})();
