'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const { webcrypto, createHash } = require('crypto');
const { TextEncoder } = require('util');
const source = fs.readFileSync('js/pwa-google-auth.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const auth = fs.readFileSync('js/auth.js', 'utf8');
const sw = fs.readFileSync('sw.js', 'utf8');

function setup(pwa) {
    const rows = Array.from({length: 2}, () => {
        const button = {hidden:false, style:{}};
        const mount = {hidden:true, replaceChildren() { this.rendered = false; }};
        return {button, mount, querySelector(s) {return s === '.auth-oauth-btn' ? button : mount;}};
    });
    let config, renders = 0, credentials, closed = 0, messages = [], cleared = 0;
    const google = {accounts:{id:{initialize(value) {config=value;}, renderButton(mount) {renders++; mount.rendered=true;}}}};
    const window = {navigator:{standalone:false}, location:{search:''}, crypto:webcrypto, google,
        matchMedia:() => ({matches:pwa}), supabaseClient:{auth:{async signInWithIdToken(value) {credentials=value; return {data:{session:{}}};}}}};
    const document = {querySelectorAll:()=>rows, head:{appendChild(){throw Error('Google already loaded');}}};
    vm.runInNewContext(source, {window,document,Uint8Array,Array,TextEncoder,Promise,Error});
    window.DLPwaGoogleAuth.init({message:(...args)=>messages.push(args), clear:()=>cleared++, close:()=>closed++});
    return {window,rows,get config(){return config;},get renders(){return renders;},get credentials(){return credentials;},get closed(){return closed;},get cleared(){return cleared;},messages};
}
const flush = () => new Promise(resolve => setTimeout(resolve, 20));
(async()=>{
    const browser = setup(false);
    await flush();
    assert(!browser.config && !browser.renders, 'ordinary browser uses existing redirect flow');
    const app = setup(true);
    await flush();
    assert(app.config && app.renders === 2, 'Google button is rendered in login and registration');
    assert(app.rows.every(r => r.mount.rendered && !r.mount.hidden && r.button.style.display === 'none'));
    assert.equal(app.config.ux_mode, 'popup');
    const firstHash = app.config.nonce;
    await app.config.callback({credential:'google-id-token'});
    assert.equal(app.credentials.provider, 'google');
    assert.equal(app.credentials.token, 'google-id-token');
    assert.equal(createHash('sha256').update(app.credentials.nonce).digest('hex'), firstHash, 'Supabase gets the raw nonce corresponding to Google’s hashed nonce');
    assert.equal(app.closed, 1, 'the auth modal closes after sign-in');
    assert.equal(app.cleared, 1);
    await flush();
    assert.notEqual(app.config.nonce, firstHash, 'a fresh nonce is generated after sign-in');
    app.config.error_callback({type:'popup_closed'});
    assert(app.messages.at(-1)[0].includes('closed'), 'popup failure is visible');
    app.window.supabaseClient.auth.signInWithIdToken = async () => ({error:new Error('Sign-in rejected')});
    await app.config.callback({credential:'invalid'});
    assert.equal(app.closed, 1, 'failed sign-in does not close the modal');
    assert.equal(app.messages.at(-1)[0], 'Sign-in rejected');
    assert(html.includes('js/pwa-google-auth.js?v=20261101-pwa-google') && sw.includes('js/pwa-google-auth.js?v=20261101-pwa-google'));
    assert(html.includes('js/auth.js?v=20261101-pwa-google') && sw.includes('js/auth.js?v=20261101-pwa-google'));
    assert(auth.includes("provider === 'google' && window.DLPwaGoogleAuth") && auth.includes('signInWithOAuth'), 'PWA Google avoids redirect; browser OAuth is retained');
    console.log('OK — PWA Google sign-in uses a nonce-bound ID token without navigating the app.');
})().catch(err => { console.error(err); process.exitCode=1; });
