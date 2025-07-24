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
    opts.add_argument('--headless=new')  # uncomment to run headless
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

    WebDriverWait(driver, 30).until(
        EC.visibility_of_element_located((By.NAME, 'username'))
    ).send_keys(NEXTECH_USER)
    driver.find_element(By.XPATH, "//button[text()='Continue']").click()

    WebDriverWait(driver, 30).until(
        EC.visibility_of_element_located((By.XPATH, "//input[@type='password']"))
    ).send_keys(NEXTECH_PASS)
    try:
        driver.find_element(By.XPATH, "//button[text()='Sign In']").click()
    except:
        driver.find_element(By.XPATH, "//button[text()='Continue']").click()

    # optional extra submit
    try:
        WebDriverWait(driver, 5).until(
            EC.element_to_be_clickable((By.XPATH,
                "//input[@type='submit' and @value='Submit']"))
        ).click()
    except:
        pass

    WebDriverWait(driver, 30).until(EC.visibility_of_element_located((By.ID, 'datepicker')))
    delay(2000)

def navigate_to_user_task_summary(driver):
    # Admin → Reports → Standard Reports → User Task Summary
    WebDriverWait(driver,20).until(EC.element_to_be_clickable((By.LINK_TEXT, 'Admin'))).click()
    WebDriverWait(driver,20).until(EC.element_to_be_clickable((By.LINK_TEXT, 'Reports'))).click()
    delay(500)

    WebDriverWait(driver,20).until(
        EC.element_to_be_clickable((By.ID, 'ctl00_pnlMenu_hlJaspersoftReports'))
    ).click()
    delay(500)

    WebDriverWait(driver,20).until(
        EC.element_to_be_clickable((By.CSS_SELECTOR, 'div.mat-select-trigger'))
    ).click()
    WebDriverWait(driver,20).until(
        EC.element_to_be_clickable((By.XPATH,
            "//mat-option//span[normalize-space(.)='User Task Summary']"
        ))
    ).click()
    delay(1000)

    # ── Select "Tech WU" ONCE ────────────────────────────────────────────────
    ms_boxes = WebDriverWait(driver,10).until(
        lambda d: d.find_elements(By.CSS_SELECTOR, 'div.jr-mInputControlMultiSelect')
    )
    task_box = ms_boxes[2]  # 3rd box is Task
    task_box.find_element(By.CSS_SELECTOR, '.jr-mMultiselect-toggleContainer').click()
    WebDriverWait(driver,5).until(
        EC.visibility_of_element_located((By.CSS_SELECTOR, 'ul.jr-mSelectlist li.jr-mSelectlist-item'))
    )
    delay(3000)
    for li in task_box.find_elements(By.CSS_SELECTOR, 'li.jr-mSelectlist-item'):
        if li.get_attribute('title').strip() == 'Tech WU':
            li.click()
            break
    delay(5000)
    # leave the task box closed so we don’t re-open it every scrape

# ── SCRAPER ──────────────────────────────────────────────────────────────────────
def scrape_for_date_and_location(driver, location: str, date_str: str):
    # 1) Set From/To dates
    from_inp = WebDriverWait(driver, 20).until(
        EC.element_to_be_clickable((By.CSS_SELECTOR, 'input[id^="jr-label-id-FromDate"]'))
    )
    to_inp   = driver.find_element(By.CSS_SELECTOR, 'input[id^="jr-label-id-ToDate"]')
    driver.execute_script("arguments[0].removeAttribute('readonly')", from_inp)
    driver.execute_script("arguments[0].removeAttribute('readonly')", to_inp)

    for inp in (from_inp, to_inp):
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

    # 3) Apply Filters
    driver.find_element(By.XPATH, "//button[text()='Apply Filters']").click()
    # give it up to 10s for data to arrive
    delay(10000)
    try:
        WebDriverWait(driver, 10).until(
            lambda d: d.find_elements(By.CSS_SELECTOR, 'td.jrcel')
        )
    except TimeoutException:
        print(f"[no data] {location} {date_str}")
        return []

    report_container = driver.find_element(By.CSS_SELECTOR, 'div._jr_report_container_')

    # now loop through all pages
    all_rows = []
    while True:
        # pick the one table with data in it
        data_table = next(
            tbl for tbl in report_container.find_elements(By.TAG_NAME, 'table')
            if tbl.find_elements(By.CSS_SELECTOR, 'td.jrcel')
        )

        # extract rows
        for tr in data_table.find_elements(By.TAG_NAME, 'tr'):
            cells = tr.find_elements(By.CSS_SELECTOR, 'td.jrcel')
            if len(cells) < 8:
                continue

            vals = []
            for c in cells[:8]:
                try:
                    span = c.find_element(By.CSS_SELECTOR, 'span')
                    txt  = span.get_attribute('title') or span.text
                except NoSuchElementException:
                    txt  = c.text.strip()
                vals.append(txt)

            user, practice, loc, doctor, task, avg, stddev, count = vals

            # ** NEW GUARD: skip rows where avg is blank or non-numeric **
            try:
                avg_f = float(avg)
            except ValueError:
                avg_f = 0.0

            all_rows.append({
                'date':           date_str,
                'user':           user,
                'practice':       practice,
                'location':       loc,
                'doctor':         doctor,
                'task':           task,
                'avg_minutes':    avg_f,
                'stddev_minutes': float(stddev) if stddev else 0.0,
                'task_count':     int(count)        if count  else 0,
            })

        # try to advance to next page
        try:
            # find the "next" arrow
            next_btn = report_container.find_element(
                By.XPATH,
                ".//div[contains(@class,'paging-report')]//a[normalize-space(text())='>']"
            )
            if 'disabled' in next_btn.get_attribute('class'):
                break

            # grab the current page number from the paging input
            page_input = report_container.find_element(
                By.XPATH,
                ".//div[contains(@class,'paging-report')]//input"
            )
            old_page = page_input.get_attribute("value")

            # click to load the next page
            next_btn.click()

            # wait for that input's value to change (i.e. page has actually advanced)
            WebDriverWait(driver, 10).until(
                lambda d: report_container.find_element(
                    By.XPATH,
                    ".//div[contains(@class,'paging-report')]//input"
                ).get_attribute("value") != old_page
            )
            delay(500)  # give the table a moment to repaint

        except (NoSuchElementException, TimeoutException):
            break

    seen = set()
    unique_rows = []
    for r in all_rows:
        key = (
            r['date'],
            r['user'],
            r['practice'],
            r['location'],
            r['doctor'],
            r['task'],
        )
        if key in seen:
            continue
        seen.add(key)
        unique_rows.append(r)
    return unique_rows

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
                # skip dates we've already collected
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
