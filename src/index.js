require('dotenv').config()
const express  = require('express')
const cors     = require('cors')
const mongoose = require('mongoose')
const { syncLocationsRange } = require('./scraper')

const app  = express()
const PORT = process.env.PORT || 4000

mongoose
  .connect(process.env.MONGO_URI, { dbName: 'visits' })
  .then(() => console.log('✔︎ MongoDB connected'))
  .catch(err => {
    console.error('✖︎ MongoDB connection error:', err.message)
    process.exit(1)
  })

app.use(cors())
app.use(express.json())

app.get('/', (req, res) => res.send('🚀 visits-scraper API up; try GET /api/visits'))

app.get('/api/visits', async (req, res) => {
  try {
    let locations = req.query.locations || (req.query.location && [req.query.location])
    if (!locations) return res.status(400).json({ error: 'location or locations[] required' })

    const iso = /^\d{4}-\d{2}-\d{2}$/
    let { date, startDate, endDate } = req.query
    if (date) {
      if (!iso.test(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' })
      startDate = endDate = date
    } else {
      if (!iso.test(startDate) || !iso.test(endDate)) {
        return res.status(400).json({ error: 'startDate & endDate must be YYYY-MM-DD' })
      }
    }

    const db = mongoose.connection.db
    // build list of non-Sunday dates
    const expected = []
    for (let d=new Date(startDate); d<=new Date(endDate); d.setDate(d.getDate()+1)) {
      if (d.getUTCDay() !== 0) expected.push(d.toISOString().slice(0,10))
    }

    // check which locs need scraping
    const toSync = []
    for (const loc of locations) {
      const coll    = db.collection(loc.replace(/\s+/g,'_'))
      const present = await coll.distinct('date',{ date:{ $gte: startDate, $lte: endDate } })
      if (expected.some(d => !present.includes(d))) toSync.push(loc)
    }

    if (toSync.length) {
      console.log('🔄 scraping gaps for:', toSync)
      await syncLocationsRange(toSync, startDate, endDate)
    }

    // return everything
    let all = []
    for (const loc of locations) {
      const coll = db.collection(loc.replace(/\s+/g,'_'))
      const docs = await coll
        .find({ date:{ $gte:startDate, $lte:endDate } })
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

app.listen(PORT, () => console.log(`🚀 Server listening on http://0.0.0.0:${PORT}`))
