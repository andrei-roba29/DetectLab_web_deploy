// Exercises the LiDAR settings entry point with and without a prepared area.
'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
class Node {
    constructor(tag) { this.tagName=tag; this.children=[]; this.hidden=false; this.dataset={}; this.style={}; this.className=''; this.textContent=''; this.classList={contains:()=>false,toggle(){},add(){}}; }
    appendChild(n) { this.children.push(n); return n; }
    append(...nodes) { nodes.forEach(n=>this.appendChild(n)); }
    replaceChildren(...nodes) { this.children=[]; this.append(...nodes); }
    setAttribute() {} addEventListener() {}
    querySelector(s) { if (this.id==='rvt-panel' && s==='#rvt-body') return body; return null; }
}
const body = new Node('div'); body.hidden=true;
const header = new Node('div'); header.textContent='Test LiDAR';
let toggle = {checked:false,click(){this.checked=true;}};
const opacityEvents = [];
const range = {id:'lidarNlAhnOpacitySlider', value:'70', max:'100',
    dispatchEvent(event) { opacityEvents.push({type:event.type, bubbles:event.bubbles, value:this.value}); }};
const row = new Node('div'); row.firstElementChild=header;
row.querySelector = s => s==='.rvt-row-button' ? header.children.find(c=>c.className==='rvt-row-button') :
    (s==='input[id$="OpacitySlider"]' || s==='input[type="range"]') ? range :
    s==='input[type="checkbox"]' ? toggle : null;
const container=new Node('div');
const frame=new Node('div');
container.closest = selector => selector === '.map-frame' ? frame : null;
const map={getContainer:()=>container,getPane:()=>({style:{}}),on(){},removeLayer(){},attributionControl:{removeAttribution(){},addAttribution(){}}};
let callback, chosen=0, cancelled=0, stops=0, chosenMethods=[];
const photo={get:()=>null, active:()=>true, choose(key, method, values, cb){chosen++; chosenMethods.push(method); callback=cb; return ()=>cancelled++;}, stop(){stops++; (settingsListeners['dl:photo-filter'] || []).forEach(fn => fn({detail:{status:'Image effect off'}}));},update(){},preview(){}};
const document={createElement:t=>new Node(t),querySelectorAll:()=>[row],getElementById:()=>null};
const dockEntries = {};
const dock = { minimize(id, label, restore) { dockEntries[id] = restore; }, remove(id) { delete dockEntries[id]; } };
const settingsListeners = {};
const window={_dlMap:map,L:{},DLPhotoFilter:photo,DetectLabWindowDock:dock,
    addEventListener(type, fn) { (settingsListeners[type] = settingsListeners[type] || []).push(fn); }};
const config=JSON.parse(fs.readFileSync('rvt_service/methods.json'));
const source=fs.readFileSync('js/rvt-panel.js','utf8');
const ctx={window,document,L:{GridLayer:{extend:()=>function(){}}},MutationObserver:class{observe(){}},
    fetch:()=>Promise.resolve({ok:true,json:()=>Promise.resolve({config,layers:{}})}),Event:class{constructor(type, options){this.type=type;Object.assign(this, options);}},console,Map,Set,URLSearchParams,setTimeout,clearTimeout};
vm.runInNewContext(source,ctx);
assert.equal(frame.children[0].id, 'rvt-panel', 'settings are outside the Leaflet touch-action boundary');
assert.equal(container.children.length, 0, 'settings do not inherit Leaflet map gestures');
const css = fs.readFileSync('css/rvt-panel.css', 'utf8');
assert.match(css, /#rvt-body\s*\{[^}]*overflow-y:auto;[^}]*touch-action:pan-y;[^}]*-webkit-overflow-scrolling:touch/);
assert.match(css, /\.rvt-control input\s*\{[^}]*touch-action:pan-y/);
const button=header.children[0];
assert.equal(button.textContent, '', 'settings entry point is icon-only');
assert(button.innerHTML.includes('<svg'), 'settings uses a minimal SVG icon');
assert.equal(button.title, 'LiDAR Settings');
const click=()=>button.onclick({preventDefault(){},stopPropagation(){}});
const text=n=>n.textContent+' '+n.children.map(text).join(' ');
(async()=>{
    await new Promise(resolve=>setImmediate(resolve));
    click();
    assert(toggle.checked,'inactive LiDAR is enabled');
    assert.equal(range.value, '100', 'opening settings maximizes layer opacity');
    assert.deepEqual(opacityEvents[0], {type:'input', bubbles:true, value:'100'}, 'normal opacity handler is notified');
    assert.equal(chosen,1); assert(!body.hidden);
    assert(text(body).includes('Tap the centre')); assert(!text(body).includes('Custom settings'));
    body.children[0].children[1].onclick();
    assert(body.hidden && dockEntries['lidar-settings'], 'selection can be minimized');
    dockEntries['lidar-settings'](); delete dockEntries['lidar-settings'];
    assert(!body.hidden, 'selection can be restored');
    const old=callback;
    callback(new Error('Tiles unavailable')); assert(text(body).includes('Tiles unavailable')); assert(!text(body).includes('Custom settings'));
    body.children[3].onclick(); assert.equal(chosen,2);
    old(null); assert(!text(body).includes('Custom settings'),'stale selections cannot open settings');
    body.children[0].children[1].onclick();
    callback(null); assert(body.hidden, 'completed preparation does not reopen a minimized window');
    dockEntries['lidar-settings'](); delete dockEntries['lidar-settings'];
    assert(!body.hidden && text(body).includes('Custom settings'),'restoring shows prepared settings');
    range.value = '35';
    click(); assert.equal(range.value, '100', 'reopening an enabled layer resets reduced opacity'); assert.equal(chosen,3); assert(!text(body).includes('Custom settings'),'reopening requires a new selection');
    body.children[0].children[2].onclick(); assert(body.hidden); assert(cancelled>0); assert(stops>0);
    callback(null); assert(body.hidden,'cancelled selection cannot reopen settings');
    for (const id of ['albaniaOpacity_dtm', 'danishOpacity_dtm', 'lidarHdOpacitySlider']) {
        range.id = id; range.value = '0';
        toggle = null; // Also cover rows without a visibility switch.
        const before = opacityEvents.length;
        click();
        assert.equal(range.value, '100', id + ' opens fully opaque');
        assert.equal(opacityEvents.length, before + 1, id + ' notifies its opacity handler');
    }
    // Leaving the 3D view resets the LiDAR area and its settings back to normal
    // (carrying them across the 2D ⇄ 3D hand-off crashed the installed PWA).
    const chosenBefore = chosen;
    click();
    callback(null);
    assert.equal(chosen, chosenBefore + 1, 'the area is prepared again before the 3D round trip');
    body.children[2].children[2].onclick(); // Select a non-default visualization.
    const stopsBefore = stops;
    const close3d = () => (settingsListeners['detectlab:3d-closed'] || []).forEach(fn => fn({type:'detectlab:3d-closed'}));
    close3d();
    assert(body.hidden, 'the settings window closes on return to 2D');
    assert(!dockEntries['lidar-settings'], 'no minimized settings entry remains');
    assert(!text(body).includes('Custom settings'), 'the prepared settings are gone');
    assert(stops > stopsBefore, 'the photo effect is stopped with the 3D view');
    assert(stops > 0);
    click();
    assert.equal(chosen, chosenBefore + 2, 'a new area can be chosen after the reset');
    assert.equal(chosenMethods.at(-1), 'hillshade', 'the default visualization is restored');
    assert(!text(body).includes('Custom settings'), 'the reset did not keep a stale area');
    callback(null);
    assert(text(body).includes('Custom settings'), 'settings work again after the reset');
    body.children[0].children[2].onclick(); // Minimize the prepared settings.
    assert(dockEntries['lidar-settings'], 'prepared settings can be minimized');
    close3d();
    assert(body.hidden && !dockEntries['lidar-settings'], 'returning to 2D removes minimized settings');
    click();
    const pending = callback;
    const cancelledBefore = cancelled;
    close3d();
    assert(body.hidden && cancelled > cancelledBefore, 'an in-progress area selection is cancelled and closed');
    pending(null);
    assert(body.hidden && !text(body).includes('Custom settings'), 'a late selection cannot reopen settings');
    const html=fs.readFileSync('index.html','utf8'), sw=fs.readFileSync('sw.js','utf8');
    for(const tag of ['js/rvt-panel.js?v=20261101-close-settings-2d','js/lidar-photo-filter.js?v=20261101-desktop-3d-hint']) assert(html.includes(tag)&&sw.includes(tag));
    console.log('OK — LiDAR settings require a successfully prepared area; failure, retry and cancellation work.');
})().catch(err=>{console.error(err);process.exitCode=1;});
