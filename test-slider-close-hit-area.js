// Regression: the map-side mirror's ✕ close button must be easy to hit on
// desktop. Usage: node test-slider-close-hit-area.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const stylesCss = fs.readFileSync(path.join(__dirname, 'css/styles.css'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

// Both mirror slots ship their own ✕ button, styled through one shared class.
const closeButtons = (indexHtml.match(/class="vertical-opacity-close"/g) || []).length;
assert.strictEqual(closeButtons, 2,
    'both mirrors (#verticalOpacityClose + #verticalOpacityCloseSecondary) must use .vertical-opacity-close');

// 1. The button itself grew from 22×22 to 26×26 and shows a visible disc at
//    rest — a dim floating glyph on frosted glass was nearly impossible to
//    aim for with a mouse.
assert(/\.vertical-opacity-close\s*\{[^}]*width:\s*26px[^}]*height:\s*26px/.test(stylesCss),
    'the close button must be at least 26×26 px');
assert(!/\.vertical-opacity-close\s*\{[^}]*background:\s*transparent/.test(stylesCss),
    'the close button must ship a visible disc at rest (no transparent background)');

// 2. The invisible ::before halo is the actual fix: the effective click/hover
//    target grows to ~40px, so the cursor no longer has to land exactly on
//    the glyph (WCAG 2.5.8 minimum target size).
assert(/\.vertical-opacity-close::before\s*\{[^}]*inset:\s*-7px/.test(stylesCss),
    'the close button needs an invisible halo around it (inset: -7px → ~40px target)');
assert(/\.vertical-opacity-close::before\s*\{[^}]*content:\s*''/.test(stylesCss),
    'the halo must be a real rendered pseudo-element');

// 2b. ROOT CAUSE of the desktop complaint: without a z-index, the positioned
//     .vertical-opacity-slider-wrap (later in the DOM) paints OVER the bottom
//     half of the absolutely-positioned ✕ button and swallows its clicks —
//     only a thin strip above the card was ever clickable. The button must
//     be promoted above the slider wrap.
assert(/\.vertical-opacity-close\s*\{[^}]*z-index:\s*2/.test(stylesCss),
    'the close button must paint above .vertical-opacity-slider-wrap (z-index: 2)');

// 3. Hover / keyboard focus keep strong affordance and must not be clipped:
//    the mirror card has no overflow:hidden (the caption chip already floats
//    outside it), so the halo that overhangs the card edge stays clickable.
assert(!/\.vertical-opacity-control\s*\{[^}]*overflow:\s*hidden/.test(stylesCss),
    'the mirror card must not clip the close button halo (no overflow:hidden)');
assert(/\.vertical-opacity-close:hover[\s\S]{0,220}?\.vertical-opacity-close:focus-visible\s*\{[^}]*background/.test(stylesCss),
    'hover/focus must keep a visible pressed-in state');

// 4. Discoverability: hovering anywhere on the card brightens the ✕ before
//    the cursor reaches it.
assert(/\.vertical-opacity-control:hover \.vertical-opacity-close\s*\{/.test(stylesCss),
    'hovering the card must highlight the close button');

// 5. The enlarged button must not steal drags from the slider: the halo's
//    reach (26/2 + 7 = 20px from the button center at top:3 → max y ≈ 30px
//    of card height) stays clear of the slider's top end (~39px+), so
//    dragging opacity to 100% can never trigger an accidental close.
assert(/\.vertical-opacity-close\s*\{[^}]*top:\s*3px/.test(stylesCss),
    'the close button stays pinned to the card corner (top: 3px)');

// 6. Reduced-motion users get no scale jump on hover.
assert(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.vertical-opacity-close\s*\{[^}]*transition:\s*none/.test(stylesCss),
    'reduced motion must disable the close button transition');
assert(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.vertical-opacity-close:hover,[\s\S]{0,120}?\.vertical-opacity-close:focus-visible\s*\{[^}]*transform:\s*none/.test(stylesCss),
    'reduced motion must disable the hover scale');

console.log('OK: slider close button hit area checks passed.');
