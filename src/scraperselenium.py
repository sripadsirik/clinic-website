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
TWILIO_SID = os.getenv('TWILIO_SID')
TWILIO_AUTH = os.getenv('TWILIO_AUTH')
TWILIO_NUM = os.getenv('TWILIO_NUM')
NUM1 = os.getenv('NUM1')
NUM2 = os.getenv('NUM2')
NUM3 = os.getenv('NUM3')
NUM4 = os.getenv('NUM4')
NUM5 = os.getenv('NUM5')
NUM6 = os.getenv('NUM6')
NUM7 = os.getenv('NUM7')
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
    'Schaumburg',
    'DGO-OAK'
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
            'Orland Park':   (['box96','box97','box367'], {'box96':'No-Show/Resched','box97':'MD Exit','box367':'OD Exit'}),
            'Oak Lawn':      (['box63','box66','box366'], {'box63':'No-Show/Resched','box66':'MD Exit','box366':'OD/Post-Op Exit'}),
            'Albany Park':   (['box358','box352'], {'box358':'No-Show/Resched','box352':'Exit'}),
            'Buffalo Grove': (['box387','box388'], {'box387':'No-Show/Resched','box388':'Exit'}),
            'OakBrook':      (['box411','box412'], {'box411':'No-Show/Resched','box412':'Exit'}),
            'Schaumburg':    (['box439','box440'], {'box439':'No-Show/Resched','box440':'Exit'}),
            'DGO-OAK':       (['box452','box453'], {'box452':'No-Show/Resched','box453':'Exit'}),
        }
        boxes, status_map = loc_map.get(location, ([], {}))
        
    visits = []
    for bid in boxes:
        # Add retry logic to handle stale element references
        max_retries = 3
        for attempt in range(max_retries):
            try:
                # Wait for the element to be present and stable
                WebDriverWait(driver, 10).until(
                    EC.presence_of_element_located((By.ID, bid))
                )
                # Small delay to let DOM settle
                delay(500)
                
                # Re-find the ul element each time to avoid stale references
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
                break  # Success, exit retry loop
                
            except Exception as e:
                print(f"Attempt {attempt + 1} failed for box {bid}: {e}")
                if attempt == max_retries - 1:
                    print(f"Failed to scrape box {bid} after {max_retries} attempts")
                else:
                    delay(1000)  # Wait before retry
                    
    return visits


# Sync missing dates for each location
def sync_locations_range(locations, start_date, end_date):
    options = webdriver.ChromeOptions()
    options.add_argument('--headless=new')
    options.add_argument('--no-sandbox')
    options.add_argument('--disable-dev-shm-usage')
    options.add_argument('--disable-gpu')
    options.add_argument('--window-size=1280,800')
    options.add_experimental_option('excludeSwitches', ['enable-automation'])
    options.add_experimental_option('useAutomationExtension', False)
    options.add_argument('--disable-blink-features=AutomationControlled')
    # always use webdriver-manager to download a matching ChromeDriver
    driver_path = ChromeDriverManager().install()
    driver = webdriver.Chrome(service=Service(driver_path), options=options)
    driver.execute_cdp_cmd('Page.addScriptToEvaluateOnNewDocument', {
        'source': 'Object.defineProperty(navigator, "webdriver", { get: () => undefined });'
    })
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

    # Function to check if there's any data in the database
    def check_database_status():
        print("Checking database status...")
        for location in ALL_LOCATIONS:
            coll_name = location.replace(' ', '_')
            coll = db[coll_name]
            total_docs = coll.count_documents({})
            print(f"{location}: {total_docs} total documents")
            if total_docs > 0:
                # Get the latest date
                latest_doc = coll.find().sort('date', -1).limit(1)
                if latest_doc:
                    latest_date = list(latest_doc)[0]['date']
                    print(f"  Latest date: {latest_date}")
    
    # Check database status first
    check_database_status()
    
    # Function to show recent data for debugging
    def show_recent_data():
        print("\nRecent data for debugging:")
        for location in ALL_LOCATIONS:
            coll_name = location.replace(' ', '_')
            coll = db[coll_name]
            # Get last 5 documents
            recent_docs = list(coll.find().sort('date', -1).limit(5))
            if recent_docs:
                print(f"\n{location} - Last 5 records:")
                for doc in recent_docs:
                    print(f"  Date: {doc.get('date', 'N/A')}, Patient: {doc.get('patient', 'N/A')}, Status: {doc.get('status', 'N/A')}, Doctor: {doc.get('doctor', 'N/A')}")
            else:
                print(f"\n{location} - No data found")
    
    # Show recent data for debugging
    show_recent_data()
    
    # Function to get aggregated data from MongoDB
    def get_daily_summary():
        today = datetime.now().strftime('%Y-%m-%d')
        summary = {
            'total_visits': 0,
            'locations': {},
            'no_shows': 0,
            'exits': 0,
            'doctors': {},
            'debug_info': []  # Add debug information
        }
        
        for location in ALL_LOCATIONS:
            coll_name = location.replace(' ', '_')
            coll = db[coll_name]
            
            # Count visits for today
            today_visits = list(coll.find({'date': today}))
            location_count = len(today_visits)
            summary['total_visits'] += location_count
            summary['locations'][location] = location_count
            
            # Debug: Log what we found
            summary['debug_info'].append(f"{location}: {location_count} visits found")
            
            # Count no-shows, exits, and track doctors
            for visit in today_visits:
                status = visit.get('status', '')
                doctor = visit.get('doctor', 'Unknown Doctor')
                patient = visit.get('patient', 'Unknown Patient')
                
                # Debug: Log each visit
                summary['debug_info'].append(f"  - {patient}: status='{status}', doctor='{doctor}'")
                
                if status and 'No-Show' in status:
                    summary['no_shows'] += 1
                elif status and 'Exit' in status:
                    summary['exits'] += 1
                
                # Count patients per doctor
                if doctor and doctor != 'Unknown Doctor':
                    if doctor in summary['doctors']:
                        summary['doctors'][doctor] += 1
                    else:
                        summary['doctors'][doctor] = 1
        
        return summary

    # Get today's summary data
    daily_data = get_daily_summary()
    
    # Debug: Print summary to console for troubleshooting
    print(f"Debug Summary:")
    print(f"Total visits: {daily_data['total_visits']}")
    print(f"No-shows: {daily_data['no_shows']}")
    print(f"Exits: {daily_data['exits']}")
    for debug_line in daily_data['debug_info']:
        print(debug_line)
    
    # Create enhanced message with MongoDB data
    message_body = f"""Scraping Complete for Today! 📊

📈 Daily Summary:
• Total Visits: {daily_data['total_visits']}
• No-Shows: {daily_data['no_shows']}
• Completed Exits: {daily_data['exits']}

📍 By Location:"""
    
    for location, count in daily_data['locations'].items():
        if count > 0:
            message_body += f"\n• {location}: {count} visits"
        else:
            message_body += f"\n• {location}: 0 visits"
    
    # Add doctor statistics if available
    if daily_data['doctors']:
        message_body += "\n\n👨‍⚕️ By Doctor:"
        # Sort doctors by patient count (descending)
        sorted_doctors = sorted(daily_data['doctors'].items(), key=lambda x: x[1], reverse=True)
        for doctor, count in sorted_doctors:
            message_body += f"\n• Dr. {doctor}: {count} patients"
    
    # Add debug information if no visits found
    if daily_data['total_visits'] == 0:
        message_body += "\n\n⚠️ Debug Info:"
        for debug_line in daily_data['debug_info']:
            message_body += f"\n{debug_line}"
    
    message_body += "\n\nCheck the KPI Dashboard for detailed analysis."

    from twilio.rest import Client

    account_sid = TWILIO_SID
    auth_token = TWILIO_AUTH
    client = Client(account_sid, auth_token)

    message = client.messages.create(
        body=message_body,
        from_=TWILIO_NUM,
        to=NUM1
    )

    message = client.messages.create(
        body=message_body,
        from_=TWILIO_NUM,
        to=NUM2
    )

    message = client.messages.create(
        body=message_body,
        from_=TWILIO_NUM,
        to=NUM3
    )

    message = client.messages.create(
        body=message_body,
        from_=TWILIO_NUM,
        to=NUM4
    )

    message = client.messages.create(
        body=message_body,
        from_=TWILIO_NUM,
        to=NUM5
    )

    message = client.messages.create(
        body=message_body,
        from_=TWILIO_NUM,
        to=NUM6
    )

    message = client.messages.create(
        body=message_body,
        from_=TWILIO_NUM,
        to=NUM7
    )

    print(message.sid)
