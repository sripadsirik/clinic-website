// src/index.js
require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const mongoose = require('mongoose');
const { syncLocationsRange } = require('./scraper');

const app  = express();
const PORT = process.env.PORT || 4000;

// 1) connect once to your “visits” database
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

// 2) middleware
app.use(cors());           // allow cross-origin from your Expo web client
app.use(express.json());   // parse JSON bodies

// 3) trigger a scrape
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

// 4) fetch visits from Mongo
app.get('/api/visits', async (req, res) => {
  // allow either ?location=Foo or ?locations[]=Foo&locations[]=Bar
  let locations = req.query.locations;
  const single  = req.query.location;
  if (!locations) {
    if (single) locations = [single];
    else return res.status(400).json({ error:'location or locations[] required' });
  }

  // date=YYYY-MM-DD OR startDate & endDate
  let from, to;
  if (req.query.date) {
    from = to = req.query.date;
  } else {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ error:'provide date=YYYY-MM-DD or startDate & endDate' });
    }
    from = startDate;
    to   = endDate;
  }

  try {
    const db = mongoose.connection.db;
    let all = [];

    for (const loc of locations) {
      const safeLoc = loc.replace(/\s+/g,'_');
      const coll    = db.collection(safeLoc);

      // our documents have date: "YYYY-MM-DD", so lexicographical compare works
      const docs = await coll
        .find({ date: { $gte: from, $lte: to } })
        .sort({ date: 1, time: 1 })
        .toArray();

      all = all.concat(docs);
    }

    return res.json(all);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => {
  res.send('🚀 visits-scraper API up; try GET /api/sync or /api/visits');
});

app.listen(PORT, () => {
  console.log(`🚀 Server listening on http://localhost:${PORT}`);
});
