// Startup regression: persisted enablement is not a request to open settings.
'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync('js/apm-next/apm-ui.js', 'utf8');
const init = source.slice(source.indexOf('    function init() {'), source.indexOf('    root.DetectLabApmUi ='));
const visibility = source.slice(source.indexOf('    function setPanelVisible(open)'), source.indexOf('    function togglePanel(force)'));
for (const pwa of [false, true]) {
    for (const stored of ['on', 'off', null]) {
        for (const layerRow of [false, true]) {
            const classes = new Set(pwa ? ['is-pwa'] : []);
            const panel = { hidden: false, setAttribute(k, v) { this[k] = v; } };
            const row = { addEventListener() {} };
            const host = { appendChild() {} };
            const root = { localStorage: { getItem: () => stored } };
            for (const name of ['Heatmap', 'Pipeline', 'Core', 'Sites', 'Providers', 'I18n']) root['DetectLabApm' + name] = {};
            const context = {
                root, state: {}, ui: {}, SWITCH_KEY: 'detectlab_apm_next',
                document: {
                    body: { ...host, classList: { toggle(k, on) { if (on) classes.add(k); else classes.delete(k); } } },
                    getElementById: id => id === 'apmNextToggle' && layerRow ? row : null,
                    querySelector: () => host, addEventListener() {}
                },
                buildPanel: () => panel, h: () => ({ setAttribute() {} }),
                renderSwitch() {}, updateGate() {}, onLanguageChange() {},
                togglePanel() { throw Error('Startup must not open settings'); }
            };
            vm.runInNewContext(visibility + init + '\ninit();', context);
            assert.strictEqual(context.state.enabled, stored === 'on');
            assert.strictEqual(panel.hidden, true);
            assert.strictEqual(panel['aria-hidden'], 'true');
            assert.strictEqual(classes.has('apm-panel-open'), false);
            if (context.ui.btn) assert.strictEqual(typeof context.ui.btn.setAttribute, 'function');
        }
    }
}
const index = fs.readFileSync('index.html', 'utf8');
const sw = fs.readFileSync('sw.js', 'utf8');
const url = index.match(/src="(js\/apm-next\/apm-ui.js\?v=[^"]+)"/)[1];
assert(sw.includes("'" + url + "'"));
console.log('APM startup: 12 desktop/PWA, saved-switch and launcher combinations passed; asset precached.');
