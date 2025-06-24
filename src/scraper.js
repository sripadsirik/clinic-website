// src/scraper.js
require('dotenv').config();
const fs        = require('fs');
const path      = require('path');
const puppeteer = require('puppeteer');
const mongoose  = require('mongoose');

// helper: click a button by its exact innerText
async function clickButtonByText(page, selector, text) {
  console.log(`🔎 waiting for button ${selector} with text “${text}”`);
  await page.waitForSelector(selector, { visible: true, timeout: 60000 });
  await page.evaluate(
    ({ selector, text }) => {
      const btn = Array.from(document.querySelectorAll(selector))
        .find(el => el.innerText.trim() === text);
      if (!btn) throw new Error(`Button "${text}" not found`);
      btn.click();
    },
    { selector, text }
  );
  console.log(`✅ clicked button “${text}”`);
}

// small delay helper
const tinyDelay = ms => new Promise(r => setTimeout(r, ms));

// 1) Log in flow
async function loginAndClickSubmit(page) {
  console.log('🔍 Navigating to Nextech login page…');
  await page.goto('https://login.nextech.com/', {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });

  console.debug('🔑 Optional “I use an email address to login”');
  await clickButtonByText(page, 'button', 'I use an email address to login')
    .catch(() => console.debug('   (skipped email-login)'));

  console.debug('✉️ Entering username');
  await page.waitForSelector('input[name="username"]', { visible: true, timeout: 60000 });
  await page.type('input[name="username"]', process.env.NEXTECH_USER, { delay: 50 });
  await clickButtonByText(page, 'button', 'Continue');

  console.debug('🔐 Entering password');
  await page.waitForSelector('input[type="password"]', { visible: true, timeout: 60000 });
  await page.type('input[type="password"]', process.env.NEXTECH_PASS, { delay: 50 });
  await clickButtonByText(page, 'button', 'Sign In')
    .catch(() => clickButtonByText(page, 'button', 'Continue'));

  console.log('🔑 Nextech login submitted — waiting for dashboard…');
  const submitSel = '#uiBtnLogin,input[type="submit"],button[type="submit"]';
  await Promise.all([
    page.click(submitSel),
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 120000 })
  ]);
  console.log('▶ landed on URL:', page.url());

  // handle Auth0 intermediate if present
  if (page.url().includes('.auth0.com')) {
    console.log('🔐 Auth0 login detected — filling credentials');
    await page.waitForSelector('input#username, input[name="username"]', { visible: true, timeout: 60000 });
    await page.type('input#username', process.env.NEXTECH_USER, { delay: 50 });
    await page.type('input#password', process.env.NEXTECH_PASS, { delay: 50 });
    await page.click('button[name="action"], button[type="submit"]');
    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 120000 });
    console.log('▶ After Auth0 submit, URL:', page.url());
  }

  // finally ensure dashboard loaded
  console.log('⚙️ Waiting for dashboard dropdown #ui_DDLocation');
  await page.waitForSelector('#ui_DDLocation', { visible: true, timeout: 120000 });
  console.log('✅ Dashboard ready');
}

// 2) Change clinic location
async function changeLocation(page, newLoc) {
  console.log('▶ changeLocation — current URL:', page.url());
  console.log(`🔀 Changing location → “${newLoc}”`);

  await page.waitForSelector('#ui_DDLocation', { visible: true, timeout: 60000 });

  console.log('⚙️ Waiting for kendo to initialize…');
  await page.waitForFunction(
    () => window.kendo && window.kendo.ui && window.kendo.ui.DropDownList,
    { timeout: 60000 }
  );
  console.log('✅ kendo ready');

  await page.evaluate(loc => {
    const sel   = document.querySelector('#ui_DDLocation');
    const kendo = window.kendo;
    const dd    = kendo.widgetInstance(sel, kendo.ui.DropDownList);
    const opt   = Array.from(sel.options).find(o => o.text.trim() === loc);
    if (!opt) throw new Error(`Location "${loc}" not found`);
    dd.value(opt.value);
    dd.trigger('change');
    __doPostBack('ui$DDLocation', '');
  }, newLoc);

  console.log('✅ changeLocation() evaluate done — waiting for UI update…');
  await tinyDelay(5000);
  console.log('▶ changeLocation complete');
}

// 3) Pick a date on the Kendo calendar
async function setDate(page, date) {
  console.log(`📅 setDate → ${date}`);
  await page.waitForSelector('#datepicker', { visible: true, timeout: 60000 });

  console.log('⚙️ Waiting for kendo datepicker…');
  await page.waitForFunction(
    () => window.kendo && window.kendo.ui && window.kendo.ui.DatePicker,
    { timeout: 60000 }
  );
  console.log('✅ kendo datepicker ready');

  await page.evaluate(d => {
    const dpEl  = document.querySelector('#datepicker');
    const dp    = window.kendo.widgetInstance(dpEl, window.kendo.ui.DatePicker);
    const [Y, M, D] = d.split('-').map(n => +n);
    dp.value(new Date(Y, M - 1, D));
    dp.trigger('change');
  }, date);

  console.log('✅ setDate evaluate done — waiting for UI update…');
  await tinyDelay(3000);
}

// 4) Scrape visits for one date/location
async function scrapeVisitsForDate(page, location, date) {
  console.log(`🔍 scrapeVisitsForDate ${location}@${date}`);
  const cutoff = '2025-05-22';
  let boxes = [], statusMap = {};

  if (date < cutoff) {
    console.log('ℹ️ pre-cutoff, single AM/PM container');
    const ampmId = await page.evaluate(() => {
      const block = Array.from(document.querySelectorAll('.k-block'))
        .find(div => div.innerText.includes('AM') && div.innerText.includes('PM'));
      return block.querySelector('ul[data-role="droptarget"]').id;
    });
    boxes = [`#${ampmId}`];
  } else {
    console.log('ℹ️ post-cutoff, per-location boxes');
    const map = {
      'Orland Park':   ['#box96','#box97','#box367'],
      'Oak Lawn':      ['#box63','#box66','#box366'],
      'Albany Park':   ['#box358','#box352'],
      'Buffalo Grove': ['#box387','#box388'],
      'OakBrook':      ['#box411','#box412'],
      'Schaumburg':    ['#box439','#box440'],
    };
    boxes = map[location] || [];
    boxes.forEach((sel, i) => {
      statusMap[sel.slice(1)] = i === 0 ? 'No-Show/Resched' : 'Exit';
    });
  }

  console.log('⚙️ waiting for boxes:', boxes);
  await Promise.all(
    boxes.map(id => page.waitForSelector(id, { visible: true, timeout: 60000 }))
  );

  console.log('⚙️ boxes ready — extracting visits');
  const visits = await page.evaluate((boxes, statusMap, loc, dt) => {
    const out = [];
    boxes.forEach(id => {
      document.querySelectorAll(`${id} li`).forEach(li => {
        const raw     = li.innerText.trim();
        const [time, ...rest] = raw.split(/\s+/);
        const patient = rest.join(' ');
        const title   = li.getAttribute('title') || '';
        const docM    = title.match(/Doctor:\s*([^\n]+)/);
        const typM    = title.match(/Type:\s*([^\n]+)/);
        const boxId   = li.closest('ul[data-role="droptarget"]').id;
        out.push({
          location: loc,
          date:     dt,
          status:   statusMap[boxId] || null,
          time, patient,
          doctor:   docM ? docM[1].trim() : null,
          type:     typM ? typM[1].trim() : null
        });
      });
    });
    return out;
  }, boxes, statusMap, location, date);

  console.log(`✅ scraped ${visits.length} visits`);
  return visits;
}

// 5) Master: sync a range of dates & locations
async function syncLocationsRange(locations, startDate, endDate) {
  console.log('🔍 launching Chromium');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox','--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  // login
  await loginAndClickSubmit(page);

  console.log('🚀 starting scrape');
  for (const loc of locations) {
    await changeLocation(page, loc);
    for (let d = new Date(startDate); d <= new Date(endDate); d.setDate(d.getDate()+1)) {
      if (d.getUTCDay() === 0) continue;  // skip Sundays
      const iso = d.toISOString().slice(0,10);
      console.log(`🔁 processing ${loc}@${iso}`);
      await setDate(page, iso);
      const visits = await scrapeVisitsForDate(page, loc, iso);
      console.log(`📥 (would upsert) ${visits.length} rows for ${loc}@${iso}`);
      // …persist to MongoDB here…
    }
  }

  await browser.close();
  console.log('🎉 scrape complete');
}

// Exports
module.exports = {
  syncLocationsRange,
  syncRange:   (loc, s, e) => syncLocationsRange([loc], s, e),
  syncVisits:  (loc, date)   => syncLocationsRange([loc], date, date)
};
