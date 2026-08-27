const express = require('express');
const router = express.Router();
const queries = require('../src/queries');
const analytics = require('../src/analytics');
const settingsStore = require('../src/settingsStore');
const excelExport = require('../src/excelExport');

// Express (via the `qs` query parser) already turns repeated keys
// (?companies=A&companies=B) into an array — no comma-splitting here, since a
// company/country name can itself contain a comma (see common.js `qs`).
function parseListParam(raw) {
  if (raw === undefined || raw === null || raw === '') return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr.map((v) => String(v).trim()).filter(Boolean);
}

/** "YYYY-MM-DD" (native <input type="date">) -> YYYYMM integer, e.g. "2026-07-15" -> 202607. */
function toYearMonthInt(dateStr) {
  if (!dateStr) return undefined;
  const match = String(dateStr).match(/^(\d{4})-(\d{2})/);
  return match ? Number(match[1] + match[2]) : undefined;
}

function parseFilters(query) {
  return {
    companies: parseListParam(query.companies),
    countries: parseListParam(query.countries),
    grupos: parseListParam(query.grupos),
    years: parseListParam(query.years).map(Number),
    months: parseListParam(query.months).map(Number),
    periodFrom: toYearMonthInt(query.dateFrom),
    periodTo: toYearMonthInt(query.dateTo),
    search: query.search ? String(query.search).trim() : undefined,
  };
}

/** Same shape as parseFilters, but reading a JSON body (POST /report/export) instead of query-string arrays. */
function parseFiltersFromBody(f = {}) {
  const arr = (v) => (Array.isArray(v) ? v : v ? [v] : []);
  return {
    companies: arr(f.companies),
    countries: arr(f.countries),
    grupos: arr(f.grupos),
    years: arr(f.years).map(Number),
    months: arr(f.months).map(Number),
    periodFrom: f.periodFrom || undefined,
    periodTo: f.periodTo || undefined,
    search: f.search ? String(f.search).trim() : undefined,
  };
}

/** "YYYY-MM" -> YYYYMM integer, e.g. "2026-06" -> 202606 (used by /cierre's closing-month picker). */
function toYearMonthShort(value) {
  if (!value) return undefined;
  const match = String(value).match(/^(\d{4})-(\d{2})$/);
  return match ? Number(match[1] + match[2]) : undefined;
}

router.get('/status', (req, res) => {
  res.json({ configured: settingsStore.isConfigured() });
});

router.get('/companies', async (req, res) => {
  try {
    res.json(await queries.getCompanies());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/years', async (req, res) => {
  try {
    res.json(await queries.getYears());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/countries', async (req, res) => {
  try {
    res.json(await queries.getCountries());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/report', async (req, res) => {
  try {
    const rows = await queries.getMovementSummary(parseFilters(req.query));
    res.json(analytics.buildPivot(rows));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/dashboard', async (req, res) => {
  try {
    const rows = await queries.getMovementSummary(parseFilters(req.query));
    res.json(analytics.buildDashboard(rows));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Excel export for Reporte. Takes the *filters* used for the current view plus
 * the (company, accountNo) pairs the user had expanded on screen — by design,
 * transaction-level detail is only bundled for rows the user deliberately
 * expanded (see the "Detalle" sheet), not for every row the filter matches,
 * which could mean tens of thousands of accounts across several months.
 */
router.post('/report/export', async (req, res) => {
  try {
    const filters = parseFiltersFromBody(req.body.filters);
    const rows = await queries.getMovementSummary(filters);
    const pivot = analytics.buildPivot(rows);
    const groupSummary = analytics.buildGroupSummary(pivot);
    const multiCompany = new Set(rows.map((r) => r.Sociedad)).size !== 1;

    const pairs = Array.isArray(req.body.pairs) ? req.body.pairs : [];
    let details = [];
    let detailTruncated = false;
    if (pairs.length) {
      const bulk = await queries.getMovementDetailBulk(pairs, { years: filters.years, months: filters.months });
      detailTruncated = bulk.truncated;
      const grouped = new Map();
      bulk.rows.forEach((r) => {
        const key = `${r.Sociedad}||${r.G_L_Account_No}`;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(r);
      });
      details = pairs.map(({ company, accountNo }) => {
        const item = pivot.items.find((i) => i.sociedad === company && i.accountNo === accountNo);
        return {
          sociedad: company,
          accountNo,
          name: item ? item.name : '',
          rows: grouped.get(`${company}||${accountNo}`) || [],
        };
      });
    }

    const wb = excelExport.buildReportWorkbook({ pivot, groupSummary, multiCompany, details, detailTruncated });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="reporte-contabilidad-${new Date().toISOString().slice(0, 10)}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/cierre', async (req, res) => {
  try {
    const filters = {
      companies: parseListParam(req.query.companies),
      countries: parseListParam(req.query.countries),
      grupos: parseListParam(req.query.grupos),
      search: req.query.search ? String(req.query.search).trim() : undefined,
      periodTo: toYearMonthShort(req.query.period),
    };
    const rows = await queries.getCumulativeBalance(filters);
    res.json(analytics.buildClosingBalancePivot(rows));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/cierre/export', async (req, res) => {
  try {
    const body = req.body || {};
    const filters = {
      companies: Array.isArray(body.companies) ? body.companies : [],
      countries: Array.isArray(body.countries) ? body.countries : [],
      grupos: Array.isArray(body.grupos) ? body.grupos : [],
      search: body.search ? String(body.search).trim() : undefined,
      periodTo: toYearMonthShort(body.period),
    };
    const rows = await queries.getCumulativeBalance(filters);
    const pivot = analytics.buildClosingBalancePivot(rows);
    const wb = excelExport.buildClosingBalanceWorkbook({ pivot, periodLabel: body.period || '' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="saldo-cierre-${body.period || ''}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/detail', async (req, res) => {
  try {
    const { company, account } = req.query;
    if (!company || !account) {
      return res.status(400).json({ error: 'Falta company o account' });
    }
    const filters = parseFilters(req.query);
    const result = await queries.getMovementDetail({
      company,
      accountNo: account,
      years: filters.years,
      months: filters.months,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
