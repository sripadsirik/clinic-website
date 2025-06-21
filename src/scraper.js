// src/scraper.js
require('dotenv').config();
const fs        = require('fs');
const path      = require('path');
const puppeteer = require('puppeteer');
const mongoose  = require('mongoose');

async function clickButtonByText(page, selector, text) {
  await page.waitForSelector(selector, { visible: true });
  await page.evaluate(
    ({ selector, text }) => {
      const btn = Array.from(document.querySelectorAll(selector))
        .find(el => el.innerText.trim().includes(text));
      if (!btn) throw new Error(`Button "${text}" not found`);
      btn.click();
    },
    { selector, text }
  );
}

// simple delay helper
function delay(ms) {
  return new Promise(res => setTimeout(res, ms));
}

async function syncVisits(location, date) {
  console.log(`🔍 Starting scrape for ${location} on ${date}`);

  // ── 1) MONGO ────────────────────────────────────────────────────────────────
  // force using the "visits" database
  await mongoose.connect(process.env.MONGO_URI, {
    dbName: 'visits',
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  const db = mongoose.connection.db;

  // build a collection name like "Oak_Lawn_2025-06-18"
  const safeLoc = location.replace(/\s+/g, '_');
  const collName = `${safeLoc}_${date}`;
  const coll = db.collection(collName);

  // ── 2) BROWSER ──────────────────────────────────────────────────────────────
  const browser = await puppeteer.launch({
    headless: false,
    slowMo: 50,
    defaultViewport: null,
  });
  const page = await browser.newPage();

  try {
    // ─ LOGIN ────────────────────────────────────────────────────────────────
    await page.goto('https://login.nextech.com/', { waitUntil: 'networkidle2' });
    try {
      console.log('➡ clicking “I use an email address to login”');
      await clickButtonByText(page, 'button', 'I use an email address to login');
      await page.waitForNavigation({ waitUntil: 'networkidle2' });
    } catch {}
    console.log('➡ filling email');
    await page.type('input[name="username"]', process.env.NEXTECH_USER, { delay: 50 });
    await clickButtonByText(page, 'button', 'Continue');
    await page.waitForNavigation({ waitUntil: 'networkidle2' });

    console.log('➡ filling password');
    await page.type('input[type="password"]', process.env.NEXTECH_PASS, { delay: 50 });
    await clickButtonByText(page, 'button', 'Sign In').catch(() =>
      clickButtonByText(page, 'button', 'Continue')
    );
    await page.waitForNavigation({ waitUntil: 'networkidle2' });

    // ─ SELECT PRACTICE ─────────────────────────────────────────────────────
    console.log('🔎 waiting for practice dropdowns');
    await page.waitForSelector('select[name="ui_DDLocation"]', { visible: true, timeout: 20000 });
    console.log(`➡ selecting Location = ${location}`);
    await page.evaluate((loc) => {
      function selectByText(sel, txt) {
        const S = document.querySelector(sel);
        for (let o of S.options) {
          if (o.text.trim() === txt) {
            S.value = o.value;
            S.dispatchEvent(new Event('change', { bubbles: true }));
            return;
          }
        }
        throw new Error(`Option "${txt}" not in ${sel}`);
      }
      selectByText('select[name="ui_DDLocation"]', loc);
      selectByText('select[name="ui_DDDept"]', 'Comprehensive');
    }, location);
    await Promise.all([
      page.click('#uiBtnLogin'),
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
    ]);

    // ─ SET DATE ──────────────────────────────────────────────────────────────
    console.log(`➡ setting date picker to ${date}`);
    await page.waitForSelector('#datepicker', { visible: true });
    await page.evaluate(d => {
      const [Y, M, D] = d.split('-').map(n => +n);
      const dp = $('#datepicker').data('kendoDatePicker');
      dp.value(new Date(Y, M - 1, D));
      dp.trigger('change');
    }, date);
    // give grid a moment to refresh
    await delay(2000);

    // ─ WAIT FOR BOXES ───────────────────────────────────────────────────────
    console.log('🔎 waiting for MD Exit / OD-Post-Op Exit / No-Show');
    await Promise.all([
      page.waitForSelector('#boxtitle66',  { visible: true, timeout: 15000 }),
      page.waitForSelector('#boxtitle366',{ visible: true, timeout: 15000 }),
      page.waitForSelector('#boxtitle63',  { visible: true, timeout: 15000 }),
    ]);

    // ─ SCRAPE ──────────────────────────────────────────────────────────────
    const visits = await page.$$eval(
      '#box66 li, #box366 li, #box63 li',
      els => els.map(el => {
        const raw     = el.innerText.trim();
        const [time, ...rest] = raw.split(/\s+/);
        const patient = rest.join(' ');

        const title = el.getAttribute('title') || '';
        const mDoc  = title.match(/Doctor:\s*([^\n]+)/);
        const mTyp  = title.match(/Type:\s*([^\n]+)/);

        const boxId     = el.closest('ul[data-role="droptarget"]').id;
        const statusMap = {
          box66:  'MD Exit',
          box366: 'OD/Post-Op Exit',
          box63:  'No-Show/Resched'
        };
        const status = statusMap[boxId] || null;

        return {
          location:  window._SCRAPE_LOCATION || null,
          date:      window._SCRAPE_DATE   || null,
          status,
          time,
          patient,
          doctor: mDoc ? mDoc[1].trim() : null,
          type:   mTyp ? mTyp[1].trim() : null,
        };
      })
    );

    // ─ UPSERT INTO location_date COLLECTION ────────────────────────────────
    let count = 0;
    for (const v of visits) {
      await coll.updateOne(
        { location: v.location, date: v.date, patient: v.patient, time: v.time },
        { $set: v },
        { upsert: true }
      );
      count++;
    }
    console.log(`✅ Upserted ${count} records into "${collName}"`);

    // ─ OPTIONAL: dump CSV ──────────────────────────────────────────────────
    fs.mkdirSync('logs', { recursive: true });
    const csvPath = path.join('logs', `${safeLoc}_${date}.csv`);
    const header  = 'status,time,patient,doctor,type\n';
    const rows    = visits.map(v =>
      [v.status, v.time, `"${v.patient}"`, v.doctor||'', v.type||''].join(',')
    ).join('\n');
    fs.writeFileSync(csvPath, header + rows, 'utf8');
    console.log(`📝 Wrote CSV to ${csvPath}`);

  } catch (err) {
    fs.mkdirSync('logs', { recursive: true });
    const dump = await page.content().catch(() => '<no page>');
    const name = `error_${safeLoc}_${date}.html`;
    fs.writeFileSync(path.join('logs', name), dump, 'utf8');
    console.error(`❌ Scraper error: ${err.message}`);
    console.error(`📝 HTML dump: logs/${name}`);
  } finally {
    await browser.close();
    await mongoose.disconnect();
  }
}

module.exports = { syncVisits };
