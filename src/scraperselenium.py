#!/usr/bin/env python3
# pylint: disable=import-error
# pyright: reportMissingImports=false
import os
import time
from datetime import datetime, timedelta
from dotenv import load_dotenv
from pymongo import MongoClient
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from webdriver_manager.chrome import ChromeDriverManager
from selenium.webdriver.common.keys import Keys
from selenium.common.exceptions import TimeoutException

load_dotenv()

MONGO_URI    = os.getenv('MONGO_URI')
NEXTECH_USER = os.getenv('NEXTECH_USER')
NEXTECH_PASS = os.getenv('NEXTECH_PASS')
CUT_OFF_DATE = '2025-05-31'

client = MongoClient(MONGO_URI)
db     = client['visits']

# Default list of locations when none are passed
ALL_LOCATIONS = [
    'Oak Lawn',
    'Orland Park',
    'Albany Park',
    'Buffalo Grove',
    'OakBrook',
    'Schaumburg'
]

# --- Helper functions ---
def delay(ms):
    time.sleep(ms / 1000.0)

# Log in and navigate to dashboard
def login(driver):
    driver.get('https://login.nextech.com/')
    # click the email-login option if shown
    try:
        btn = WebDriverWait(driver, 10).until(
            EC.element_to_be_clickable((By.XPATH, "//button[contains(text(),'I use an email address to login')]") )
        )
        btn.click()
    except:
        pass
    # wait for username field
    WebDriverWait(driver, 60).until(EC.visibility_of_element_located((By.NAME, 'username')))
    driver.find_element(By.NAME, 'username').send_keys(NEXTECH_USER)
    driver.find_element(By.XPATH, "//button[text()='Continue']").click()
    WebDriverWait(driver, 60).until(EC.visibility_of_element_located((By.XPATH, "//input[@type='password']")))
    driver.find_element(By.XPATH, "//input[@type='password']").send_keys(NEXTECH_PASS)
    try:
        driver.find_element(By.XPATH, "//button[text()='Sign In']").click()
    except:
        driver.find_element(By.XPATH, "//button[text()='Continue']").click()
    # Optional EHR form
    try:
        WebDriverWait(driver, 10).until(
            EC.any_of(
                EC.visibility_of_element_located((By.ID, 'ui_DDLocation')),
                EC.visibility_of_element_located((By.XPATH, "//input[@type='submit' and @value='Submit']"))
            )
        )
        driver.find_element(By.XPATH, "//input[@type='submit' and @value='Submit']").click()
    except:
        pass
    # Give datepicker time to load
    WebDriverWait(driver, 30).until(EC.visibility_of_element_located((By.ID, 'datepicker')))
    delay(2000)

# Change clinic location
def change_location(driver, new_loc):
    print(f"change_location: waiting for location dropdown to appear")
    WebDriverWait(driver, 30).until(EC.presence_of_element_located((By.ID, 'ui_DDLocation')))
    print("change_location: dropdown present, scrolling into view")
    elem = driver.find_element(By.ID, 'ui_DDLocation')
    driver.execute_script("arguments[0].scrollIntoView(true);", elem)
    # execute Kendo dropdown selection via JS injection
    try:
        script = """
        var target = arguments[0];
var dd = $('#ui_DDLocation').data('kendoDropDownList');
        var opts = $('#ui_DDLocation option').filter(function() { return $(this).text().trim() === target; });
        if (opts.length === 0) throw 'Location not found: ' + target;
var val = opts.val();
dd.value(val);
dd.trigger('change');
__doPostBack('ui$DDLocation','');
        """;
        driver.execute_script(script, new_loc)
        print(f"change_location: script executed for '{new_loc}'")
    except Exception as e:
        print(f"change_location: error selecting location via JS: {e}")
    # wait briefly for UI update post-back
    delay(3000)

# Set the datepicker to a specific date
def set_date(driver, date_str):
    try:
        dp_input = driver.find_element(By.ID, 'datepicker')
        print("set_date: clicking datepicker input")
        dp_input.click()
    except Exception as e:
        print(f"set_date: error finding or clicking datepicker input: {e}")
    # clear and type the date directly
    try:
        dp_input.clear()
        dp_input.send_keys(date_str)
        dp_input.send_keys(Keys.ENTER)
        print(f"set_date: entered {date_str} via keyboard, waiting for slots")
    except Exception as e:
        print(f"set_date: error entering date text: {e}")
    try:
        WebDriverWait(driver, 10).until(lambda d: d.find_elements(By.CSS_SELECTOR, 'ul[data-role="droptarget"] li'))
        print("set_date: slots are now present")
        return True
    except Exception as e:
        print(f"set_date: no slots available or error waiting for slots on {date_str}: {e}")
        return False

# Scrape visits for a given date and location
def scrape_visits_for_date(driver, location, date_str):
    status_map = {}
    if date_str < CUT_OFF_DATE:
        blocks = driver.find_elements(By.CSS_SELECTOR, '.k-block')
        # find AM/PM block
        for b in blocks:
            if 'AM' in b.text and 'PM' in b.text:
                ul = b.find_element(By.CSS_SELECTOR, 'ul[data-role="droptarget"]')
                boxes = [ul.get_attribute('id')]
                break
        status_map = {}
    else:
        loc_map = {
            'Orland Park':   (['box96','box97','box367'], {'box96':'No-Show/Resced','box97':'MD Exit','box367':'OD Exit'}),
            'Oak Lawn':      (['box63','box66','box366'], {'box63':'No-Show/Resched','box66':'MD Exit','box366':'OD/Post-Op Exit'}),
            'Albany Park':   (['box358','box352'], {'box358':'No-Show/Resced','box352':'Exit'}),
            'Buffalo Grove': (['box387','box388'], {'box387':'No-Show/Resced','box388':'Exit'}),
            'OakBrook':      (['box411','box412'], {'box411':'No-Show/Resced','box412':'Exit'}),
            'Schaumburg':    (['box439','box440'], {'box439':'No-Show/Resced','box440':'Exit'})
        }
        boxes, status_map = loc_map.get(location, ([], {}))
    visits = []
    for bid in boxes:
        ul = driver.find_element(By.ID, bid)
        lis = ul.find_elements(By.TAG_NAME, 'li')
        for li in lis:
            raw = li.text.strip()
            parts = raw.split()
            time_part = parts[0]
            patient = ' '.join(parts[1:])
            title = li.get_attribute('title') or ''
            d_match = None
            t_match = None
            r_match = None
            import re
            mDoc = re.search(r'Doctor:\s*([^\n]+)', title)
            mTyp = re.search(r'Type:\s*([^\n]+)', title)
            mRes = re.search(r'Reason:\s*([^\n]+)', title)
            visits.append({
                'location': location,
                'date': date_str,
                'status': status_map.get(bid, None),
                'time': time_part,
                'patient': patient,
                'doctor': mDoc.group(1).strip() if mDoc else None,
                'type': mTyp.group(1).strip() if mTyp else None,
                'reason': mRes.group(1).strip() if mRes else None
            })
    return visits


# Sync missing dates for each location
def sync_locations_range(locations, start_date, end_date):
    options = webdriver.ChromeOptions()
    options.add_argument('--headless')
    options.add_argument('--no-sandbox')
    options.add_argument('--disable-dev-shm-usage')
    options.add_argument('--disable-gpu')
    options.add_argument('--window-size=1280,800')
    # always use webdriver-manager to download a matching ChromeDriver
    driver_path = ChromeDriverManager().install()
    driver = webdriver.Chrome(service=Service(driver_path), options=options)
    login(driver)
    for loc in locations:
        change_location(driver, loc)
        start = datetime.fromisoformat(start_date)
        end   = datetime.fromisoformat(end_date)
        for d in (start + timedelta(days=i) for i in range((end - start).days + 1)):
            if d.weekday() == 6:  # skip Sunday
                continue
            date_str = d.strftime('%Y-%m-%d')
            coll_name = loc.replace(' ', '_')
            coll = db[coll_name]
            present = coll.distinct('date', {'date': date_str})
            if date_str in present:
                print(f"sync_locations_range: skipping {loc} {date_str} (already in DB)")
                continue
            # attempt to set the date; if no slots appear, skip this date
            if not set_date(driver, date_str):
                print(f"sync_locations_range: skipping {loc} {date_str} due to no slots")
                continue
            rows = scrape_visits_for_date(driver, loc, date_str)
            if rows:
                coll.insert_many(rows)
            else:
                print(f"sync_locations_range: no visits found for {loc} on {date_str}, skipping")
    driver.quit()

# Entry point
if __name__ == '__main__':
    import sys
    args = sys.argv[1:]
    # If only start/end dates provided, use all locations
    if len(args) == 2:
        sd, ed = args
        locs = ALL_LOCATIONS
    # If locations + dates provided
    elif len(args) >= 3:
        *locs, sd, ed = args
    else:
        print('Usage: python scraperselenium.py [<loc1> [<loc2> ...]] <startDate> <endDate>')
        sys.exit(1)
    sync_locations_range(locs, sd, ed)
