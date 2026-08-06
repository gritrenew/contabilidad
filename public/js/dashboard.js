(async function () {
  const notConfigured = document.getElementById('not-configured');
  const appContent = document.getElementById('app-content');
  const loadingLine = document.getElementById('loading-line');
  const syncPill = document.getElementById('sync-pill');

  const companySelect = document.getElementById('f-companies');
  const yearSelect = document.getElementById('f-years');

  let charts = {};

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
            data: monthly.map((m) => m.gasto),
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
    const bad = themeColor('--bad');
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
          backgroundColor: sorted.map((a) => (a.saldo >= 0 ? themeColor('--series-1') : themeColor('--bad'))),
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

  function renderRanking(topPositive, topNegative) {
    const el = document.getElementById('company-ranking');
    const all = [...topPositive, ...topNegative];
    if (!all.length) { el.innerHTML = '<div class="hint">Sin datos para los filtros seleccionados.</div>'; return; }
    const maxAbs = Math.max(...all.map((c) => Math.abs(c.resultado)), 1);
    el.innerHTML = all.map((c) => {
      const pct = Math.min(100, (Math.abs(c.resultado) / maxAbs) * 100);
      const positive = c.resultado >= 0;
      const color = positive ? 'var(--series-1)' : 'var(--bad)';
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

  async function loadDashboard() {
    loadingLine.style.display = 'block';
    try {
      const params = CTB.qs({
        companies: CTB.selectedValues(companySelect),
        years: CTB.selectedValues(yearSelect),
      });
      const data = await CTB.fetchJSON(`/api/dashboard${params ? '?' + params : ''}`);
      setKpi('kpi-activo', data.kpis.activo);
      setKpi('kpi-pasivo', data.kpis.pasivo);
      setKpi('kpi-patrimonio', data.kpis.patrimonio);
      setKpi('kpi-resultado', data.kpis.resultado, true);
      document.getElementById('kpi-empresas').textContent = data.kpis.empresas;
      document.getElementById('kpi-cuentas').textContent = data.kpis.cuentas;

      renderTrendChart(data.monthly);
      renderResultadoChart(data.monthly);
      renderAccountsChart(data.topAccounts);
      renderRanking(data.topPositiveCompanies, data.topNegativeCompanies);

      document.getElementById('last-updated').textContent =
        'Actualizado ' + new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
    } catch (err) {
      document.getElementById('company-ranking').innerHTML = `<div class="hint">Error: ${CTB.escapeHtml(err.message)}</div>`;
    } finally {
      loadingLine.style.display = 'none';
    }
  }

  document.getElementById('btn-apply').addEventListener('click', loadDashboard);
  document.getElementById('btn-clear').addEventListener('click', () => {
    Array.from(companySelect.options).forEach((o) => (o.selected = false));
    Array.from(yearSelect.options).forEach((o) => (o.selected = false));
    loadDashboard();
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
    await loadDashboard();
  } catch (err) {
    notConfigured.style.display = 'block';
    notConfigured.querySelector('p').textContent = 'Error al cargar: ' + err.message;
  }
})();
