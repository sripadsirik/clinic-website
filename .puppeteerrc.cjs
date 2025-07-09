// .puppeteerrc.cjs
const { join } = require('path');

/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  // force Chrome to download (default is skipDownload: false)
  chrome: { skipDownload: true },

  // store browser builds inside your project, not in /root/.cache
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};
