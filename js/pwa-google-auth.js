/* Google Identity Services keeps the installed app in its own window. The
 * client ID is public; the Google client secret stays in Supabase. */
(function () {
    'use strict';
    var clientId = '666257583451-fiabdubc40hr60oul5cpa2l2n23mdsil.apps.googleusercontent.com';
    var loading = null;
    var busy = false;
    var ui;

    function installed() {
        try {
            return window.navigator.standalone === true ||
                window.matchMedia('(display-mode: standalone)').matches ||
                window.matchMedia('(display-mode: fullscreen)').matches ||
                /[?&]pwa=1(&|$)/.test(window.location.search);
        } catch (_) { return window.navigator.standalone === true; }
    }
    function loadGoogle() {
        if (window.google && window.google.accounts && window.google.accounts.id) return Promise.resolve();
        return new Promise(function (resolve, reject) {
            var script = document.createElement('script');
            script.src = 'https://accounts.google.com/gsi/client';
            script.async = true;
            script.onload = resolve;
            script.onerror = function () { script.remove(); reject(new Error('Google sign-in could not be loaded. Check your connection and try again.')); };
            document.head.appendChild(script);
        });
    }
    function hex(bytes) {
        return Array.from(new Uint8Array(bytes), function (n) { return n.toString(16).padStart(2, '0'); }).join('');
    }
    async function render() {
        if (!window.crypto || !window.crypto.getRandomValues || !window.crypto.subtle) {
            throw new Error('Google sign-in requires a secure connection.');
        }
        var random = new Uint8Array(32);
        window.crypto.getRandomValues(random);
        var nonce = hex(random);
        var hashedNonce = hex(await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(nonce)));
        await loadGoogle();
        var googleId = window.google && window.google.accounts && window.google.accounts.id;
        if (!googleId) throw new Error('Google sign-in is unavailable. Please try again.');
        googleId.initialize({
            client_id: clientId,
            nonce: hashedNonce,
            ux_mode: 'popup',
            callback: async function (response) {
                if (busy) return;
                busy = true;
                try {
                    if (!response || !response.credential) throw new Error('Google did not return a credential. Please try again.');
                    ui.message('Signing in with Google…', 'success');
                    var result = await window.supabaseClient.auth.signInWithIdToken({
                        provider: 'google', token: response.credential, nonce: nonce
                    });
                    if (result.error) throw result.error;
                    ui.clear();
                    ui.close();
                } catch (error) {
                    ui.message(error.message || 'Google sign-in failed. Please try again.', 'error');
                } finally {
                    busy = false;
                    // A fresh nonce is used for each subsequent sign-in attempt.
                    loading = null;
                    start().catch(function () {});
                }
            },
            error_callback: function () {
                ui.message('The Google sign-in window could not be opened or was closed. Please try again.', 'error');
            }
        });
        document.querySelectorAll('.auth-oauth-row').forEach(function (row) {
            var button = row.querySelector('.auth-oauth-btn');
            var mount = row.querySelector('.pwa-google-button');
            if (!mount || !button) return;
            mount.replaceChildren();
            googleId.renderButton(mount, { theme: 'outline', size: 'large', text: 'continue_with', width: 280 });
            mount.hidden = false;
            button.hidden = true;
            // .auth-oauth-btn declares display:flex; hidden alone cannot override it.
            button.style.display = 'none';
        });
    }
    function start() {
        if (!loading) {
            loading = render().catch(function (error) {
                loading = null;
                throw error;
            });
        }
        return loading;
    }
    window.DLPwaGoogleAuth = {
        installed: installed,
        init: function (callbacks) {
            ui = callbacks;
            if (installed()) start().catch(function () { /* Retry when the user taps. */ });
        },
        retry: function () {
            ui.message('Loading Google sign-in…', 'success');
            start().then(function () { ui.message('Tap the Google button to continue.', 'success'); })
                .catch(function (error) { ui.message(error.message || 'Google sign-in is unavailable. Please try again.', 'error'); });
        }
    };
}());
