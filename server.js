const express = require('express');
const path = require('path');

const settingsRoutes = require('./routes/settings');
const dataRoutes = require('./routes/data');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());
app.use('/api/settings', settingsRoutes);
app.use('/api', dataRoutes);
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

app.listen(PORT, () => {
  console.log(`Contabilidad corriendo en http://localhost:${PORT}`);
});
