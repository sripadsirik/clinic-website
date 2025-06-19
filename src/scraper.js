// src/scraper.js
require('dotenv').config();
const fs        = require('fs');
const path      = require('path');
const puppeteer = require('puppeteer');
const Visit     = require('./models/Visit');

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

async function syncVisits(location, date) {
  console.log(`🔍 Starting scrape for ${location} on ${date}`);
  const browser = await puppeteer.launch({
    headless: false,
    slowMo: 50,
    defaultViewport: null,
  });
  const page = await browser.newPage();

  try {
    // ─── LOGIN ────────────────────────────────────────────────────────────────
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
    await clickButtonByText(page, 'button', 'Sign In')
      .catch(() => clickButtonByText(page, 'button', 'Continue'));
    await page.waitForNavigation({ waitUntil: 'networkidle2' });

    // ─── PICK PRACTICE ─────────────────────────────────────────────────────────
    console.log('🔎 waiting for practice dropdowns');
    await page.waitForSelector('select[name="ui_DDLocation"]', { visible: true, timeout: 20000 });
    console.log(`➡ selecting Location = ${location}, Department = Comprehensive`);
    await page.evaluate((loc, dept) => {
      const selectByText = (sel, txt) => {
        const S = document.querySelector(sel);
        for (let opt of S.options) {
          if (opt.text.trim() === txt) {
            S.value = opt.value;
            S.dispatchEvent(new Event('change', { bubbles: true }));
            return;
          }
        }
        throw new Error(`Option "${txt}" not found in ${sel}`);
      };
      selectByText('select[name="ui_DDLocation"]', loc);
      selectByText('select[name="ui_DDDept"]', dept);
    }, location, 'Comprehensive');
    await Promise.all([
      page.click('#uiBtnLogin'),
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
    ]);

    // ─── NAVIGATE BY DATE ──────────────────────────────────────────────────────
    console.log(`➡ going straight to date ${date}`);
    const [Y, M, D] = date.split('-');
    const url = new URL(page.url());
    url.searchParams.set('Date', `${parseInt(M)}/${parseInt(D)}/${Y}`);
    await page.goto(url.toString(), { waitUntil: 'networkidle2' });

    // ─── WAIT FOR GRID TO LOAD ─────────────────────────────────────────────────
    console.log('🔎 waiting for at least one gray‐out entry');
    await page.waitForSelector('li.GrayOutListItem', { visible: true, timeout: 15000 });

    // ─── SCRAPE EVERY GRAY‐OUT LIST ITEM ───────────────────────────────────────
    const visits = await page.$$eval('li.GrayOutListItem', els =>
      els
        .map(el => {
          const raw     = el.innerText.trim();
          const parts   = raw.split(/\s+/);
          const time    = /\d/.test(parts[0]) ? parts[0] : null;
          const patient = parts.slice(1).join(' ');
          const title   = el.getAttribute('title') || '';
          const mIn     = title.match(/Check In:\s*([0-9:APM ]+)/);
          const mPs     = title.match(/Portal Status:\s*([A-Za-z ]+)/);
          return {
            time,
            patient,
            status:   'GrayOut',
            checkIn:  mIn  ? mIn[1].trim() : null,
            portal:   mPs  ? mPs[1].trim() : null,
          };
        })
        .filter(r => r.time && r.patient)
    );

    // ─── UPSERT INTO MONGO ─────────────────────────────────────────────────────
    let count = 0;
    for (let v of visits) {
      await Visit.findOneAndUpdate(
        { location, date, patient: v.patient, time: v.time },
        { location, date, ...v },
        { upsert: true, setDefaultsOnInsert: true }
      );
      count++;
    }
    console.log(`✅ All done!  ${count} records upserted.`);

    // ─── DUMP TO CSV ───────────────────────────────────────────────────────────
    fs.mkdirSync('logs', { recursive: true });
    const csvPath = path.join('logs', `${location.replace(/\s+/g, '_')}_${date}.csv`);
    const header  = 'status,time,patient,checkIn,portal\n';
    const rows    = visits
      .map(v =>
        [v.status, v.time, `"${v.patient}"`, v.checkIn || '', v.portal || '']
        .join(',')
      ).join('\n');
    fs.writeFileSync(csvPath, header + rows, 'utf8');
    console.log(`📝 Wrote ${visits.length} rows to ${csvPath}`);

  } catch (err) {
    // ─── ON ERROR: DUMP FULL HTML ───────────────────────────────────────────────
    fs.mkdirSync('logs', { recursive: true });
    const dumpName = `error_${location.replace(/\s+/g,'_')}_${date}.html`;
    const dumpPath = path.join('logs', dumpName);
    const html     = await page.content().catch(() => '<could not retrieve page content>');
    fs.writeFileSync(dumpPath, html, 'utf8');
    console.error(`❌ Scraper error: ${err.message}`);
    console.error(`📝 Saved full HTML dump to ${dumpPath}`);
  } finally {
    await browser.close();
  }
}

module.exports = { syncVisits };
