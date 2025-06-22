// src/index.js
require('dotenv').config()
const express  = require('express')
const cors     = require('cors')
const mongoose = require('mongoose')
const { syncLocationsRange } = require('./scraper')

const app  = express()
const PORT = process.env.PORT || 4000

// 1) Connect to MongoDB “visits” database
mongoose
  .connect(process.env.MONGO_URI, { dbName: 'visits' })
  .then(() => console.log('✔︎ MongoDB connected'))
  .catch(err => {
    console.error('✖︎ MongoDB connection error:', err.message)
    process.exit(1)
  })

// 2) Middleware
app.use(cors())
app.use(express.json())

// 3) Health-check endpoint
app.get('/', (req, res) => {
  res.send('🚀 visits-scraper API up; try GET /api/visits')
})

// 4) /api/visits with auto-scrape of missing dates + date validation
app.get('/api/visits', async (req, res) => {
  // --- location(s) parsing ---
  let locations = req.query.locations
  const single  = req.query.location
  if (!locations) {
    if (single) locations = [single]
    else return res.status(400).json({ error:'location or locations[] required' })
  }
  if (!Array.isArray(locations)) locations = [locations]

  // --- date validation & range ---
  const iso = /^\d{4}-\d{2}-\d{2}$/
  let from, to
  if (req.query.date) {
    if (!iso.test(req.query.date)) {
      return res.status(400).json({ error:'date must be YYYY-MM-DD' })
    }
    from = to = req.query.date
  } else {
    const { startDate, endDate } = req.query
    if (!startDate || !endDate) {
      return res.status(400)
        .json({ error:'provide date=YYYY-MM-DD or startDate & endDate' })
    }
    if (!iso.test(startDate)||!iso.test(endDate)) {
      return res.status(400)
        .json({ error:'startDate & endDate must be YYYY-MM-DD' })
    }
    from = startDate
    to   = endDate
  }

  try {
    const db = mongoose.connection.db

    // build list of all non-Sunday dates in range
    const expected = []
    for (let d=new Date(from); d<=new Date(to); d.setDate(d.getDate()+1)) {
      if (d.getUTCDay()!==0) expected.push(d.toISOString().slice(0,10))
    }

    // determine which locations still need scraping
    const toSync = []
    for (const loc of locations) {
      const coll = db.collection(loc.replace(/\s+/g,'_'))
      const present = await coll.distinct('date',{
        date:{ $gte: from, $lte: to }
      })
      const missing = expected.filter(d=>!present.includes(d))
      if (missing.length) toSync.push(loc)
    }

    // scrape only if there are gaps
    if (toSync.length) {
      console.log('🔄 scraping gaps for:', toSync)
      await syncLocationsRange(toSync, from, to)
    }

    // fetch & return all docs
    let all = []
    for (const loc of locations) {
      const coll = db.collection(loc.replace(/\s+/g,'_'))
      const docs = await coll
        .find({ date:{ $gte: from, $lte: to } })
        .sort({ date:1, time:1 })
        .toArray()
      all = all.concat(docs)
    }

    res.json(all)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: err.message })
  }
})

// 5) Start server
app.listen(PORT, () => {
  console.log(`🚀 Server listening on http://0.0.0.0:${PORT}`)
})
