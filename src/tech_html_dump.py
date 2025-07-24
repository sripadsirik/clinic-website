#!/usr/bin/env python3
# tech_html_dump.py — dump outerHTML of each multi-select box into CSV for debugging

import os
import csv
import time
from dotenv import load_dotenv

from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By

from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

from webdriver_manager.chrome import ChromeDriverManager

load_dotenv()
NEXTECH_USER = os.getenv('NEXTECH_USER')
NEXTECH_PASS = os.getenv('NEXTECH_PASS')

def make_driver():
    opts = webdriver.ChromeOptions()
    # opts.add_argument('--headless=new')
    opts.add_argument('--no-sandbox')
    opts.add_argument('--disable-dev-shm-usage')
    opts.add_argument('--disable-gpu')
    opts.add_experimental_option('excludeSwitches', ['enable-automation'])
    opts.add_experimental_option('useAutomationExtension', False)
    driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=opts)
    driver.execute_cdp_cmd('Page.addScriptToEvaluateOnNewDocument', {
        'source': 'Object.defineProperty(navigator, "webdriver", {get:()=>undefined});'
    })
    return driver

def login(driver):
    driver.get('https://login.nextech.com/')
    try:
        WebDriverWait(driver,5).until(
            EC.element_to_be_clickable((By.XPATH,
                "//button[contains(text(),'I use an email address to login')]"))
        ).click()
    except: pass

    WebDriverWait(driver,30).until(EC.visibility_of_element_located((By.NAME,'username'))) \
        .send_keys(NEXTECH_USER)
    driver.find_element(By.XPATH,"//button[text()='Continue']").click()

    WebDriverWait(driver,30).until(EC.visibility_of_element_located((By.XPATH,"//input[@type='password']"))) \
        .send_keys(NEXTECH_PASS)
    try:
        driver.find_element(By.XPATH,"//button[text()='Sign In']").click()
    except:
        driver.find_element(By.XPATH,"//button[text()='Continue']").click()

    try:
        WebDriverWait(driver,5).until(
            EC.element_to_be_clickable((By.XPATH,
                "//input[@type='submit' and @value='Submit']"))
        ).click()
    except: pass

    WebDriverWait(driver,30).until(
        EC.visibility_of_element_located((By.ID,'datepicker'))
    )
    time.sleep(1)

def navigate_to_summary(driver):
    WebDriverWait(driver,20).until(
        EC.element_to_be_clickable((By.LINK_TEXT,'Admin'))
    ).click()
    WebDriverWait(driver,20).until(
        EC.element_to_be_clickable((By.LINK_TEXT,'Reports'))
    ).click()
    time.sleep(0.5)

    WebDriverWait(driver,20).until(
        EC.element_to_be_clickable((By.ID,'ctl00_pnlMenu_hlJaspersoftReports'))
    ).click()
    time.sleep(0.5)

    WebDriverWait(driver,20).until(
        EC.element_to_be_clickable((By.CSS_SELECTOR,'div.mat-select-trigger'))
    ).click()
    WebDriverWait(driver,20).until(
        EC.element_to_be_clickable((By.XPATH,
            "//mat-option//span[normalize-space(.)='User Task Summary']"
        ))
    ).click()
    time.sleep(1)

def main():
    driver = make_driver()
    try:
        login(driver)
        navigate_to_summary(driver)

        # grab all multi‐select wrappers
        boxes = WebDriverWait(driver,10).until(lambda d: d.find_elements(
            By.CSS_SELECTOR, 'div.jr-mInputControlMultiSelect'
        ))

        # dump to CSV
        with open('ms_dump.csv','w',newline='', encoding='utf-8') as f:
            w = csv.writer(f)
            w.writerow(['index','outerHTML'])
            for i, box in enumerate(boxes):
                html = box.get_attribute('outerHTML').replace('\n',' ')
                w.writerow([i, html])

        print(f"Dumped {len(boxes)} boxes to ms_dump.csv")
    finally:
        driver.quit()

if __name__ == '__main__':
    main()
