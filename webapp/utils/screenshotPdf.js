const puppeteer = require('puppeteer-core');
const { PDFDocument } = require('pdf-lib');
const fs = require('fs');

// puppeteer-core drives a browser already installed on the machine instead of
// downloading its own ~200MB Chromium — try Chrome first, then Edge (both are
// Chromium-based, so page.pdf() output is identical either way).
const CANDIDATE_EXECUTABLES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];

function findExecutable() {
  return CANDIDATE_EXECUTABLES.find(p => fs.existsSync(p));
}

// Renders each admin report page exactly as an admin would see it in-browser
// (full styling, charts included) and stitches the per-page PDFs into one file,
// so the export is a faithful "screenshot" rather than a hand-built summary.
async function buildScreenshotPdf({ baseUrl, cookieHeader, paths }) {
  const executablePath = findExecutable();
  if (!executablePath) {
    throw new Error('No local Chrome or Edge installation found to render the PDF.');
  }

  const VIEWPORT_WIDTH = 1440;

  const browser = await puppeteer.launch({ executablePath, headless: true });
  try {
    const pdfBuffers = [];
    for (const path of paths) {
      const page = await browser.newPage();
      await page.setViewport({ width: VIEWPORT_WIDTH, height: 1080 });
      if (cookieHeader) {
        await page.setExtraHTTPHeaders({ Cookie: cookieHeader });
      }
      await page.goto(`${baseUrl}${path}`, { waitUntil: 'networkidle0', timeout: 30000 });
      // Chart.js animates in over ~1s on load; give it time to settle before printing.
      await new Promise(resolve => setTimeout(resolve, 1200));
      // Print media hides the nav bar / tab bar (.pdf-hide, see partials/head.ejs) so
      // only the report itself is captured, and the resulting height is measured
      // *after* that chrome is gone so each report becomes exactly one PDF page —
      // no forced A4 pagination, so nothing gets cut off mid-table or mid-chart.
      await page.emulateMediaType('print');
      const contentHeight = await page.evaluate(() => document.body.scrollHeight);
      const buffer = await page.pdf({
        width: `${VIEWPORT_WIDTH}px`,
        height: `${contentHeight + 8}px`,
        printBackground: true,
        margin: { top: 0, bottom: 0, left: 0, right: 0 },
        pageRanges: '1'
      });
      pdfBuffers.push(buffer);
      await page.close();
    }

    const merged = await PDFDocument.create();
    for (const buffer of pdfBuffers) {
      const src = await PDFDocument.load(buffer);
      const copiedPages = await merged.copyPages(src, src.getPageIndices());
      copiedPages.forEach(p => merged.addPage(p));
    }
    return Buffer.from(await merged.save());
  } finally {
    await browser.close();
  }
}

module.exports = { buildScreenshotPdf };
