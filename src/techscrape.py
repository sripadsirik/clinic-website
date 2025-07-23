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
    # opts.add_argument('--headless=new')  # enable for headless
    opts.add_argument('--no-sandbox')
    opts.add_argument('--disable-dev-shm-usage')
    opts.add_argument('--disable-gpu')
    opts.add_argument('--window-size=1280,800')
    opts.add_experimental_option('excludeSwitches', ['enable-automation'])
    opts.add_experimental_option('useAutomationExtension', False)
    opts.add_argument('--disable-blink-features=AutomationControlled')

    driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=opts)
    # hide webdriver flag
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
    except:
        pass

    WebDriverWait(driver, 30).until(EC.visibility_of_element_located((By.NAME, 'username'))) \
        .send_keys(NEXTECH_USER)
    driver.find_element(By.XPATH, "//button[text()='Continue']").click()

    WebDriverWait(driver, 30).until(EC.visibility_of_element_located((By.XPATH, "//input[@type='password']"))) \
        .send_keys(NEXTECH_PASS)
    try:
        driver.find_element(By.XPATH, "//button[text()='Sign In']").click()
    except:
        driver.find_element(By.XPATH, "//button[text()='Continue']").click()

    # optional EHR submit
    try:
        WebDriverWait(driver, 5).until(EC.element_to_be_clickable((By.XPATH,
            "//input[@type='submit' and @value='Submit']"))).click()
    except:
        pass

    # wait for dashboard to load
    WebDriverWait(driver, 30).until(EC.visibility_of_element_located((By.ID, 'datepicker')))
    delay(2000)

def navigate_to_user_task_summary(driver):
    # Admin → Reports → Standard Reports → User Task Summary
    WebDriverWait(driver,20).until(EC.element_to_be_clickable((By.LINK_TEXT, 'Admin'))).click()
    WebDriverWait(driver,20).until(EC.element_to_be_clickable((By.LINK_TEXT, 'Reports'))).click()
    delay(500)

    WebDriverWait(driver,20).until(EC.element_to_be_clickable((By.ID, 'ctl00_pnlMenu_hlJaspersoftReports'))).click()
    delay(500)

    WebDriverWait(driver,20).until(EC.element_to_be_clickable((By.CSS_SELECTOR, 'div.mat-select-trigger'))).click()
    WebDriverWait(driver,20).until(EC.element_to_be_clickable((
        By.XPATH, "//mat-option//span[normalize-space(.)='User Task Summary']"
    ))).click()
    delay(1000)

# ── SCRAPER ──────────────────────────────────────────────────────────────────────
def scrape_for_date_and_location(driver, location: str, date_str: str):
    # 1) Set From/To date inputs
    from_inp = WebDriverWait(driver, 20).until(
        EC.element_to_be_clickable((By.CSS_SELECTOR, 'input[id^="jr-label-id-FromDate"]'))
    )
    to_inp = driver.find_element(By.CSS_SELECTOR, 'input[id^="jr-label-id-ToDate"]')

    # remove readonly so send_keys works
    driver.execute_script("arguments[0].removeAttribute('readonly')", from_inp)
    driver.execute_script("arguments[0].removeAttribute('readonly')", to_inp)

    for inp in (from_inp, to_inp):
        inp.clear()
        inp.send_keys(date_str)
        inp.send_keys(Keys.ENTER)
    delay(500)

    # 2) Locate all multi-select boxes; we expect at least 3
    ms_boxes = WebDriverWait(driver, 10).until(
        lambda d: d.find_elements(By.CSS_SELECTOR, 'div.jr-multiselect.jr.ui-resizable')
    )
    if len(ms_boxes) < 3:
        raise RuntimeError(f"Expected ≥3 multiselect boxes, found {len(ms_boxes)}")

    # 3) Open 2nd box (Location)
    ms_boxes[1].find_element(By.CSS_SELECTOR, '.jr-multiselect-toggleContainer').click()
    WebDriverWait(driver, 5).until(
        EC.visibility_of_element_located((By.CSS_SELECTOR, 'ul.jr-mSelectlist li.jr-mSelectlist-item'))
    )
    for li in driver.find_elements(By.CSS_SELECTOR, 'ul.jr-mSelectlist li.jr-mSelectlist-item'):
        if li.get_attribute('title').strip() == location:
            li.click()
            break
    delay(300)

    # 4) Open 3rd box (Task)
    ms_boxes[2].find_element(By.CSS_SELECTOR, '.jr-multiselect-toggleContainer').click()
    WebDriverWait(driver, 5).until(
        EC.visibility_of_element_located((By.CSS_SELECTOR, 'ul.jr-mSelectlist li.jr-mSelectlist-item'))
    )
    for li in driver.find_elements(By.CSS_SELECTOR, 'ul.jr-mSelectlist li.jr-mSelectlist-item'):
        if li.get_attribute('title').strip() == 'Tech WU':
            li.click()
            break
    delay(300)

    # 5) Apply Filters & wait for results
    driver.find_element(By.XPATH, "//button[text()='Apply Filters']").click()
    WebDriverWait(driver, 10).until(
        EC.presence_of_element_located((By.CSS_SELECTOR, 'table.userTaskSummary tbody tr'))
    )
    delay(500)

    # 6) Parse table
    out = []
    for tr in driver.find_elements(By.CSS_SELECTOR, 'table.userTaskSummary tbody tr'):
        cols = [td.text.strip() for td in tr.find_elements(By.TAG_NAME, 'td')]
        if len(cols) < 8:
            continue
        out.append({
            'date':           date_str,
            'user':           cols[0],
            'practice':       cols[1],
            'location':       cols[2],
            'doctor':         cols[3],
            'task':           cols[4],
            'avg_minutes':    float(cols[5]),
            'stddev_minutes': float(cols[6]),
            'task_count':     int(cols[7]),
        })
    return out

# ── MAIN ────────────────────────────────────────────────────────────────────────
def main(args):
    if len(args) < 2:
        print("Usage: python tech_scrape.py [<loc1> …] <startDate> <endDate>")
        sys.exit(1)

    if len(args) == 2:
        locs = ALL_LOCATIONS
        sd, ed = args
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
                    print(f"[skip]   {loc} {ds}")
                    continue

                print(f"[scrape] {loc} {ds}")
                rows = scrape_for_date_and_location(driver, loc, ds)
                if rows:
                    coll.insert_many(rows)
    finally:
        driver.quit()

if __name__ == '__main__':
    main(sys.argv[1:])
