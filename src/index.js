// src/index.js
require('dotenv').config();
const express  = require('express');
const mongoose = require('mongoose');
const { syncVisits } = require('./scraper');

const app = express();
const PORT = process.env.PORT || 4000;

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(() => console.log('✔︎ MongoDB connected'))
  .catch(err => {
    console.error('✖︎ MongoDB connection error:', err.message);
    process.exit(1);
  });

// Route to trigger scraping
app.get('/sync', async (req, res) => {
  const { location, date } = req.query;
  if (!location || !date) {
    return res.status(400).send('Error: location & date query parameters are required.');
  }
  try {
    await syncVisits(location, date);
    res.send(`Synced data for ${location} on ${date}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Scraping failed.');
  }
});

// Health check
app.get('/', (req, res) => {
  res.send('🚀 Backend is up and MongoDB is connected!');
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server listening on http://localhost:${PORT}`);
});
