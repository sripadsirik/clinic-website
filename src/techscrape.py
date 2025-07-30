#!/usr/bin/env python3
# tech_scrape.py — scrape “User Task Summary” → Tech WU into Mongo “technicians” DB

import os
import sys
import time
from datetime import datetime, timedelta

from dotenv import load_dotenv
from pymongo import MongoClient

from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys

from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

from selenium.common.exceptions import NoSuchElementException, TimeoutException

from webdriver_manager.chrome import ChromeDriverManager

load_dotenv()

# ── CONFIG ──────────────────────────────────────────────────────────────────────
MONGO_URI    = os.getenv('MONGO_URI')
NEXTECH_USER = os.getenv('NEXTECH_USER')
NEXTECH_PASS = os.getenv('NEXTECH_PASS')

ALL_LOCATIONS = [
    'Oak Lawn',
    'Orland Park',
    'Albany Park',
    'Buffalo Grove',
    'OakBrook',
    'Schaumburg',
]

# ── HELPERS ─────────────────────────────────────────────────────────────────────
def delay(ms: int):
    """Pause for exactly ms milliseconds."""
    time.sleep(ms / 1000.0)

def date_range(start_str: str, end_str: str):
    start = datetime.fromisoformat(start_str)
    end   = datetime.fromisoformat(end_str)
    for i in range((end - start).days + 1):
        yield (start + timedelta(days=i)).strftime('%Y-%m-%d')

# ── MONGO SETUP ─────────────────────────────────────────────────────────────────
client   = MongoClient(MONGO_URI)
techs_db = client['technicians']

# ── SELENIUM SETUP ───────────────────────────────────────────────────────────────
def make_driver():
    opts = webdriver.ChromeOptions()
    # opts.add_argument('--headless=new')
    opts.add_argument('--no-sandbox')
    opts.add_argument('--disable-dev-shm-usage')
    opts.add_argument('--disable-gpu')
    opts.add_argument('--window-size=1280,800')
    opts.add_experimental_option('excludeSwitches', ['enable-automation'])
    opts.add_experimental_option('useAutomationExtension', False)
    opts.add_argument('--disable-blink-features=AutomationControlled')

    driver = webdriver.Chrome(
        service=Service(ChromeDriverManager().install()),
        options=opts
    )
    driver.execute_cdp_cmd('Page.addScriptToEvaluateOnNewDocument', {
        'source': 'Object.defineProperty(navigator, "webdriver", {get:()=>undefined});'
    })
    return driver

# ── NAVIGATION ──────────────────────────────────────────────────────────────────
def login(driver):
    driver.get('https://login.nextech.com/')
    try:
        WebDriverWait(driver, 5).until(
            EC.element_to_be_clickable((By.XPATH,
                "//button[contains(text(),'I use an email address to login')]"))
        ).click()
    except TimeoutException:
        pass

    WebDriverWait(driver, 30).until(EC.visibility_of_element_located((By.NAME, 'username')))\
                         .send_keys(NEXTECH_USER)
    driver.find_element(By.XPATH, "//button[text()='Continue']").click()

    WebDriverWait(driver, 30).until(EC.visibility_of_element_located((By.XPATH, "//input[@type='password']")))\
                         .send_keys(NEXTECH_PASS)
    try:
        driver.find_element(By.XPATH, "//button[text()='Sign In']").click()
    except:
        driver.find_element(By.XPATH, "//button[text()='Continue']").click()

    try:
        WebDriverWait(driver, 5).until(
            EC.element_to_be_clickable((By.XPATH,
                "//input[@type='submit' and @value='Submit']"))
        ).click()
    except TimeoutException:
        pass

    WebDriverWait(driver, 30).until(EC.visibility_of_element_located((By.ID, 'datepicker')))
    delay(2000)

def navigate_to_user_task_summary(driver):
    wait = WebDriverWait(driver, 20)

    wait.until(EC.element_to_be_clickable((By.LINK_TEXT, 'Admin'))).click()
    wait.until(EC.element_to_be_clickable((By.LINK_TEXT, 'Reports'))).click()
    wait.until(EC.element_to_be_clickable((By.ID, 'ctl00_pnlMenu_hlJaspersoftReports'))).click()
    wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR, 'div.mat-select-trigger'))).click()
    wait.until(EC.element_to_be_clickable((By.XPATH,
        "//mat-option//span[normalize-space(.)='User Task Summary']"
    ))).click()

    delay(10000)   # let the multi‑selects fully render
    boxes = wait.until(lambda d: d.find_elements(By.CSS_SELECTOR, 'div.jr-mInputControlMultiSelect'))
    task_box = boxes[2]
    task_box.find_element(By.CSS_SELECTOR, '.jr-mMultiselect-toggleContainer').click()
    delay(3000)    # wait for the list items
    wait.until(EC.element_to_be_clickable((By.XPATH,
        "//li[@title='Tech WU' and contains(@class,'jr-mSelectlist-item')]"
    ))).click()
    delay(300)

# ── SCRAPER ──────────────────────────────────────────────────────────────────────
def scrape_for_date_and_location(driver, location: str, date_str: str):
    wait = WebDriverWait(driver, 20)

    # set date
    frm = wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR, 'input[id^="jr-label-id-FromDate"]')))
    to  = driver.find_element(By.CSS_SELECTOR, 'input[id^="jr-label-id-ToDate"]')
    for inp in (frm, to):
        driver.execute_script("arguments[0].removeAttribute('readonly')", inp)
        inp.clear()
        inp.send_keys(date_str)
        inp.send_keys(Keys.ENTER)
    delay(500)

    # 2) Pick Location (2nd multi-select)
    ms_boxes = WebDriverWait(driver, 10).until(
        lambda d: d.find_elements(By.CSS_SELECTOR, 'div.jr-mInputControlMultiSelect')
    )
    loc_box = ms_boxes[1]
    loc_box.find_element(By.CSS_SELECTOR, '.jr-mMultiselect-toggleContainer').click()
    WebDriverWait(driver,5).until(
        EC.visibility_of_element_located((By.CSS_SELECTOR, 'ul.jr-mSelectlist li.jr-mSelectlist-item'))
    )
    # clear previously-selected
    loc_box.find_element(By.CSS_SELECTOR, 'li.jr-jSelectNone').click()
    delay(200)
    # select our target
    for li in loc_box.find_elements(By.CSS_SELECTOR, 'li.jr-mSelectlist-item'):
        if li.get_attribute('title').strip() == location:
            li.click()
            break
    delay(300)

    # apply filters
    wait.until(EC.element_to_be_clickable((By.XPATH, "//button[text()='Apply Filters']"))).click()
    delay(10000)
    
    # Check if there's any data - if not, return empty list
    try:
        wait.until(lambda d: d.find_elements(By.CSS_SELECTOR, 'div._jr_report_container_ td.jrcel'))
    except TimeoutException:
        print(f"[DEBUG] No data elements found for {location} {date_str}")
        return []

    # dump HTML for inspection
    report = driver.find_element(By.CSS_SELECTOR, 'div._jr_report_container_')
    html = report.get_attribute('outerHTML')
    dump_filename = f"report_{location.replace(' ', '_')}_{date_str}.html"
    with open(dump_filename, 'w', encoding='utf-8') as f:
        f.write(html)
    print(f"[DEBUG] dumped HTML to {dump_filename}")

    # now parse rows
    all_rows = []
    page = 1

    while True:
        print(f"[DEBUG] scraping {location} {date_str} page {page}")

        # extract rows
        tbl = next(
            t for t in report.find_elements(By.TAG_NAME, 'table')
            if t.find_elements(By.CSS_SELECTOR, 'td.jrcel')
        )
        rows = tbl.find_elements(By.CSS_SELECTOR, 'tbody tr')
        print(f"[DEBUG] found {len(rows)} rows")
        for tr in rows:
            cells = tr.find_elements(By.CSS_SELECTOR, 'td.jrcel')
            if len(cells) < 8:
                continue
            vals = []
            for c in cells[:8]:
                try:
                    sp = c.find_element(By.TAG_NAME, 'span')
                    vals.append(sp.get_attribute('title') or sp.text)
                except NoSuchElementException:
                    vals.append(c.text.strip())
            user, practice, loc, doctor, task, avg, stddev, count = vals
            try:
                avg_num = float(avg)
            except ValueError:
                continue
            all_rows.append({
                'date':           date_str,
                'user':           user,
                'practice':       practice,
                'location':       loc,
                'doctor':         doctor,
                'task':           task,
                'avg_minutes':    avg_num,
                'stddev_minutes': float(stddev) if stddev else 0.0,
                'task_count':     int(count) if count else 0,
            })

        # pagination: click single '>' arrow if available and not disabled
        try:
            nxt = report.find_element(By.XPATH, ".//a[normalize-space(text())='>' and not(contains(@class,'disabled'))]")
            print("[DEBUG] Clicking next page arrow")
            delay(500)
            nxt.click()
            print("[DEBUG] Waiting 5 seconds for next page to load")
            delay(5000)
            # wait until page-number updates
            page_input = driver.find_element(By.XPATH, "//input[@type='number']")
            WebDriverWait(driver, 10).until(lambda d: page_input.get_attribute("value") == str(page + 1))
            page += 1
            report = driver.find_element(By.CSS_SELECTOR, 'div._jr_report_container_')
            print(f"[DEBUG] Successfully navigated to page {page}")
        except NoSuchElementException:
            print("[DEBUG] Next page arrow not found or disabled, ending pagination")
            break
        except TimeoutException:
            print("[DEBUG] Page did not update in time, ending pagination")
            break

    # de‑dupe
    seen = set()
    unique = []
    for r in all_rows:
        key = (r['date'], r['user'], r['doctor'], r['avg_minutes'])
        if key in seen:
            continue
        seen.add(key)
        unique.append(r)

    print(f"[DEBUG] {len(unique)} unique rows")
    return unique

# ── MAIN ────────────────────────────────────────────────────────────────────────
def main(args):
    if len(args) < 2:
        print("Usage: python tech_scrape.py [<loc1> …] <startDate> <endDate>")
        sys.exit(1)

    if len(args) == 2:
        locs, sd, ed = ALL_LOCATIONS, args[0], args[1]
    else:
        *locs, sd, ed = args

    driver = make_driver()
    try:
        login(driver)
        navigate_to_user_task_summary(driver)
        for loc in locs:
            coll = techs_db[loc.replace(' ', '_')]
            for ds in date_range(sd, ed):
                if coll.find_one({'date': ds}):
                    print(f"[skip] {loc} {ds}")
                    continue
                print(f"[scrape] {loc} {ds}")
                rows = scrape_for_date_and_location(driver, loc, ds)
                if rows:
                    coll.insert_many(rows)
                else:
                    print(f"[no data] No data found for {loc} {ds}, waiting 10 seconds before continuing...")
                    time.sleep(10)
                    print(f"[skip] Skipping {loc} {ds} due to no data")
    finally:
        driver.quit()

if __name__ == '__main__':
    main(sys.argv[1:])
