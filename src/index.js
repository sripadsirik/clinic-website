// src/index.js
const Apify = require('apify');
const mongoose = require('mongoose');
require('dotenv').config();

const { syncLocationsRange } = require('./scraper');

Apify.main(async () => {
    const input = await Apify.getInput();
    const { location, startDate, endDate } = input;

    if (!location || !startDate || !endDate) {
        throw new Error('Missing one of location, startDate, endDate in INPUT');
    }

    // 1️⃣ Connect to your MongoDB
    await mongoose.connect(process.env.MONGO_URI, {
        dbName: 'visits',
        useNewUrlParser: true,
        useUnifiedTopology: true,
    });

    // 2️⃣ Run the scraper
    await syncLocationsRange([location], startDate, endDate);

    // 3️⃣ Persist a small “last run” output
    await Apify.setValue('LAST_RUN', {
        location, startDate, endDate, timestamp: new Date().toISOString(),
    });
});
