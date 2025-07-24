require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const mongoose = require('mongoose');
const { spawnSync, spawn } = require('child_process');
const fs   = require('fs');
const path = require('path');

const app  = express();
const PORT = process.env.PORT || 4000;

const MONTH_NAMES = [
  'Jan','Feb','Mar','Apr','May','Jun',
  'Jul','Aug','Sep','Oct','Nov','Dec'
];

// Determine Python interpreter: prefer venv, else system python3
let pythonBinary = 'python3';
const venvWin = path.join(__dirname, '..', 'venv', 'Scripts', 'python.exe');
const venvUnix = path.join(__dirname, '..', 'venv', 'bin', 'python');
if (process.platform === 'win32' && fs.existsSync(venvWin)) {
  pythonBinary = venvWin;
} else if (fs.existsSync(venvUnix)) {
  pythonBinary = venvUnix;
}

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

// log incoming requests
app.use((req, res, next) => {
  console.log(`> ${req.method} ${req.originalUrl}`, req.query);
  next();
});

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

// buildExcludeFilter helper - excludes No-Show and Rescheduled data
function buildExcludeFilter() {
  return {
    status: {
      $nin: [
        "No-Show/Resched",
        "No-Show",
        "no-show",
        "Rescheduled",
        "rescheduled",
        "Reschedule",
        "reschedule"
      ]
    },
    reason: { $not: /^No Show/ }
  };
}

// ── 1) Leaderboard endpoint ────────────────────────────────────────────────────
// Returns an array of { location, leaderboard:[{doctor,count}...] }
app.get('/api/leaderboard', async (req, res) => {
  const { location = 'All', startDate, endDate } = req.query;
  if (!startDate || !endDate) return res.status(400).json({ error: 'startDate & endDate required' });
  const locs   = (location === 'All') ? ALL_LOCATIONS : [location];
  const filter = buildDateFilter(startDate, endDate);

  // ensure data exists for full range via Python Selenium scraper
  // console.log(`🔄 scraping missing data for ${locs.join(', ')} from ${startDate} to ${endDate}`);
  // const lbResult = spawnSync(pythonBinary, ['src/scraperselenium.py', ...locs, startDate, endDate], { stdio: 'inherit' });
  // if (lbResult.status !== 0) {
  //   console.error(`Leaderboard scraper failed: ${lbResult.status}`);
  //   return res.status(500).json({ error: `leaderboard scraper failed: ${lbResult.status}` });
  // }

  const results = [];
  for (const loc of locs) {
    const coll = mongoose.connection.db.collection(loc.replace(/\s+/g, '_'));
    const pipeline = [
      { $match: { ...filter, reason: { $not: /^No Show/ } } },
      { $group: { _id: '$doctor', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ];
    const agg = await coll.aggregate(pipeline).toArray();
    results.push({
      location: loc,
      leaderboard: agg.map(d => ({ doctor: d._id, count: d.count }))
    });
  }
  res.json(results);
});

// ── 2) KPI endpoint ────────────────────────────────────────────────────────────
app.get('/api/kpis', async (req, res) => {
  const { location = 'All', startDate, endDate } = req.query;
  if (!startDate || !endDate) return res.status(400).json({ error: 'startDate & endDate required' });
  const locs    = (location === 'All') ? ALL_LOCATIONS : [location];
  // ensure data exists for full range via Python Selenium scraper
  // console.log(`🔄 scraping missing data for ${locs.join(', ')} from ${startDate} to ${endDate}`);
  // const kpiResult = spawnSync(pythonBinary, ['src/scraperselenium.py', ...locs, startDate, endDate], { stdio: 'inherit' });
  // if (kpiResult.status !== 0) {
  //   console.error(`KPI scraper failed: ${kpiResult.status}`);
  //   return res.status(500).json({ error: `kpi scraper failed: ${kpiResult.status}` });
  // }
  const filter       = buildDateFilter(startDate, endDate);
  const exclude      = buildExcludeFilter();
  const byLocation   = [];
  const byDoctor     = [];
  const byNewPatients = [];

  for (const loc of locs) {
    const coll = mongoose.connection.db.collection(loc.replace(/\s+/g, '_'));
    const total = await coll.countDocuments({ ...filter, ...exclude });
    byLocation.push({ location: loc, patientsSeen: total });

    const docs = await coll.aggregate([
      { $match: { ...filter, ...exclude } },
      { $group: { _id: '$doctor', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]).toArray();
    byDoctor.push({
      location: loc,
      perDoctor: docs.map(d => ({ doctor: d._id, count: d.count }))
    });

    const newCount = await coll.countDocuments({ ...filter, ...exclude, type: 'NEW PATIENT' });
    byNewPatients.push({ location: loc, newPatients: newCount });
  }

  res.json({ byLocation, byDoctor, byNewPatients });
});

// ── 3) Visits endpoint ─────────────────────────────────────────────────────────
app.get('/api/visits', async (req, res) => {
  try {
    // determine which locations to include
    let locations;
    if (req.query.locations) locations = Array.isArray(req.query.locations) ? req.query.locations : [req.query.locations];
    else if (req.query.location) locations = [req.query.location];
    else locations = ALL_LOCATIONS;

    const iso = /^\d{4}-\d{2}-\d{2}$/;
    let { date, startDate, endDate } = req.query;
    if (date) {
      if (!iso.test(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
      startDate = endDate = date;
    } else {
      if (!iso.test(startDate) || !iso.test(endDate)) {
        return res.status(400).json({ error: 'startDate & endDate must be YYYY-MM-DD' });
      }
    }

    const db = mongoose.connection.db;

    // if requesting a single date and data is missing, trigger Python Selenium scraper
    // if (date) {
    //   const toScrape = [];
    //   for (const loc of locations) {
    //     const coll = db.collection(loc.replace(/\s+/g, '_'));
    //     const exists = await coll.findOne({ date });
    //     if (!exists) toScrape.push(loc);
    //   }
    //   if (toScrape.length) {
    //     console.log(`🔄 scraping missing data for ${toScrape.join(', ')} on ${date}`);
    //     const result = spawnSync(pythonBinary, ['src/scraperselenium.py', ...toScrape, date, date], { stdio: 'inherit' });
    //     if (result.status !== 0) {
    //       console.error(`Scraper exited with code ${result.status}`);
    //       return res.status(500).json({ error: `scraper failed: ${result.status}` });
    //     }
    //   }
    // } else {
    //   // if requesting a date range, trigger Python Selenium scraper for full range
    //   console.log(`🔄 scraping missing range ${startDate} to ${endDate} for ${locations.join(', ')}`);
    //   const rangeResult = spawnSync(pythonBinary, ['src/scraperselenium.py', ...locations, startDate, endDate], { stdio: 'inherit' });
    //   if (rangeResult.status !== 0) {
    //     console.error(`Range scraper exited with code ${rangeResult.status}`);
    //     return res.status(500).json({ error: `range scraper failed: ${rangeResult.status}` });
    //   }
    // }
    
    // fetch and return all visits
    let all = [];
    for (const loc of locations) {
      const coll = db.collection(loc.replace(/\s+/g, '_'));
      const docs = await coll
        .find({ date: { $gte: startDate, $lte: endDate } })
        .sort({ date: 1, time: 1 })
        .toArray();
      all.push(...docs);
    }
    res.json(all);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});



// POST /api/scrape triggers the Python Selenium scraper
app.post('/api/scrape', (req, res) => {
  const { startDate, endDate, locations } = req.body;
  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'startDate & endDate required' });
  }
  const locList = Array.isArray(locations) && locations.length ? locations : ALL_LOCATIONS;
  const args = [...locList, startDate, endDate];
  const py = spawn(pythonBinary, ['src/scraperselenium.py', ...args]);
  py.stdout.on('data', data => console.log(`scraper stdout: ${data}`));
  py.stderr.on('data', data => console.error(`scraper stderr: ${data}`));
  py.on('close', code => {
    if (code === 0) res.json({ status: 'completed' });
    else res.status(500).json({ status: 'error', code });
  });
});

// ── 4) Technicians endpoint ─────────────────────────────────────────────────────
// Returns technician leaderboard with sub-breakdown by doctor
app.get('/api/techs', async (req, res) => {
  try {
    const { location = 'All', startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate & endDate required' });
    }
    const locs = (location === 'All') ? ALL_LOCATIONS : [location];
    const filter = buildDateFilter(startDate, endDate);

    // Connect to technicians database
    const techsDb = mongoose.connection.client.db('technicians');
    
    const results = [];
    for (const loc of locs) {
      const coll = techsDb.collection(loc.replace(/\s+/g, '_'));
      
      // Aggregate pipeline to group by user, then by doctor within each user
      const pipeline = [
        { $match: filter },
        {
          $group: {
            _id: {
              user: '$user',
              doctor: '$doctor'
            },
            taskCount: { $sum: '$task_count' }
          }
        },
        {
          $group: {
            _id: '$_id.user',
            totalTasks: { $sum: '$taskCount' },
            doctors: {
              $push: {
                doctor: '$_id.doctor',
                taskCount: '$taskCount'
              }
            }
          }
        },
        {
          $project: {
            user: '$_id',
            totalTasks: 1,
            doctors: {
              $sortArray: {
                input: '$doctors',
                sortBy: { taskCount: -1 }
              }
            }
          }
        },
        { $sort: { totalTasks: -1 } }
      ];
      
      const agg = await coll.aggregate(pipeline).toArray();
      results.push({
        location: loc,
        technicians: agg.map(t => ({
          user: t.user,
          totalTasks: t.totalTasks,
          doctors: t.doctors
        }))
      });
    }
    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server listening on http://0.0.0.0:${PORT}`);
});









// src/index.js
// require('dotenv').config();
// const express  = require('express');
// const cors     = require('cors');
// const mongoose = require('mongoose');
// // const { syncLocationsRange } = require('./scraper'); // scraping disabled

// const app  = express();
// const PORT = process.env.PORT || 4000;

// const MONTH_NAMES = [
//   'Jan','Feb','Mar','Apr','May','Jun',
//   'Jul','Aug','Sep','Oct','Nov','Dec'
// ];

// // ① Connect to Mongo
// mongoose
//   .connect(process.env.MONGO_URI, { dbName: 'visits' })
//   .then(() => console.log('✔︎ MongoDB connected'))
//   .catch(err => {
//     console.error('✖︎ MongoDB connection error:', err.message);
//     process.exit(1);
//   });

// app.use(cors());
// app.use(express.json());

// // log incoming requests
// app.use((req, res, next) => {
//   console.log(`> ${req.method} ${req.originalUrl}`, req.query);
//   next();
// });

// // Clinics list
// const ALL_LOCATIONS = [
//   'Oak Lawn',
//   'Orland Park',
//   'Albany Park',
//   'Buffalo Grove',
//   'OakBrook',
//   'Schaumburg',
// ];

// // buildDateFilter helper
// function buildDateFilter(start, end) {
//   return { date: { $gte: start, $lte: end } };
// }

// // buildExcludeFilter helper - excludes No-Show and Rescheduled data
// function buildExcludeFilter() {
//   return {
//     status: {
//       $nin: [
//         "No-Show/Resched",
//         "No-Show",
//         "no-show",
//         "Rescheduled",
//         "rescheduled",
//         "Reschedule",
//         "reschedule"
//       ]
//     },
//     reason: { $not: /^No Show/ }
//   };
// }

// // ── 1) Leaderboard endpoint ────────────────────────────────────────────────────
// // Returns an array of { location, leaderboard:[{doctor,count}...] }
// app.get('/api/leaderboard', async (req, res) => {
//   try {
//     const { location = 'All', startDate, endDate } = req.query;
//     if (!startDate || !endDate) {
//       return res.status(400).json({ error: 'startDate & endDate required' });
//     }
//     const locs = (location === 'All') ? ALL_LOCATIONS : [location];
//     const filter = buildDateFilter(startDate, endDate);

//     // raw visits leaderboard: count all visits per doctor
//     const results = [];
//     for (const loc of locs) {
//       const coll = mongoose.connection.db.collection(loc.replace(/\s+/g,'_'));
//       const pipeline = [
//         // exclude visits with a reason starting "No Show"
//         { $match: { ...filter, reason: { $not: /^No Show/ } } },
//         { $group: { _id: '$doctor', count: { $sum: 1 } } },
//         { $sort: { count: -1 } }
//       ];
//       const agg = await coll.aggregate(pipeline).toArray();
//       results.push({
//         location: loc,
//         leaderboard: agg.map(d => ({ doctor: d._id, count: d.count }))
//       });
//     }
//     res.json(results);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: err.message });
//   }
// });

// // ── 2) KPI endpoint ───────────────────────────────────────────────────────────
// // Returns { byLocation:[{location,patientsSeen}], byDoctor:[{location,perDoctor:[{doctor,count}]}], byNewPatients:[{location,newPatients}] }
// app.get('/api/kpis', async (req, res) => {
//   try {
//     const { location = 'All', startDate, endDate } = req.query;
//     if (!startDate || !endDate) {
//       return res.status(400).json({ error: 'startDate & endDate required' });
//     }
//     const locs = (location === 'All') ? ALL_LOCATIONS : [location];
//     const filter = buildDateFilter(startDate, endDate);

//     const byLocation = [];
//     const byDoctor   = [];
//     const byNewPatients = [];
//     const excludeFilter = buildExcludeFilter();
    
//     for (const loc of locs) {
//       const coll = mongoose.connection.db.collection(loc.replace(/\s+/g,'_'));
//       const total = await coll.countDocuments({ ...filter, ...excludeFilter });
//       byLocation.push({ location: loc, patientsSeen: total });

//       const docs = await coll.aggregate([
//         { $match: { ...filter, ...excludeFilter } },
//         { $group: { _id: '$doctor', count: { $sum: 1 } } },
//         { $sort: { count: -1 } },
//       ]).toArray();
//       byDoctor.push({
//         location: loc,
//         perDoctor: docs.map(d => ({ doctor: d._id, count: d.count }))
//       });

//       // New patients calculation - count visits with type "NEW PATIENT"
//       const newPatientCount = await coll.countDocuments({ 
//         ...filter, 
//         ...excludeFilter,
//         type: "NEW PATIENT"
//       });
      
//       byNewPatients.push({ location: loc, newPatients: newPatientCount });
//     }
//     res.json({ byLocation, byDoctor, byNewPatients });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: err.message });
//   }
// });

// // ── 3) Comparison endpoint ────────────────────────────────────────────────────
// // Returns { location, thisYear, lastYear }
// app.get('/api/comparison', async (req, res) => {
//   try {
//     let { location } = req.query;
//     if (!location) {
//       return res.status(400).json({ error: 'location is required' });
//     }
//     // if someone does happen to send "All", just treat it as all real locations:
//     const isAll = location === 'All';
//     if (isAll) location = undefined;

//     const today = new Date();
//     const thisYear = today.getFullYear();
//     const currentMonth = today.getMonth();

//     const months = MONTH_NAMES.slice(0, currentMonth + 1);

//     async function countFor(year) {
//       const results = [];
//       const excludeFilter = buildExcludeFilter();
      
//       for (let m = 0; m <= currentMonth; m++) {
//         const start = new Date(year, m, 1);
//         const end   = new Date(year, m+1, 1);
//         // if no location specified, loop all LOCATIONS
//         const locs = location
//           ? [location]
//           : ALL_LOCATIONS;
//         let monthTotal = 0;
//         await Promise.all(locs.map(async loc => {
//           const coll = mongoose.connection.db.collection(loc.replace(/\s+/g,'_'));
//           const cnt  = await coll.countDocuments({
//             date: { 
//               $gte: start.toISOString().slice(0,10),
//               $lt:  end.toISOString().slice(0,10)
//             },
//             ...excludeFilter
//           });
//           monthTotal += cnt;
//         }));
//         results.push(monthTotal);
//       }
//       return results;
//     }

//     const [thisYearCounts, lastYearCounts] = await Promise.all([
//       countFor(thisYear),
//       countFor(thisYear - 1)
//     ]);

//     res.json({
//       location: location || 'All',
//       months,
//       thisYear: thisYearCounts,
//       lastYear: lastYearCounts,
//     });

//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: err.message });
//   }
// });

// // Root endpoint and visits retrieval
// app.get('/', (req, res) => res.send('🚀 visits-scraper API up; try GET /api/visits'));
// app.get('/api/visits', async (req, res) => {
//   try {
//     // determine which locations to include
//     let locations;
//     if (req.query.locations) {
//       locations = Array.isArray(req.query.locations) ? req.query.locations : [req.query.locations];
//     } else if (req.query.location) {
//       locations = [req.query.location];
//     } else {
//       locations = ALL_LOCATIONS;
//     }
//     // validate date parameters
//     const iso = /^\d{4}-\d{2}-\d{2}$/;
//     let { date, startDate, endDate } = req.query;
//     if (date) {
//       if (!iso.test(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
//       startDate = endDate = date;
//     } else {
//       if (!iso.test(startDate) || !iso.test(endDate)) {
//         return res.status(400).json({ error: 'startDate & endDate must be YYYY-MM-DD' });
//       }
//     }
//     const db = mongoose.connection.db;
//     // scraping disabled; just use existing MongoDB data

//     // fetch and return all visits
//     let all = [];
//     for (const loc of locations) {
//       const coll = db.collection(loc.replace(/\s+/g, '_'));
//       const docs = await coll.find({ date: { $gte: startDate, $lte: endDate } }).sort({ date:1, time:1 }).toArray();
//       all = all.concat(docs);
//     }
//     res.json(all);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: err.message });
//   }
// });


// app.listen(PORT, '0.0.0.0', () => {
//   console.log(`🚀 Server listening on http://0.0.0.0:${PORT}`);
// });


