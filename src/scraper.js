require('dotenv').config()
const fs        = require('fs')
const path      = require('path')
const puppeteer = require('puppeteer')
const mongoose  = require('mongoose')

// helper: click a button by its exact innerText
async function clickButtonByText(page, selector, text) {
  console.log(`🔎 waiting for button ${selector} with text “${text}”`)
  await page.waitForSelector(selector, { visible:true, timeout:60000 })
  await page.evaluate(
    ({selector,text})=>{
      const btn = Array.from(document.querySelectorAll(selector))
        .find(el=>el.innerText.trim()===text)
      if(!btn) throw new Error(`Button \"${text}\" not found`)
      btn.click()
    },
    {selector,text}
  )
  console.log(`✅ clicked button “${text}”`)
}

// small delay
tinyDelay = ms=>new Promise(r=>setTimeout(r,ms))

// log in flow
async function loginAndClickSubmit(page) {
  console.log('🔍 Navigating to login page…');
  await page.goto('https://login.nextech.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });

  console.debug('🔑 Attempting optional email-login button');
  await clickButtonByText(page, 'button', 'I use an email address to login').catch(() => {
    console.debug('   (email button not present — skipping)');
  });

  console.debug('✉️  Entering username');
  await page.waitForSelector('input[name="username"]', { visible: true, timeout: 60000 });
  await page.type('input[name="username"]', process.env.NEXTECH_USER, { delay: 50 });
  await clickButtonByText(page, 'button', 'Continue');

  console.debug('🔐 Entering password');
  await page.waitForSelector('input[type="password"]', { visible: true, timeout: 60000 });
  await page.type('input[type="password"]', process.env.NEXTECH_PASS, { delay: 50 });
  await clickButtonByText(page, 'button', 'Sign In')
    .catch(() => clickButtonByText(page, 'button', 'Continue'));

  console.log('🔑 Logged in to Nextech – clicking final submit');

  const submitSel = '#uiBtnLogin,input[type="submit"],button[type="submit"]';
  await page.waitForSelector(submitSel, { visible: true, timeout: 60000 });
  await page.click(submitSel);

}


// change clinic location (no jQuery)
async function changeLocation(page,newLoc) {
  console.log('▶ Navigation succeeded, new URL:', page.url());
  console.log(`🔀 changeLocation → ${newLoc}`)
  // await page.waitForSelector('#ui_DDLocation',{visible:true,timeout:60000})
  await page.waitForFunction('window.kendo !== undefined',{timeout:60000})
  console.log('⚙️ Kendo ready, evaluating location change')
  await page.evaluate(loc=>{
    const sel = document.querySelector('#ui_DDLocation')
    const dd  = kendo.widgetInstance(sel, kendo.ui.DropDownList)
    const opt = Array.from(sel.options).find(o=>o.text.trim()===loc)
    if(!opt) throw new Error(`Location “${loc}” not found`)
    dd.value(opt.value)
    dd.trigger('change')
    __doPostBack('ui$DDLocation','')
  }, newLoc)
  console.log('✅ changeLocation evaluate complete, waiting for UI update')
  await tinyDelay(50000)
}

// pick a date (no jQuery)
async function setDate(page,date) {
  console.log(`📅 setDate → ${date}`)
  await page.waitForSelector('#datepicker',{visible:true,timeout:60000})
  await page.waitForFunction('window.kendo !== undefined',{timeout:60000})
  console.log('⚙️ Kendo datepicker ready')
  await page.evaluate(d=>{
    const dpEl = document.querySelector('#datepicker')
    const dp   = kendo.widgetInstance(dpEl, kendo.ui.DatePicker)
    const [Y,M,D] = d.split('-').map(n=>+n)
    dp.value(new Date(Y,M-1,D))
    dp.trigger('change')
  }, date)
  console.log('✅ setDate evaluate complete, waiting for UI update')
  await tinyDelay(60000)
}

// scrape visits for one date
async function scrapeVisitsForDate(page,location,date) {
  console.log(`🔍 scrapeVisitsForDate ${location}@${date}`)
  const cutoff = '2025-05-22'
  let boxes = [], statusMap = {}
  if(date<cutoff) {
    console.log('ℹ️ pre-cutoff, single AM/PM')
    const ampmId = await page.evaluate(()=>{
      const block = Array.from(document.querySelectorAll('.k-block'))
        .find(div=>div.innerText.includes('AM')&&div.innerText.includes('PM'))
      return block.querySelector('ul[data-role="droptarget"]').id
    })
    boxes=[`#${ampmId}`]
  } else {
    console.log('ℹ️ post-cutoff, per-location mapping')
    const map = {
      'Orland Park':['#box96','#box97','#box367'],
      'Oak Lawn':['#box63','#box66','#box366'],
      'Albany Park':['#box358','#box352'],
      'Buffalo Grove':['#box387','#box388'],
      'OakBrook':['#box411','#box412'],
      'Schaumburg':['#box439','#box440']
    }
    boxes=map[location]||[]
    boxes.forEach((sel,i)=>statusMap[sel.slice(1)] = i===0?'No-Show/Resched':'Exit')
  }
  console.log('⚙️ waiting for boxes:',boxes)
  await Promise.all(boxes.map(id=>page.waitForSelector(id,{visible:true,timeout:60000})))
  console.log('⚙️ boxes ready, extracting')
  const visits = await page.evaluate((boxes,statusMap,loc,dt)=>{
    const out=[]
    boxes.forEach(id=>{
      document.querySelectorAll(`${id} li`).forEach(li=>{
        const raw=li.innerText.trim()
        const [time,...rest]=raw.split(/\s+/)
        const patient=rest.join(' ')
        const title=li.title||''
        const docM=title.match(/Doctor:\s*([^\n]+)/)
        const typM=title.match(/Type:\s*([^\n]+)/)
        const boxId=li.closest('ul[data-role="droptarget"]').id
        out.push({location:loc,date:dt,status:statusMap[boxId]||null,time,patient,
          doctor:docM?docM[1].trim():null,
          type:typM?typM[1].trim():null
        })
      })
    })
    return out
  }, boxes, statusMap, location, date)
  console.log(`✅ scraped ${visits.length} visits`)  
  return visits
}

// master sync
async function syncLocationsRange(locations,startDate,endDate) {
  console.log('🔍 launching Chromium')
  const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-setuid-sandbox']})
  const page=await browser.newPage()

  await loginAndClickSubmit(page)
  console.log('🚀 starting scrape')
  for(const loc of locations) {
    await changeLocation(page,loc)
    for(let d=new Date(startDate); d<=new Date(endDate); d.setDate(d.getDate()+1)){
      if(d.getUTCDay()===0) continue
      const iso=d.toISOString().slice(0,10)
      console.log(`🔁 processing ${loc}@${iso}`)
      await setDate(page,iso)
      const visits=await scrapeVisitsForDate(page,loc,iso)
      console.log(`📥 upserting ${visits.length} rows for ${loc}@${iso}`)
      // upsert to DB...
    }
  }
  await browser.close()
  console.log('🎉 scrape complete')
}

module.exports={syncLocationsRange,
  syncRange:(l,s,e)=>syncLocationsRange([l],s,e),
  syncVisits:(l,d)=>syncLocationsRange([l],d,d)
}
