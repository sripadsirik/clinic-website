// require('dotenv').config()
// const express  = require('express')
// const cors     = require('cors')
// const mongoose = require('mongoose')
// const { syncLocationsRange } = require('./scraper')

// const ALL_LOCATIONS = [
//   'Oak Lawn',
//   'Orland Park',
//   'Albany Park',
//   'Buffalo Grove',
//   'OakBrook',
//   'Schaumburg',
// ]

// const app  = express()
// const PORT = process.env.PORT || 4000

// mongoose
//   .connect(process.env.MONGO_URI, { dbName: 'visits' })
//   .then(() => console.log('✔︎ MongoDB connected'))
//   .catch(err => {
//     console.error('✖︎ MongoDB connection error:', err.message)
//     process.exit(1)
//   })

// app.use(cors())
// app.use(express.json())

// app.get('/', (req, res) => res.send('🚀 visits-scraper API up; try GET /api/visits'))

// app.get('/api/visits', async (req, res) => {
//   try {
//     // Support ?locations=Oak%20Lawn&locations=Orland%20Park
//     // or single ?location=Oak%20Lawn
//     // or nothing → use ALL_LOCATIONS
//     let locations;
//     if (req.query.locations) {
//       locations = Array.isArray(req.query.locations)
//         ? req.query.locations
//         : [req.query.locations];
//     } else if (req.query.location) {
//       locations = [req.query.location];
//     } else {
//       locations = ALL_LOCATIONS;
//     }
//     const iso = /^\d{4}-\d{2}-\d{2}$/
//     let { date, startDate, endDate } = req.query
//     if (date) {
//       if (!iso.test(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' })
//       startDate = endDate = date
//     } else {
//       if (!iso.test(startDate) || !iso.test(endDate)) {
//         return res.status(400).json({ error: 'startDate & endDate must be YYYY-MM-DD' })
//       }
//     }

//     const db = mongoose.connection.db
//     // build list of non-Sunday dates
//     const expected = []
//     for (let d=new Date(startDate); d<=new Date(endDate); d.setDate(d.getDate()+1)) {
//       if (d.getUTCDay() !== 0) expected.push(d.toISOString().slice(0,10))
//     }

//     // check which locs need scraping
//     const toSync = []
//     for (const loc of locations) {
//       const coll    = db.collection(loc.replace(/\s+/g,'_'))
//       const present = await coll.distinct('date',{ date:{ $gte: startDate, $lte: endDate } })
//       if (expected.some(d => !present.includes(d))) toSync.push(loc)
//     }

//     if (toSync.length) {
//       console.log('🔄 scraping gaps for:', toSync)
//       await syncLocationsRange(toSync, startDate, endDate)
//     }

//     // return everything
//     let all = []
//     for (const loc of locations) {
//       const coll = db.collection(loc.replace(/\s+/g,'_'))
//       const docs = await coll
//         .find({ date:{ $gte:startDate, $lte:endDate } })
//         .sort({ date:1, time:1 })
//         .toArray()
//       all = all.concat(docs)
//     }
//     res.json(all)

//   } catch (err) {
//     console.error(err)
//     res.status(500).json({ error: err.message })
//   }
// })

// app.listen(PORT, () => console.log(`🚀 Server listening on http://0.0.0.0:${PORT}`))







// src/index.js
require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const mongoose = require('mongoose');

const app  = express();
const PORT = process.env.PORT || 4000;

const MONTH_NAMES = [
  'Jan','Feb','Mar','Apr','May','Jun',
  'Jul','Aug','Sep','Oct','Nov','Dec'
];

// ① Connect to Mongo
mongoose
  .connect(process.env.MONGO_URI, { dbName: 'visits' })
  .then(() => console.log('✔︎ MongoDB connected'))
  .catch(err => {
    console.error('✖︎ MongoDB connection error:', err.message);
    process.exit(1);
  });

app.use(cors());
app.use(express.json());

// Clinics list
const ALL_LOCATIONS = [
  'Oak Lawn',
  'Orland Park',
  'Albany Park',
  'Buffalo Grove',
  'OakBrook',
  'Schaumburg',
];

// buildDateFilter helper
function buildDateFilter(start, end) {
  return { date: { $gte: start, $lte: end } };
}

// ── 1) Leaderboard endpoint ────────────────────────────────────────────────────
// Returns an array of { location, leaderboard:[{doctor,count}...] }
app.get('/api/leaderboard', async (req, res) => {
  try {
    const { location = 'All', startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate & endDate required' });
    }
    const locs = (location === 'All') ? ALL_LOCATIONS : [location];
    const filter = buildDateFilter(startDate, endDate);

    const STATUS_MAP = {
      'Orland Park':  ['MD Exit','OD Exit'],
      'Oak Lawn':     ['MD Exit','OD/Post-Op Exit'],
      'Albany Park':  ['Exit'],
      'Buffalo Grove':['Exit'],
      'OakBrook':     ['Exit'],
      'Schaumburg':   ['Exit'],
    };

    const results = [];
    for (const loc of locs) {
      const coll = mongoose.connection.db.collection(loc.replace(/\s+/g,'_'));
      const statuses = STATUS_MAP[loc] || [];
      const pipeline = [
        { $match: { ...filter, status: { $in: statuses } } },
        { $group: { _id: '$doctor', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ];
      const agg = await coll.aggregate(pipeline).toArray();
      results.push({
        location: loc,
        leaderboard: agg.map(d => ({ doctor: d._id, count: d.count }))
      });
    }
    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── 2) KPI endpoint ───────────────────────────────────────────────────────────
// Returns { byLocation:[{location,patientsSeen}], byDoctor:[{location,perDoctor:[{doctor,count}]}] }
app.get('/api/kpis', async (req, res) => {
  try {
    const { location = 'All', startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate & endDate required' });
    }
    const locs = (location === 'All') ? ALL_LOCATIONS : [location];
    const filter = buildDateFilter(startDate, endDate);

    const byLocation = [];
    const byDoctor   = [];
    for (const loc of locs) {
      const coll = mongoose.connection.db.collection(loc.replace(/\s+/g,'_'));
      const total = await coll.countDocuments(filter);
      byLocation.push({ location: loc, patientsSeen: total });

      const docs = await coll.aggregate([
        { $match: filter },
        { $group: { _id: '$doctor', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]).toArray();
      byDoctor.push({
        location: loc,
        perDoctor: docs.map(d => ({ doctor: d._id, count: d.count }))
      });
    }
    res.json({ byLocation, byDoctor });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── 3) Comparison endpoint ────────────────────────────────────────────────────
// Returns { location, thisYear, lastYear }
app.get('/api/comparison', async (req, res) => {
  try {
    let { location } = req.query;
    if (!location) {
      return res.status(400).json({ error: 'location is required' });
    }
    // if someone does happen to send “All”, just treat it as all real locations:
    const isAll = location === 'All';
    if (isAll) location = undefined;

    const today = new Date();
    const thisYear = today.getFullYear();
    const currentMonth = today.getMonth();

    const months = MONTH_NAMES.slice(0, currentMonth + 1);

    async function countFor(year) {
      const results = [];
      for (let m = 0; m <= currentMonth; m++) {
        const start = new Date(year, m, 1);
        const end   = new Date(year, m+1, 1);
        // if no location specified, loop all LOCATIONS
        const locs = location
          ? [location]
          : ALL_LOCATIONS;
        let monthTotal = 0;
        await Promise.all(locs.map(async loc => {
          const coll = mongoose.connection.db.collection(loc.replace(/\s+/g,'_'));
          const cnt  = await coll.countDocuments({
            date: { 
              $gte: start.toISOString().slice(0,10),
              $lt:  end.toISOString().slice(0,10)
            },
            // status: { $ne: null }
          });
          monthTotal += cnt;
        }));
        results.push(monthTotal);
      }
      return results;
    }

    const [thisYearCounts, lastYearCounts] = await Promise.all([
      countFor(thisYear),
      countFor(thisYear - 1)
    ]);

    res.json({
      location: location || 'All',
      months,
      thisYear: thisYearCounts,
      lastYear: lastYearCounts,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server listening on http://0.0.0.0:${PORT}`);
});