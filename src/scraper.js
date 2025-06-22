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
        .find(el => el.innerText.trim() === text);
      if (!btn) throw new Error(`Button "${text}" not found`);
      btn.click();
    },
    { selector, text }
  );
}

function delay(ms) {
  return new Promise(res => setTimeout(res, ms));
}

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
  await clickButtonByText(page, 'button', 'Sign In')
    .catch(() => clickButtonByText(page, 'button', 'Continue'));
  await page.waitForNavigation({ waitUntil: 'networkidle2' });
  await page.waitForSelector('#uiBtnLogin', { visible: true });
  await Promise.all([
    page.click('#uiBtnLogin'),
    page.waitForNavigation({ waitUntil: 'networkidle2' }),
  ]);
}

async function changeLocation(page, newLoc) {
  console.log(`🔀 Changing location → ${newLoc}`);
  await page.waitForSelector('#ui_DDLocation', { timeout: 30000 });
  await page.evaluate(loc => {
    const dd = $('#ui_DDLocation').data('kendoDropDownList');
    if (!dd) throw new Error('location dropdown not ready');
    const opt = $('#ui_DDLocation option')
      .filter((i,el) => $(el).text().trim() === loc);
    if (!opt.length) throw new Error(`"${loc}" not found`);
    dd.value(opt.val());
    dd.trigger('change');
    __doPostBack('ui$DDLocation','');
  }, newLoc);
  await delay(3000);
}

async function setDate(page, date) {
  await page.waitForSelector('#datepicker', { visible: true });
  await page.evaluate(d => {
    const [Y,M,D] = d.split('-').map(n=>+n);
    const dp = $('#datepicker').data('kendoDatePicker');
    dp.value(new Date(Y,M-1,D));
    dp.trigger('change');
  }, date);
  await delay(1500);
}

async function scrapeVisitsForDate(page, location, date) {
  let boxes, statusMap;
  if (location === 'Orland Park') {
    boxes = ['#box96','#box97','#box367'];
    statusMap = { box96:'No-Show/Resced', box97:'MD Exit', box367:'OD Exit' };
  } else if (location === 'Oak Lawn') {
    boxes = ['#box63','#box66','#box366'];
    statusMap = { box63:'No-Show/Resched', box66:'MD Exit', box366:'OD/Post-Op Exit' };
  } else {
    const mapping = {
      'Albany Park': ['#box358','#box352'],
      'Buffalo Grove':['#box387','#box388'],
      'OakBrook':     ['#box411','#box412'],
      'Schaumburg':   ['#box439','#box440'],
    };
    boxes = mapping[location] || [];
    statusMap = boxes.reduce((m, id) => {
      m[id.slice(1)] = id === boxes[0] ? 'No-Show/Resched' : 'Exit';
      return m;
    }, {});
  }

  await Promise.all(
    boxes.map(id =>
      page.waitForSelector(id, { visible: true, timeout: 15000 })
    )
  );

  return await page.evaluate((boxes, statusMap, loc, dt) => {
    const out = [];
    boxes.forEach(id => {
      document.querySelectorAll(`${id} li`).forEach(li => {
        const raw     = li.innerText.trim();
        const [time,...rest] = raw.split(/\s+/);
        const patient = rest.join(' ');
        const title   = li.getAttribute('title')||'';
        const mDoc    = title.match(/Doctor:\s*([^\n]+)/);
        const mTyp    = title.match(/Type:\s*([^\n]+)/);
        const boxId   = li.closest('ul[data-role="droptarget"]').id;
        out.push({
          location: loc,
          date:     dt,
          status:   statusMap[boxId] || null,
          time,
          patient,
          doctor:   mDoc ? mDoc[1].trim() : null,
          type:     mTyp ? mTyp[1].trim() : null,
        });
      });
    });
    return out;
  }, boxes, statusMap, location, date);
}

async function syncLocationsRange(locations, startDate, endDate) {
  // reuse the single mongoose connection from your server
  const db = mongoose.connection.db;

  const browser = await puppeteer.launch({ headless: false, slowMo: 50, defaultViewport: null });
  const page    = await browser.newPage();
  await loginAndClickSubmit(page);
  await page.waitForSelector('#datepicker', { visible: true, timeout: 30000 });

  for (const loc of locations) {
    await changeLocation(page, loc);
    const safeLoc = loc.replace(/\s+/g,'_');
    const coll    = db.collection(safeLoc);

    const from = new Date(startDate), to = new Date(endDate);
    for (let d = new Date(from); d <= to; d.setDate(d.getDate()+1)) {
      const iso = d.toISOString().slice(0,10);
      if (d.getUTCDay() === 0) continue; // skip Sundays
      if (await coll.findOne({ date: iso })) continue; // already scraped

      console.log(`🔁 Scraping ${loc} on ${iso}`);
      await setDate(page, iso);
      const visits = await scrapeVisitsForDate(page, loc, iso);

      let count = 0;
      for (const v of visits) {
        await coll.updateOne(
          { location:v.location, date:v.date, patient:v.patient, time:v.time },
          { $set: v },
          { upsert: true }
        );
        count++;
      }
      console.log(`✅ Upserted ${count} rows into “${safeLoc}”`);

      // optional CSV dump
      fs.mkdirSync('logs_dump', { recursive: true });
      const csv = path.join('logs_dump', `${safeLoc}_${iso}.csv`);
      const header = 'status,time,patient,doctor,type\n';
      const rows   = visits.map(v => [v.status,v.time,`"${v.patient}"`,v.doctor||'',v.type||''].join(',')).join('\n');
      fs.writeFileSync(csv, header + rows, 'utf8');
    }
  }

  await browser.close();
}

// backwards-compat
async function syncRange(location, startDate, endDate) {
  return syncLocationsRange([location], startDate, endDate);
}
async function syncVisits(location, date) {
  return syncLocationsRange([location], date, date);
}

module.exports = {
  syncVisits,
  syncRange,
  syncLocationsRange,
};
