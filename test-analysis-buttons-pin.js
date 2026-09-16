/**
 * Unit and integration tests for:
 * 1. Renaming 'Zone candidati' to 'Detectează' / 'Detect'.
 * 2. Visibility of action buttons (Scan, Detect, Generate report) only after a pin is chosen.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('Testing button naming and visibility logic...');

// 1. Translations
const trSrc = fs.readFileSync(path.join(__dirname, 'js', 'translations.js'), 'utf8');
assert(trSrc.includes("archeo_run_btn: 'Detect'"), 'English translation for archeo_run_btn should be "Detect"');
assert(trSrc.includes("archeo_run_btn: 'Detectează'"), 'Romanian translation for archeo_run_btn should be "Detectează"');

// 2. index.html checks
const htmlSrc = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
assert(htmlSrc.includes('id="lidarScannerRun" class="lidar-scanner-button" type="button" style="display:none"'),
    'lidarScannerRun button should initially have display:none');
assert(/id="archeoPotRunBtn"[^>]*style="[^"]*display:\s*none/i.test(htmlSrc),
    'archeoPotRunBtn button should initially have display:none');
assert(htmlSrc.includes('id="archReportRunBtn" type="button" class="arch-report-button" style="display:none"'),
    'archReportRunBtn button should initially have display:none');
assert(htmlSrc.includes('<span class="t" data-key="archeo_run_btn">Detect</span>'),
    'archeoPotRunBtn should contain Detect with data-key="archeo_run_btn"');

// 3. CSS checks
const cssSrc = fs.readFileSync(path.join(__dirname, 'css', 'styles.css'), 'utf8');
assert(cssSrc.includes('#lidarScannerRun.is-hidden'), 'styles.css should style #lidarScannerRun hidden');
assert(cssSrc.includes('#archeoPotRunBtn.is-hidden'), 'styles.css should style #archeoPotRunBtn hidden');
assert(cssSrc.includes('#archReportRunBtn.is-hidden'), 'styles.css should style #archReportRunBtn hidden');

// 4. archeo-potential.js I18N
const potSrc = fs.readFileSync(path.join(__dirname, 'js', 'archeo-potential.js'), 'utf8');
assert(potSrc.includes("run_btn: 'Detect'"), 'I18N.en.run_btn should be Detect');
assert(potSrc.includes("run_btn: 'Detectează'"), 'I18N.ro.run_btn should be Detectează');
assert(!potSrc.includes("run_btn: 'Candidate Areas'"), 'Candidate Areas should be replaced');
assert(!potSrc.includes("run_btn: 'Zone candidati'"), 'Zone candidati should be replaced');

// 5. Test dock visibility synchronization with button visibility
const voSrc = fs.readFileSync(path.join(__dirname, 'js', 'vertical-opacity-control.js'), 'utf8');
assert(voSrc.includes('btn.style && btn.style.display === \'none\''), 'syncDistanceDock should check button display:none');
assert(voSrc.includes('showDock = visible && hasVisibleAction'), 'dock visibility should require visible action button');

console.log('✅ ALL PIN BUTTON TESTS PASSED');
