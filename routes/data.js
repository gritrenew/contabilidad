const express = require('express');
const router = express.Router();
const queries = require('../src/queries');
const analytics = require('../src/analytics');
const settingsStore = require('../src/settingsStore');

function parseListParam(raw) {
  if (raw === undefined || raw === null || raw === '') return [];
  const arr = Array.isArray(raw) ? raw : String(raw).split(',');
  return arr.map((v) => v.trim()).filter(Boolean);
}

function parseFilters(query) {
  return {
    companies: parseListParam(query.companies),
    countries: parseListParam(query.countries),
    years: parseListParam(query.years).map(Number),
    months: parseListParam(query.months).map(Number),
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

module.exports = router;
