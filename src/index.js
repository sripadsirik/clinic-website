require('dotenv').config();
const express  = require('express');
const mongoose = require('mongoose');
const { syncLocationsRange } = require('./scraper');

const app  = express();
const PORT = process.env.PORT || 4000;

// connect once to your “visits” DB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser:    true,
  useUnifiedTopology: true,
  dbName:             'visits',
})
  .then(() => console.log('✔︎ MongoDB (visits) connected'))
  .catch(err => {
    console.error('✖︎ MongoDB connection error:', err.message);
    process.exit(1);
  });

app.use(express.json());

/**
 * GET /api/sync
 * required:
 *   • location=Foo   OR   • locations[]=Foo&locations[]=Bar
 * either:
 *   • date=YYYY-MM-DD
 * OR
 *   • startDate=YYYY-MM-DD & endDate=YYYY-MM-DD
 */
app.get('/api/sync', async (req, res) => {
  const { date, startDate, endDate } = req.query;
  let locations = req.query.locations;
  const single  = req.query.location;

  if (!locations) {
    if (single) locations = [single];
    else return res.status(400).json({ error:'location or locations[] required' });
  }

  try {
    if (date) {
      await syncLocationsRange(locations, date, date);
      return res.json({ ok:true, mode:'single', date, locations });
    }
    if (startDate && endDate) {
      await syncLocationsRange(locations, startDate, endDate);
      return res.json({ ok:true, mode:'range', startDate, endDate, locations });
    }
    return res.status(400).json({ error:'provide date=YYYY-MM-DD or startDate & endDate' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => {
  res.send('🚀 visits-scraper API up; try GET /api/sync');
});

app.listen(PORT, () => {
  console.log(`🚀 Server listening on http://localhost:${PORT}`);
});
