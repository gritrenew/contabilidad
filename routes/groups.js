const express = require('express');
const router = express.Router();
const queries = require('../src/queries');
const groupsStore = require('../src/groupsStore');
const adminAuth = require('../src/adminAuth');

// Public: the distinct Grupo list feeds the Grupo filter on every data page —
// it doesn't reveal anything sensitive, just the classification names already
// visible anywhere a Grupo column shows up.
router.get('/', (req, res) => {
  try {
    res.json({ distinctGroups: groupsStore.getDistinctGroups() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin-only: the full company -> Grupo/Tag table for the Mantenedor editor.
router.get('/admin', adminAuth.requireAdmin, async (req, res) => {
  try {
    const companies = await queries.getCompanies();
    const rows = companies.map((name) => {
      const entry = groupsStore.getEntry(name);
      return { name, grupo: entry.grupo, tag: entry.tag };
    });
    res.json({ rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/admin', adminAuth.requireAdmin, (req, res) => {
  try {
    groupsStore.saveAll(req.body.rows || []);
    res.json({ ok: true, distinctGroups: groupsStore.getDistinctGroups() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
