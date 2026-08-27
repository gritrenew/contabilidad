/**
 * Rubro classification follows the chart-of-accounts prefix convention visible
 * in the source ledgers: 1x = Activo, 23x = Patrimonio, 2x (else) = Pasivo,
 * 4x = Gasto (incl. 47x impuestos), 5x = Ingreso. The "P&L" subtotal in the
 * original spreadsheets is the raw sum of the 4x/5x accounts with no sign
 * flip, so we mirror that exactly here.
 *
 * This prefix convention was validated against real data for Chile only
 * (0% of rows fall outside it). España (Plan General Contable) and Colombia
 * (PUC) use different numbering — e.g. a Spanish "7000002 VENTAS" account is
 * Ingreso there but would misclassify as "Otro" under this scheme. Until we
 * add per-country rules, non-Chile rows are deliberately classified "Otro"
 * so they never silently pollute the Activo/Pasivo/Patrimonio/Resultado KPIs —
 * they still show up in full in the Reporte page (raw pivot), just not folded
 * into these totals.
 */
function classifyRubro(accountNo, pais) {
  if (pais && pais !== 'Chile') return 'Otro';
  const match = String(accountNo || '').match(/^(\d{2})/);
  if (!match) return 'Otro';
  const twoDigit = match[1];
  const firstDigit = twoDigit[0];
  if (firstDigit === '1') return 'Activo';
  if (twoDigit === '23') return 'Patrimonio';
  if (firstDigit === '2') return 'Pasivo';
  if (firstDigit === '4') return 'Gasto';
  if (firstDigit === '5') return 'Ingreso';
  return 'Otro';
}

const RESULT_RUBROS = new Set(['Ingreso', 'Gasto']);

function buildDashboard(rows) {
  const totals = { Activo: 0, Pasivo: 0, Patrimonio: 0, Ingreso: 0, Gasto: 0, Otro: 0 };
  const perCompany = new Map();
  const perAccount = new Map();
  const perMonth = new Map();
  const companiesSet = new Set();
  const accountsSet = new Set();
  let movimientos = 0;

  for (const row of rows) {
    const rubro = classifyRubro(row.G_L_Account_No, row.Pais);
    const saldo = Number(row.Saldo) || 0;
    totals[rubro] = (totals[rubro] || 0) + saldo;
    movimientos += row.Movimientos || 0;
    companiesSet.add(row.Sociedad);
    accountsSet.add(row.G_L_Account_No);

    if (!perCompany.has(row.Sociedad)) {
      perCompany.set(row.Sociedad, { sociedad: row.Sociedad, resultado: 0, activo: 0, pasivo: 0, patrimonio: 0 });
    }
    const company = perCompany.get(row.Sociedad);
    if (RESULT_RUBROS.has(rubro)) company.resultado += saldo;
    if (rubro === 'Activo') company.activo += saldo;
    if (rubro === 'Pasivo') company.pasivo += saldo;
    if (rubro === 'Patrimonio') company.patrimonio += saldo;

    // Top-accounts-by-magnitude is rubro-agnostic (every amount is already in
    // the common reporting currency), so every country contributes here even
    // though only Chile feeds the classified KPI totals above.
    const accountKey = `${row.G_L_Account_No}||${row.G_L_Account_Name}`;
    if (!perAccount.has(accountKey)) {
      perAccount.set(accountKey, { accountNo: row.G_L_Account_No, name: row.G_L_Account_Name, saldo: 0, rubro });
    }
    perAccount.get(accountKey).saldo += saldo;

    if (RESULT_RUBROS.has(rubro)) {
      const periodKey = `${row.Anio}-${String(row.Mes).padStart(2, '0')}`;
      if (!perMonth.has(periodKey)) {
        perMonth.set(periodKey, { periodo: periodKey, ingreso: 0, gasto: 0 });
      }
      const bucket = perMonth.get(periodKey);
      if (rubro === 'Ingreso') bucket.ingreso += saldo;
      else bucket.gasto += saldo;
    }
  }

  const resultado = totals.Ingreso + totals.Gasto;

  const monthly = Array.from(perMonth.values())
    .sort((a, b) => a.periodo.localeCompare(b.periodo))
    .map((m) => ({ ...m, resultado: m.ingreso + m.gasto }));

  const topAccounts = Array.from(perAccount.values())
    .sort((a, b) => Math.abs(b.saldo) - Math.abs(a.saldo))
    .slice(0, 10);

  const companiesArr = Array.from(perCompany.values());
  const topPositiveCompanies = [...companiesArr]
    .filter((c) => c.resultado > 0)
    .sort((a, b) => b.resultado - a.resultado)
    .slice(0, 5);
  const topNegativeCompanies = [...companiesArr]
    .filter((c) => c.resultado < 0)
    .sort((a, b) => a.resultado - b.resultado)
    .slice(0, 5);

  return {
    kpis: {
      activo: totals.Activo,
      pasivo: totals.Pasivo,
      patrimonio: totals.Patrimonio,
      ingreso: totals.Ingreso,
      gasto: totals.Gasto,
      resultado,
      empresas: companiesSet.size,
      cuentas: accountsSet.size,
      movimientos,
    },
    monthly,
    topAccounts,
    topPositiveCompanies,
    topNegativeCompanies,
  };
}

/** Pivots the flat (Sociedad, Cuenta, Anio, Mes, Saldo) rows into one row per account per company. */
function buildPivot(rows) {
  const accountMap = new Map();
  const periodsSet = new Set();

  for (const row of rows) {
    const periodKey = `${row.Anio}-${String(row.Mes).padStart(2, '0')}`;
    periodsSet.add(periodKey);
    const rowKey = `${row.Sociedad}||${row.G_L_Account_No}`;
    if (!accountMap.has(rowKey)) {
      accountMap.set(rowKey, {
        sociedad: row.Sociedad,
        pais: row.Pais || null,
        grupo: row.Grupo || null,
        tag: row.Tag || null,
        accountNo: row.G_L_Account_No,
        name: row.G_L_Account_Name,
        rubro: classifyRubro(row.G_L_Account_No, row.Pais),
        periods: {},
        total: 0,
      });
    }
    const entry = accountMap.get(rowKey);
    const saldo = Number(row.Saldo) || 0;
    entry.periods[periodKey] = (entry.periods[periodKey] || 0) + saldo;
    entry.total += saldo;
  }

  const periods = Array.from(periodsSet).sort();
  const items = Array.from(accountMap.values()).sort((a, b) =>
    a.sociedad === b.sociedad ? a.accountNo.localeCompare(b.accountNo) : a.sociedad.localeCompare(b.sociedad)
  );

  return { periods, items };
}

/**
 * Summarizes a pivot's items by Grupo (per-period + total), for the "Resumen
 * por Grupo" panel on Reporte — computed client-side from data already
 * fetched for the main table, so it needs no extra DB round trip. Items with
 * no Grupo assigned in Mantenedor fall under "Sin grupo" rather than being
 * dropped, so the subtotals always foot to the same grand total as the table.
 */
function buildGroupSummary(pivot) {
  const groupMap = new Map();
  for (const item of pivot.items) {
    const key = item.grupo || 'Sin grupo';
    if (!groupMap.has(key)) groupMap.set(key, { grupo: key, periods: {}, total: 0 });
    const bucket = groupMap.get(key);
    Object.entries(item.periods).forEach(([period, value]) => {
      bucket.periods[period] = (bucket.periods[period] || 0) + value;
    });
    bucket.total += item.total;
  }
  return Array.from(groupMap.values()).sort((a, b) => a.grupo.localeCompare(b.grupo, 'es'));
}

/** Pivots cumulative-balance rows (Sociedad, Cuenta, Saldo — no period) into one row per account with Sociedad as columns. */
function buildClosingBalancePivot(rows) {
  const accountMap = new Map();
  const companiesSet = new Set();

  for (const row of rows) {
    companiesSet.add(row.Sociedad);
    const rowKey = `${row.G_L_Account_No}||${row.G_L_Account_Name}`;
    if (!accountMap.has(rowKey)) {
      accountMap.set(rowKey, {
        accountNo: row.G_L_Account_No,
        name: row.G_L_Account_Name,
        balances: {},
        total: 0,
      });
    }
    const entry = accountMap.get(rowKey);
    const saldo = Number(row.Saldo) || 0;
    entry.balances[row.Sociedad] = (entry.balances[row.Sociedad] || 0) + saldo;
    entry.total += saldo;
  }

  const companies = Array.from(companiesSet).sort((a, b) => a.localeCompare(b, 'es'));
  const items = Array.from(accountMap.values()).sort((a, b) => a.accountNo.localeCompare(b.accountNo));

  return { companies, items };
}

module.exports = { classifyRubro, buildDashboard, buildPivot, buildGroupSummary, buildClosingBalancePivot };
