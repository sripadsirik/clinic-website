// src/index.js
require('dotenv').config();
const express = require('express');

const app = express();
const PORT = process.env.PORT || 4000;

app.get('/', (req, res) => {
  res.send('🚀 Backend is up!');
});

app.listen(PORT, () => {
  console.log(`🚀 Server listening on http://localhost:${PORT}`);
});