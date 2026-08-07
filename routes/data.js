const express = require('express');
const router = express.Router();
const queries = require('../src/queries');
const analytics = require('../src/analytics');
const settingsStore = require('../src/settingsStore');

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
    years: parseListParam(query.years).map(Number),
    months: parseListParam(query.months).map(Number),
    periodFrom: toYearMonthInt(query.dateFrom),
    periodTo: toYearMonthInt(query.dateTo),
    search: query.search ? String(query.search).trim() : undefined,
  };
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
