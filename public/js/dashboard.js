(async function () {
  const notConfigured = document.getElementById('not-configured');
  const appContent = document.getElementById('app-content');
  const loadingLine = document.getElementById('loading-line');
  const syncPill = document.getElementById('sync-pill');

  const dateFromInput = document.getElementById('f-date-from');
  const dateToInput = document.getElementById('f-date-to');
  const countrySelect = document.getElementById('f-country');
  const companySelect = document.getElementById('f-company');
  const rankingSearch = document.getElementById('f-ranking-search');

  let charts = {};
  let lastRanking = { topPositiveCompanies: [], topNegativeCompanies: [] };

  function themeColor(varName) {
    return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  }

  function baseChartOptions(extra = {}) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: extra.legend !== false,
          labels: { color: themeColor('--text-secondary'), boxWidth: 10, usePointStyle: true, font: { size: 11.5 } },
        },
        tooltip: {
          backgroundColor: themeColor('--surface-card'),
          titleColor: themeColor('--text-primary'),
          bodyColor: themeColor('--text-secondary'),
          borderColor: themeColor('--border'),
          borderWidth: 1,
          padding: 10,
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${CTB.fmtCompact(ctx.parsed.y ?? ctx.parsed.x)}`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: themeColor('--text-muted'), font: { size: 11 } },
          border: { color: themeColor('--baseline') },
        },
        y: {
          grid: { color: themeColor('--gridline') },
          ticks: { color: themeColor('--text-muted'), font: { size: 11 }, callback: (v) => CTB.fmtCompact(v) },
          border: { display: false },
        },
      },
    };
  }

  function destroyChart(key) {
    if (charts[key]) { charts[key].destroy(); delete charts[key]; }
  }

  function renderTrendChart(monthly) {
    destroyChart('trend');
    const ctx = document.getElementById('chart-trend');
    charts.trend = new Chart(ctx, {
      type: 'line',
      data: {
        labels: monthly.map((m) => CTB.fmtPeriod(m.periodo)),
        datasets: [
          {
            label: 'Ingresos',
            data: monthly.map((m) => m.ingreso),
            borderColor: themeColor('--series-1'),
            backgroundColor: themeColor('--series-1') + '1a',
            fill: true, tension: 0.25, borderWidth: 2, pointRadius: 3,
          },
          {
            label: 'Gastos',
            data: monthly.map((m) => Math.abs(m.gasto)),
            borderColor: themeColor('--series-2'),
            backgroundColor: themeColor('--series-2') + '1a',
            fill: true, tension: 0.25, borderWidth: 2, pointRadius: 3,
          },
        ],
      },
      options: baseChartOptions(),
    });
  }

  function renderResultadoChart(monthly) {
    destroyChart('resultado');
    const ctx = document.getElementById('chart-resultado');
    const good = themeColor('--series-1');
    const bad = themeColor('--series-2');
    charts.resultado = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: monthly.map((m) => CTB.fmtPeriod(m.periodo)),
        datasets: [{
          label: 'Resultado',
          data: monthly.map((m) => m.resultado),
          backgroundColor: monthly.map((m) => (m.resultado >= 0 ? good : bad)),
          borderRadius: 4,
          maxBarThickness: 24,
        }],
      },
      options: baseChartOptions({ legend: false }),
    });
  }

  function renderAccountsChart(topAccounts) {
    destroyChart('accounts');
    const ctx = document.getElementById('chart-accounts');
    const sorted = [...topAccounts].reverse();
    charts.accounts = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: sorted.map((a) => `${a.accountNo} · ${a.name}`.slice(0, 42)),
        datasets: [{
          label: 'Saldo',
          data: sorted.map((a) => a.saldo),
          backgroundColor: sorted.map((a) => (a.saldo >= 0 ? themeColor('--series-1') : themeColor('--series-2'))),
          borderRadius: 4,
          maxBarThickness: 16,
        }],
      },
      options: {
        ...baseChartOptions({ legend: false }),
        indexAxis: 'y',
        scales: {
          x: { grid: { color: themeColor('--gridline') }, ticks: { color: themeColor('--text-muted'), callback: (v) => CTB.fmtCompact(v) } },
          y: { grid: { display: false }, ticks: { color: themeColor('--text-secondary'), font: { size: 10.5 } } },
        },
      },
    });
  }

  function renderRanking() {
    const term = rankingSearch.value.trim().toLowerCase();
    const all = [...lastRanking.topPositiveCompanies, ...lastRanking.topNegativeCompanies]
      .filter((c) => !term || c.sociedad.toLowerCase().includes(term));
    const el = document.getElementById('company-ranking');
    if (!all.length) { el.innerHTML = '<div class="hint">Sin resultados.</div>'; return; }
    const maxAbs = Math.max(...all.map((c) => Math.abs(c.resultado)), 1);
    el.innerHTML = all.map((c) => {
      const pct = Math.min(100, (Math.abs(c.resultado) / maxAbs) * 100);
      const positive = c.resultado >= 0;
      const color = positive ? 'var(--series-1)' : 'var(--series-2)';
      const side = positive ? `left:50%; width:${pct / 2}%;` : `right:50%; width:${pct / 2}%;`;
      return `<div class="mono-row">
        <div class="name" title="${CTB.escapeHtml(c.sociedad)}">${CTB.escapeHtml(c.sociedad)}</div>
        <div class="bar-track"><div class="bar-fill" style="${side} background:${color};"></div></div>
        <div class="val" style="color:${color}">${CTB.fmtCompact(c.resultado)}</div>
      </div>`;
    }).join('');
  }

  function setKpi(id, value, colorize) {
    const el = document.getElementById(id);
    el.textContent = CTB.fmtCompact(value);
    if (colorize) el.className = 'value ' + (value >= 0 ? 'positive' : 'negative');
  }

  function currentParams() {
    return {
      companies: CTB.selectedValues(companySelect),
      countries: CTB.selectedValues(countrySelect),
      dateFrom: dateFromInput.value,
      dateTo: dateToInput.value,
    };
  }

  async function loadDashboard() {
    loadingLine.style.display = 'block';
    CTB.hideError();
    try {
      const query = CTB.qs(currentParams());
      const data = await CTB.fetchJSON(`/api/dashboard${query ? '?' + query : ''}`);
      CTB.writeUrlParams(query);

      setKpi('kpi-ingreso', data.kpis.ingreso);
      setKpi('kpi-gasto', Math.abs(data.kpis.gasto));
      setKpi('kpi-resultado', data.kpis.resultado, true);
      const margen = data.kpis.ingreso ? (data.kpis.resultado / data.kpis.ingreso) * 100 : 0;
      document.getElementById('kpi-margen').textContent = `${margen.toFixed(1)}%`;
      document.getElementById('kpi-margen').className = 'value ' + (margen >= 0 ? 'positive' : 'negative');

      setKpi('kpi-activo', data.kpis.activo);
      setKpi('kpi-pasivo', data.kpis.pasivo);
      setKpi('kpi-patrimonio', data.kpis.patrimonio);
      document.getElementById('kpi-empresas').textContent = data.kpis.empresas;

      renderTrendChart(data.monthly);
      renderResultadoChart(data.monthly);
      renderAccountsChart(data.topAccounts);
      lastRanking = { topPositiveCompanies: data.topPositiveCompanies, topNegativeCompanies: data.topNegativeCompanies };
      renderRanking();

      document.getElementById('last-updated').textContent =
        'Actualizado ' + new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
    } catch (err) {
      CTB.showError('No se pudo cargar el resumen: ' + err.message, loadDashboard);
    } finally {
      loadingLine.style.display = 'none';
    }
  }

  document.getElementById('btn-apply').addEventListener('click', loadDashboard);
  rankingSearch.addEventListener('input', renderRanking);

  try {
    const status = await CTB.fetchJSON('/api/status');
    if (!status.configured) {
      notConfigured.style.display = 'block';
      syncPill.textContent = 'Sin configurar';
      return;
    }
    syncPill.textContent = 'Conectado';
    appContent.style.display = 'block';

    CTB.enhanceMultiSelect(companySelect, { label: 'Empresa' });
    CTB.enhanceMultiSelect(countrySelect, { label: 'País' });

    const [companies, countries, years] = await Promise.all([
      CTB.fetchJSON('/api/companies'),
      CTB.fetchJSON('/api/countries'),
      CTB.fetchJSON('/api/years'),
    ]);
    companySelect.innerHTML = companies.map((c) => `<option value="${CTB.escapeHtml(c)}">${CTB.escapeHtml(c)}</option>`).join('');
    countrySelect.innerHTML = countries.map((c) => `<option value="${CTB.escapeHtml(c)}">${CTB.escapeHtml(c)}</option>`).join('');
    CTB.refreshMultiSelect(companySelect);
    CTB.refreshMultiSelect(countrySelect);

    // Restore filters from a shared/bookmarked link when present; otherwise
    // default to the most recent year (consistent with Reporte) rather than
    // the full history, which would silently load every year on first paint.
    const url = CTB.readUrlParams();
    if (url.has('companies') || url.has('countries') || url.has('dateFrom') || url.has('dateTo')) {
      CTB.applySelection(companySelect, url.getAll('companies'));
      CTB.applySelection(countrySelect, url.getAll('countries'));
      if (url.get('dateFrom')) dateFromInput.value = url.get('dateFrom');
      if (url.get('dateTo')) dateToInput.value = url.get('dateTo');
    } else if (years.length) {
      dateFromInput.value = `${years[years.length - 1]}-01-01`;
      dateToInput.value = new Date().toISOString().slice(0, 10);
    }
    await loadDashboard();
  } catch (err) {
    notConfigured.style.display = 'block';
    notConfigured.querySelector('p').textContent = 'Error al cargar: ' + err.message;
  }
})();
