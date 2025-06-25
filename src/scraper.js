// src/scraper.js
require('dotenv').config();
const fs        = require('fs');
const path      = require('path');
const puppeteer = require('puppeteer');
const mongoose  = require('mongoose');

// small delay
const delay = ms => new Promise(r => setTimeout(r, ms));

/**
 * startBrowser
 * — headless: true
 * — disable sandboxing (Render doesn’t let you run with a UI)
 * — ignore default extension-disabling arg
 * — use GLES for GPU contexts
 * — ignore HTTPS errors
 * — set a real-world Chrome user agent
 */
async function startBrowser() {
  console.log('🟢 Opening browser...');
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: puppeteer.executablePath(),  // <-- use the shipped Chromium
    pipe: true,                                   // <-- use pipe transport
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--use-gl=egl'
    ],
    ignoreHTTPSErrors: true,
    timeout: 240000,         // <-- give launch up to 4min
    protocolTimeout: 480000, // <-- give CDP calls up to 4min
  });

  const page = await browser.newPage();
  return { browser, page };
}


// helper: click a button by its exact innerText
async function clickButtonByText(page, selector, text) {
  await page.waitForSelector(selector, { visible: true });
  await page.evaluate(
    ({ selector, text }) => {
      const btn = Array.from(document.querySelectorAll(selector))
        .find(el => el.innerText.trim() === text);
      if (!btn) throw new Error(`Button "${text}" not found`);
      btn.click();
    },
    { selector, text }
  );
}

// log in flow
async function loginAndClickSubmit(page) {
  await page.goto('https://login.nextech.com/', { waitUntil: 'networkidle2' });
  try {
    await clickButtonByText(page, 'button', 'I use an email address to login');
    await page.waitForNavigation({ waitUntil: 'networkidle2' });
  } catch {}
  await page.type('input[name="username"]', process.env.NEXTECH_USER, { delay: 50 });
  await clickButtonByText(page, 'button', 'Continue');
  await page.waitForNavigation({ waitUntil: 'networkidle2' });
  await page.type('input[type="password"]', process.env.NEXTECH_PASS, { delay: 50 });
  await clickButtonByText(page, 'button', 'Sign In').catch(
    () => clickButtonByText(page, 'button', 'Continue')
  );
  await page.waitForNavigation({ waitUntil: 'networkidle2' });
  await page.waitForSelector('#uiBtnLogin', { visible: true, timeout: 240000 });
  await Promise.all([
    page.click('#uiBtnLogin'),
    page.waitForNavigation({ waitUntil: 'networkidle2' })
  ]);
  console.log('🔑 Logged in successfully');
}

// select a new clinic location
async function changeLocation(page, newLoc) {
  console.log(`🔀 Changing location → ${newLoc}`);
  await page.waitForSelector('#ui_DDLocation', { timeout: 30000 });
  await page.evaluate(loc => {
    const dd = $('#ui_DDLocation').data('kendoDropDownList');
    if (!dd) throw new Error('location dropdown not ready');
    const opt = $('#ui_DDLocation option')
      .filter((i, el) => $(el).text().trim() === loc);
    if (!opt.length) throw new Error(`"${loc}" not found`);
    dd.value(opt.val());
    dd.trigger('change');
    __doPostBack('ui$DDLocation', '');
  }, newLoc);
  await delay(3000);
}

// pick a date in the calendar
async function setDate(page, date) {
  await page.waitForSelector('#datepicker', { visible: true });
  await page.evaluate(d => {
    const [Y, M, D] = d.split('-').map(n => +n);
    const dp = $('#datepicker').data('kendoDatePicker');
    dp.value(new Date(Y, M - 1, D));
    dp.trigger('change');
  }, date);
  await delay(1500);
}

/**
 * scrapeVisitsForDate
 *  - dates < 2025-05-22 → scrape the single "AM PM" box
 *  - dates ≥ 2025-05-22 → scrape per-location boxes
 */
async function scrapeVisitsForDate(page, location, date) {
  const cutoff = '2025-05-22';
  let boxes, statusMap;

  if (date < cutoff) {
    const ampmId = await page.evaluate(() => {
      const block = Array.from(document.querySelectorAll('.k-block'))
        .find(div => div.innerText.includes('AM') && div.innerText.includes('PM'));
      if (!block) throw new Error('AM PM container not found');
      const ul = block.querySelector('ul[data-role="droptarget"]');
      if (!ul) throw new Error('AM PM droptarget <ul> not found');
      return ul.id;
    });
    boxes = ['#' + ampmId];
    statusMap = {};
  } else if (location === 'Orland Park') {
    boxes = ['#box96', '#box97', '#box367'];
    statusMap = { box96: 'No-Show/Resced', box97: 'MD Exit', box367: 'OD Exit' };
  } else if (location === 'Oak Lawn') {
    boxes = ['#box63', '#box66', '#box366'];
    statusMap = { box63: 'No-Show/Resched', box66: 'MD Exit', box366: 'OD/Post-Op Exit' };
  } else {
    const mapping = {
      'Albany Park':   ['#box358', '#box352'],
      'Buffalo Grove': ['#box387', '#box388'],
      OakBrook:        ['#box411', '#box412'],
      Schaumburg:      ['#box439', '#box440'],
    };
    boxes = mapping[location] || [];
    statusMap = boxes.reduce((m, id) => {
      m[id.slice(1)] = id === boxes[0] ? 'No-Show/Resched' : 'Exit';
      return m;
    }, {});
  }

  await Promise.all(
    boxes.map(id => page.waitForSelector(id, { visible: true, timeout: 15000 }))
  );

  return await page.evaluate((boxes, statusMap, loc, dt) => {
    const out = [];
    boxes.forEach(id => {
      document.querySelectorAll(`${id} li`).forEach(li => {
        const raw     = li.innerText.trim();
        const [time, ...rest] = raw.split(/\s+/);
        const patient = rest.join(' ');
        const title   = li.getAttribute('title') || '';
        const mDoc    = title.match(/Doctor:\s*([^\n]+)/);
        const mTyp    = title.match(/Type:\s*([^\n]+)/);
        const boxId   = li.closest('ul[data-role="droptarget"]').id;
        out.push({
          location: loc,
          date:     dt,
          status:   statusMap[boxId] || null,
          time, patient,
          doctor:   mDoc ? mDoc[1].trim() : null,
          type:     mTyp ? mTyp[1].trim() : null
        });
      });
    });
    return out;
  }, boxes, statusMap, location, date);
}

// scrape any missing days for each location
async function syncLocationsRange(locations, startDate, endDate) {
  // (assumes mongoose.connect already done)
  const db       = mongoose.connection.db;
  const { browser, page } = await startBrowser();

  await loginAndClickSubmit(page);
  await page.waitForSelector('#datepicker', { visible: true, timeout: 30000 });

  for (const loc of locations) {
    await changeLocation(page, loc);
    const safeLoc = loc.replace(/\s+/g, '_');
    const coll    = db.collection(safeLoc);

    const from = new Date(startDate), to = new Date(endDate);
    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      const iso = d.toISOString().slice(0,10);
      if (d.getUTCDay() === 0) continue;      // skip Sundays
      if (await coll.findOne({ date: iso })) continue;

      console.log(`🔁 Scraping ${loc} on ${iso}`);
      await setDate(page, iso);
      const visits = await scrapeVisitsForDate(page, loc, iso);

      let count = 0;
      for (const v of visits) {
        await coll.updateOne(
          { location: v.location, date: v.date, patient: v.patient, time: v.time },
          { $set: v },
          { upsert: true }
        );
        count++;
      }
      console.log(`✅ Upserted ${count} rows into “${safeLoc}”`);

      fs.mkdirSync('logs_dump', { recursive: true });
      const csv    = path.join('logs_dump', `${safeLoc}_${iso}.csv`);
      const header = 'status,time,patient,doctor,type\n';
      const rows   = visits
        .map(v => [v.status,v.time,`"${v.patient}"`,v.doctor||'',v.type||''].join(','))
        .join('\n');
      fs.writeFileSync(csv, header + rows, 'utf8');
    }
  }

  await browser.close();
}

// backwards-compat exports
async function syncRange(location, startDate, endDate) {
  return syncLocationsRange([location], startDate, endDate);
}
async function syncVisits(location, date) {
  return syncLocationsRange([location], date, date);
}

module.exports = {
  syncVisits,
  syncRange,
  syncLocationsRange
};
