(async function () {
  const notConfigured = document.getElementById('not-configured');
  const appContent = document.getElementById('app-content');
  const loadingLine = document.getElementById('loading-line');
  const syncPill = document.getElementById('sync-pill');
  const rowCountEl = document.getElementById('row-count');

  const periodSelect = document.getElementById('f-period');
  const countrySelect = document.getElementById('f-countries');
  const grupoSelect = document.getElementById('f-grupos');
  const companySelect = document.getElementById('f-companies');
  const searchInput = document.getElementById('f-search');

  let lastPivot = { companies: [], items: [] };

  function renderTable(pivot) {
    const head = document.getElementById('pivot-head');
    const body = document.getElementById('pivot-body');

    head.innerHTML = `
      <th class="text">N° cuenta</th>
      <th class="text">Nombre cuenta</th>
      ${pivot.companies.map((c) => `<th class="num">${CTB.escapeHtml(c)}</th>`).join('')}
      <th class="num">Total</th>
    `;

    if (!pivot.items.length) {
      const totalCols = 2 + pivot.companies.length + 1;
      body.innerHTML = `<tr><td colspan="${totalCols}" class="hint" style="text-align:center;padding:24px;">Sin resultados para los filtros seleccionados.</td></tr>`;
      rowCountEl.textContent = '0 cuentas';
      return;
    }

    body.innerHTML = pivot.items.map((item) => `
      <tr>
        <td class="text">${CTB.escapeHtml(item.accountNo)}</td>
        <td class="text">${CTB.escapeHtml(item.name || '')}</td>
        ${pivot.companies.map((c) => `<td class="num">${CTB.fmtMoney(item.balances[c] || 0, { decimals: 2 })}</td>`).join('')}
        <td class="num"><strong>${CTB.fmtMoney(item.total, { decimals: 2 })}</strong></td>
      </tr>
    `).join('');

    rowCountEl.textContent = `${pivot.items.length} cuenta(s) · ${pivot.companies.length} sociedad(es)`;
  }

  function currentFilterState() {
    return {
      period: periodSelect.value,
      companies: CTB.selectedValues(companySelect),
      countries: CTB.selectedValues(countrySelect),
      grupos: CTB.selectedValues(grupoSelect),
      search: searchInput.value.trim(),
    };
  }

  async function loadPivot() {
    if (!periodSelect.value) return;
    loadingLine.style.display = 'block';
    CTB.hideError();
    try {
      const filterState = currentFilterState();
      const params = CTB.qs(filterState);
      lastPivot = await CTB.fetchJSON(`/api/cierre${params ? '?' + params : ''}`);
      CTB.writeUrlParams(params);
      renderTable(lastPivot);
    } catch (err) {
      rowCountEl.textContent = '';
      CTB.showError('No se pudo cargar el saldo al cierre: ' + err.message, loadPivot);
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
      const res = await fetch('/api/cierre/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentFilterState()),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Error ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `saldo-cierre-${periodSelect.value}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      CTB.showError('No se pudo generar el Excel: ' + err.message, exportExcel);
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  }

  document.getElementById('btn-apply').addEventListener('click', loadPivot);
  document.getElementById('btn-export-excel').addEventListener('click', exportExcel);
  searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadPivot(); });
  document.getElementById('btn-clear').addEventListener('click', () => {
    CTB.applySelection(countrySelect, ['Chile']);
    CTB.applySelection(grupoSelect, []);
    CTB.applySelection(companySelect, []);
    searchInput.value = '';
    loadPivot();
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

    CTB.enhanceMultiSelect(countrySelect, { label: 'País' });
    CTB.enhanceMultiSelect(grupoSelect, { label: 'Grupo' });
    CTB.enhanceMultiSelect(companySelect, { label: 'Empresas' });

    const [report, countries, groups, companies] = await Promise.all([
      CTB.fetchJSON('/api/report'),
      CTB.fetchJSON('/api/countries'),
      CTB.fetchJSON('/api/groups'),
      CTB.fetchJSON('/api/companies'),
    ]);

    const periods = report.periods.slice().sort();
    periodSelect.innerHTML = periods.map((p) => `<option value="${p}">${CTB.fmtPeriod(p)}</option>`).join('');
    if (periods.length) periodSelect.value = periods[periods.length - 1];

    countrySelect.innerHTML = countries.map((c) => `<option value="${CTB.escapeHtml(c)}">${CTB.escapeHtml(c)}</option>`).join('');
    grupoSelect.innerHTML = groups.distinctGroups.map((g) => `<option value="${CTB.escapeHtml(g)}">${CTB.escapeHtml(g)}</option>`).join('');
    companySelect.innerHTML = companies.map((c) => `<option value="${CTB.escapeHtml(c)}">${CTB.escapeHtml(c)}</option>`).join('');

    // Default scope: Chile only (per product decision — showing all ~250
    // companies as columns by default would be unreadable). Restore from a
    // shared/bookmarked link when present instead.
    const url = CTB.readUrlParams();
    if (url.has('period') || url.has('companies') || url.has('countries') || url.has('grupos') || url.has('search')) {
      if (url.get('period')) periodSelect.value = url.get('period');
      CTB.applySelection(companySelect, url.getAll('companies'));
      CTB.applySelection(countrySelect, url.getAll('countries'));
      CTB.applySelection(grupoSelect, url.getAll('grupos'));
      if (url.get('search')) searchInput.value = url.get('search');
    } else {
      CTB.applySelection(countrySelect, ['Chile']);
    }
    CTB.refreshMultiSelect(countrySelect);
    CTB.refreshMultiSelect(grupoSelect);
    CTB.refreshMultiSelect(companySelect);

    await loadPivot();
  } catch (err) {
    notConfigured.style.display = 'block';
    notConfigured.querySelector('p').textContent = 'Error al cargar: ' + err.message;
  }
})();
