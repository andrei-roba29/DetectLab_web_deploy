// Regression test — the DISTANȚĂ / RAZĂ (analysis layers) and ISTORIC
// (Satellite) caption chip of the map-side vertical slider floats ABOVE the
// card in every mode, the installed PWA included; and the panel rows of the
// layers mirrored on the map never grow a „PE HARTĂ / ON MAP” badge again.
//
// The chip used to live INSIDE .vertical-opacity-title. On desktop that
// wrapper is a static grid cell, so the chip's `position:absolute;
// bottom:calc(100% + 7px)` was measured from the card and the chip floated
// above it. In the installed PWA, though, `body.is-pwa .vertical-opacity-title`
// is itself absolutely positioned (the rotated side-title fallback: 14px wide,
// 21px below the card's top edge) — it became the chip's containing block and
// dragged DISTANȚĂ / RAZĂ down onto the top edge of the card, over the ×
// button. The chip is now a DIRECT child of .vertical-opacity-control, so the
// card is always its containing block.
//
// Static checks over index.html, css/styles.css, js/vertical-opacity-control.js
// and sw.js — no browser, no DOM mock needed.
//
// Usage: node test-vertical-caption-above-card.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const read = (rel) => fs.readFileSync(path.join(__dirname, rel), 'utf8');
const html = read('index.html');
const css = read('css/styles.css');
const voSrc = read('js/vertical-opacity-control.js');
const sw = read('sw.js');

let checks = 0;
function ok(cond, msg) { checks++; assert(cond, msg); }

/* ── helpers ─────────────────────────────────────────────────────────────── */

// Class list of an opening tag.
function classesOf(tag) {
    const m = /class="([^"]*)"/.exec(tag);
    return m ? m[1].split(/\s+/).filter(Boolean) : [];
}

// Walks the markup of one vertical control (from its opening tag up to the
// slider wrapper) with a tiny <span> stack and reports the parent chain of
// the caption chip plus the children of the title wrapper.
function inspectControl(controlId) {
    const start = html.indexOf('id="' + controlId + '"');
    ok(start !== -1, controlId + ' must exist in index.html');
    const openTagStart = html.lastIndexOf('<div', start);
    const end = html.indexOf('class="vertical-opacity-slider-wrap"', start);
    ok(end !== -1, controlId + ' must contain a slider wrap');
    const block = html.slice(openTagStart, end);
    const controlClasses = classesOf(block.slice(0, block.indexOf('>') + 1));
    ok(controlClasses.includes('vertical-opacity-control'),
        controlId + ' must be a .vertical-opacity-control card');

    const tokens = block.match(/<span\b[^>]*>|<\/span>/g) || [];
    const stack = [];
    let captionParents = null;
    let captionId = null;
    const titleChildren = [];
    tokens.forEach(tok => {
        if (tok === '</span>') { stack.pop(); return; }
        const cls = classesOf(tok);
        const parent = stack[stack.length - 1];
        if (parent && parent.includes('vertical-opacity-title')) titleChildren.push(cls);
        if (cls.includes('vertical-opacity-caption')) {
            captionParents = stack.map(c => c.join('.'));
            captionId = (/id="([^"]+)"/.exec(tok) || [])[1] || null;
        }
        stack.push(cls);
    });
    return { captionParents, captionId, titleChildren };
}

// Declarations of the FIRST `selector {…}` rule found in `source`.
function ruleBody(source, selectorRe) {
    const re = new RegExp(selectorRe.source + '\\s*\\{([^}]*)\\}', selectorRe.flags);
    const m = re.exec(source);
    return m ? m[1] : null;
}

// Body of a `@media (...) { … }` block, brace-matched.
function mediaBlock(source, query) {
    const start = source.indexOf('@media ' + query);
    if (start === -1) return null;
    let i = source.indexOf('{', start);
    let depth = 0;
    for (; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) break;
    }
    return source.slice(source.indexOf('{', start) + 1, i);
}

/* ── 1. markup: the chip is a direct child of every card ────────────────── */

const controls = {
    verticalOpacityControl: 'verticalOpacityCaption',
    verticalOpacityControlSecondary: 'verticalOpacityCaptionSecondary',
    verticalSatPeriodControl: 'verticalSatPeriodCaption'
};
Object.keys(controls).forEach(controlId => {
    const info = inspectControl(controlId);
    ok(info.captionParents !== null, controlId + ' must ship a caption chip');
    ok(info.captionId === controls[controlId],
        controlId + ' chip must keep its id (' + controls[controlId] + ' — the JS resolves it by id), got ' + info.captionId);
    ok(info.captionParents.length === 0,
        controlId + ': the caption chip must be a DIRECT child of the card, not nested in <span ' +
        info.captionParents.join(' > ') + '> — inside the PWA title wrapper it lands on the card\'s top edge');
    ok(info.titleChildren.length === 1 && info.titleChildren[0].includes('vertical-opacity-layer'),
        controlId + ': .vertical-opacity-title must hold only the layer initials (.vertical-opacity-layer), got ' +
        JSON.stringify(info.titleChildren));
});

// The two mirror slots ship an EMPTY chip (the JS writes DISTANȚĂ / RAZĂ /
// PERIOADĂ per source; plain opacity layers keep it empty → hidden), while
// the Satellite period card ships ISTORIC.
const captionText = (id) => ((new RegExp('<span[^>]*id="' + id + '"[^>]*>([\\s\\S]*?)</span>')).exec(html) || [])[1];
ok((captionText('verticalOpacityCaption') || '').trim() === '', 'primary mirror chip ships empty');
ok((captionText('verticalOpacityCaptionSecondary') || '').trim() === '', 'secondary mirror chip ships empty');
ok((captionText('verticalSatPeriodCaption') || '').trim() === 'ISTORIC', 'Satellite period chip ships ISTORIC');

/* ── 2. CSS: chip anchored to the card, floating above it ───────────────── */

const chip = ruleBody(css, /\.vertical-opacity-caption/);
ok(chip, '.vertical-opacity-caption must be styled');
ok(/position:\s*absolute/.test(chip), 'the chip is absolutely positioned');
ok(/bottom:\s*calc\(100%\s*\+\s*\d+px\)/.test(chip),
    'the chip hangs ABOVE its containing block (bottom: calc(100% + Npx))');
ok(/left:\s*50%/.test(chip) && /translateX\(-50%\)/.test(chip), 'the chip is centred on the card');
ok(/pointer-events:\s*none/.test(chip),
    'the chip must not swallow map taps just above the card (it used to inherit this from the title wrapper)');
ok(/\.vertical-opacity-caption:empty\s*\{[^}]*display\s*:\s*none/.test(css),
    'an empty chip (opacity mirrors) still collapses');

// The card must remain the chip's containing block: it is positioned…
const card = ruleBody(css, /\.vertical-opacity-control/);
ok(card && /position:\s*absolute/.test(card), '.vertical-opacity-control is positioned (containing block of the chip)');
// …and nothing may re-nest the chip under the title through a descendant rule.
ok(!/\.vertical-opacity-title\s+\.vertical-opacity-caption|\.vertical-opacity-title\s*>\s*\.vertical-opacity-caption/.test(css),
    'no stylesheet rule may assume the chip lives inside .vertical-opacity-title');
// The PWA title wrapper stays positioned (that is WHY the chip cannot live
// inside it) — keep the regression's precondition documented.
const pwaTitle = ruleBody(css, /body\.is-pwa \.vertical-opacity-title/);
ok(pwaTitle && /position:\s*absolute/.test(pwaTitle),
    'the PWA title wrapper is absolutely positioned — the chip must therefore be its sibling');

// Phones in portrait keep the chip: the ≤600px block must not hide it. Only
// the short-viewport (landscape) block may, where the chip would meet the
// "?" help button pinned in the top-right corner.
const narrow = mediaBlock(css, '(max-width: 600px)');
ok(narrow !== null, 'the ≤600px media block exists');
ok(!/\.vertical-opacity-caption\s*\{[^}]*display\s*:\s*none/.test(narrow),
    'portrait phones (≤600px) must keep the DISTANȚĂ / RAZĂ chip visible');
const short = mediaBlock(css, '(max-height: 500px)');
ok(short !== null && /\.vertical-opacity-caption\s*\{[^}]*display\s*:\s*none/.test(short),
    'short (landscape) viewports hide the chip, as before');

/* ── 3. JS: the module addresses the chips by id, never through the title ── */

ok(/getElementById\(\s*'verticalOpacityCaption'\s*\)/.test(voSrc) &&
   /getElementById\(\s*'verticalOpacityCaptionSecondary'\s*\)/.test(voSrc) &&
   /getElementById\(\s*'verticalSatPeriodCaption'\s*\)/.test(voSrc),
    'vertical-opacity-control.js resolves the three chips by id');
ok(!/querySelector\(\s*['"]\.vertical-opacity-caption/.test(voSrc),
    'the module must not look the chip up relative to the title wrapper');

// Distance sources still carry their caption keys → DISTANȚĂ / RAZĂ text.
ok(/id:\s*'lidarScannerDistance'[^}]*caption:\s*'distance'/.test(voSrc), 'LIDAR Scanner mirror is captioned DISTANȚĂ');
ok(/id:\s*'archeoPotDistance'[^}]*caption:\s*'radius'/.test(voSrc), 'archaeological potential mirror is captioned RAZĂ');
ok(/id:\s*'archReportDistance'[^}]*caption:\s*'radius'/.test(voSrc), 'archaeological report mirror is captioned RAZĂ');
ok(/'DISTANȚĂ'/.test(voSrc) && /'DISTANCE'/.test(voSrc) && /'RAZĂ'/.test(voSrc) && /'RADIUS'/.test(voSrc),
    'bilingual caption wording is intact');

/* ── 4. No „PE HARTĂ / ON MAP” badge under the mirrored panel rows ───────── */

ok(!/attr\(\s*data-vo-mirrored-label\s*\)/.test(css),
    'styles.css must not render a badge from data-vo-mirrored-label');
ok(!/content\s*:\s*['"][^'"]*(PE HARTĂ|ON MAP)/i.test(css),
    'styles.css must not print PE HARTĂ / ON MAP under a panel row');
ok(!/setAttribute\(\s*['"]data-vo-mirrored-label/.test(voSrc) && !/mirroredRowLabel/.test(voSrc),
    'vertical-opacity-control.js must not write the mirrored-row badge');
ok(!/['"](PE HARTĂ|ON MAP)['"]/.test(voSrc), 'no badge wording left in vertical-opacity-control.js');
ok(/removeAttribute\(\s*'data-vo-mirrored-label'\s*\)/.test(voSrc),
    'refreshMirroredRows keeps stripping a stale data-vo-mirrored-label attribute');
ok(!/PE HARTĂ|ON MAP\b/.test(html.replace(/<!--[\s\S]*?-->/g, '')),
    'index.html carries no PE HARTĂ / ON MAP badge text');

/* ── 5. Cache busting: the fix reaches the installed PWA ────────────────── */

const stylesV = (html.match(/href="css\/styles\.css\?v=([^"]+)"/) || [])[1] || '';
ok(stylesV && stylesV >= '20260922-caption-above-card',
    'index.html must request styles.css with the caption-above-card tag (or a later one), got ' + JSON.stringify(stylesV));
ok(sw.includes("'css/styles.css?v=" + stylesV + "'"),
    'sw.js must pre-cache the styles.css revision index.html requests (' + stylesV + ')');
const cacheVersion = Number((sw.match(/const CACHE_NAME = 'detectlab-v(\d+)-/) || [])[1]);
ok(cacheVersion >= 130,
    'CACHE_NAME must be bumped to v130 or later so installed apps swap to the shell with the chip above the card (got v' + cacheVersion + ')');

console.log('OK — ' + checks + ' checks: the DISTANȚĂ / RAZĂ / ISTORIC chip is a direct child of the');
console.log('    card and floats above it in the PWA too; no PE HARTĂ badge; shell re-versioned.');
