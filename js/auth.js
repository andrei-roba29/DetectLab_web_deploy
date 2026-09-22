        /* ══════════════════════════════════════════════
           DetectLab Auth System - FIXED VERSION 20260922
           Prevents duplicate Gmail accounts (Google OAuth vs email/password)
           Fixes logout-after-3-seconds bug caused by refresh-token collisions
        ══════════════════════════════════════════════ */
        (function () {
            var _user = null;
            var _authReadyResolve;
            window._authReadyPromise = new Promise(function (resolve) {
                _authReadyResolve = resolve;
            });

            var _startupEventReceived = false;
            var _startupComplete = false;

            function _dispatchAuthChange() {
                try {
                    window.dispatchEvent(new CustomEvent('detectlab:authchange', {
                        detail: { user: _user }
                    }));
                } catch (e) {}
            }

            /* ── Email normalization (mirrors server-side public.normalize_email) ──
               Gmail ignores dots and +tags: j.o.h.n.d.o.e+test@gmail.com === johndoe@gmail.com
               We use same logic client-side for instant UX feedback.
            */
            function normalizeEmailClient(email) {
                if (!email) return '';
                var e = String(email).trim().toLowerCase();
                var at = e.indexOf('@');
                if (at === -1) return e;
                var local = e.slice(0, at);
                var domain = e.slice(at + 1);
                if (domain === 'gmail.com' || domain === 'googlemail.com') {
                    var plus = local.indexOf('+');
                    if (plus !== -1) local = local.slice(0, plus);
                    local = local.replace(/\./g, '');
                    domain = 'gmail.com';
                }
                return local + '@' + domain;
            }

            /* ── Check if email already exists via RPC ──
               Calls public.check_email_exists(p_email) which is security definer
               and reads auth.users via normalized comparison.
               Returns true/false, or null if RPC not available (fallback to allow).
            */
            async function checkEmailExists(email) {
                try {
                    if (!window.supabaseClient) return null;
                    // Try both param names for compatibility
                    var res = await window.supabaseClient.rpc('check_email_exists', { p_email: email });
                    if (res.error) {
                        // Fallback: try with 'email' param name
                        var res2 = await window.supabaseClient.rpc('check_email_exists', { email: email });
                        if (res2.error) {
                            console.warn('[Auth] check_email_exists RPC failed:', res.error.message, res2.error.message);
                            return null;
                        }
                        return !!res2.data;
                    }
                    return !!res.data;
                } catch (e) {
                    console.warn('[Auth] checkEmailExists threw:', e && e.message);
                    return null;
                }
            }

            function isAuthErrorFatal(err) {
                if (!err) return false;
                var status = err.status || (err.error && err.error.status);
                // 401/403 are always fatal, but 400 can be transient (e.g. duplicate signup)
                if (status === 401 || status === 403) {
                    return true;
                }
                var msg = String(err.message || err.error_description || err.name || '').toLowerCase();
                // NOTE: refresh_token_not_found and already used are treated as
                // RECOVERABLE during startup validation to avoid logout loops
                // caused by duplicate accounts or concurrent tabs.
                var fatalKeywords = [
                    'invalid refresh token',
                    'jwt expired',
                    'token is expired',
                    'user not found',
                    'invalid claim',
                    'session_not_found',
                    'authsessionmissingerror',
                    '401',
                    '403'
                ];
                for (var i = 0; i < fatalKeywords.length; i++) {
                    if (msg.indexOf(fatalKeywords[i]) !== -1) {
                        return true;
                    }
                }
                return false;
            }

            function isRefreshTokenReuseError(err) {
                if (!err) return false;
                var msg = String(err.message || err.error_description || '').toLowerCase();
                return msg.indexOf('already used') !== -1 || msg.indexOf('refresh_token_not_found') !== -1 || msg.indexOf('refresh token not found') !== -1;
            }

            function isDuplicateEmailError(err) {
                if (!err) return false;
                var msg = String(err.message || err.error_description || '').toLowerCase();
                return msg.indexOf('already exists') !== -1 ||
                       msg.indexOf('already registered') !== -1 ||
                       msg.indexOf('user already registered') !== -1 ||
                       msg.indexOf('already been registered') !== -1 ||
                       msg.indexOf('duplicate') !== -1 ||
                       (err.status === 409);
            }

            function friendlyDuplicateMessage(email) {
                var safeEmail = email ? ' (' + email + ')' : '';
                return 'An account with this email' + safeEmail + ' already exists. ' +
                       'If you previously signed in with Google, please use "Continue with Google" instead. ' +
                       'If you registered with email/password, please log in.';
            }

/* ── Newsletter: persist the registration checkbox to DB ────────
   The checkbox value is stored in user_metadata at sign-up, but the
   source of truth is public.profiles.newsletter_subscribed (migration 013).
   We sync in both directions:
     · DB trigger sync_newsletter_from_user_metadata handles brand-new
       sign-ups server-side.
     · This client helper covers: (a) deployments before the trigger exists,
       (b) the brief window where the trigger hasn't fired yet, (c) users
       who confirmed e-mail on a different device.
   It never unsubscribes someone — only opt-in (true) is pushed.
*/
async function _syncNewsletterFromSession(session) {
    try {
        if (!session || !session.user) return;
        var want = !!(session.user.user_metadata && session.user.user_metadata.newsletter_opt_in);
        if (!want) return;
        var token = session.access_token;
        if (!token && window.supabaseClient && window.supabaseClient.auth && window.supabaseClient.auth.getSession) {
            try { var r2 = await window.supabaseClient.auth.getSession(); token = r2 && r2.data && r2.data.session ? r2.data.session.access_token : null; } catch(e) {}
        }
        var apiBase = (typeof window._dlApiBase !== 'undefined' && window._dlApiBase) ? window._dlApiBase : 'https://detectlab-backend-production.up.railway.app/api';
        if (token) {
            try {
                var r = await fetch(apiBase + '/newsletter/subscribe', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }
                });
                if (r.ok) { if (typeof window.loadNewsletterStatus === 'function') window.loadNewsletterStatus(); return; }
            } catch (e) {}
        }
        if (window.supabaseClient && window.supabaseClient.from) {
            try {
                await window.supabaseClient.from('profiles').upsert({
                    id: session.user.id,
                    newsletter_subscribed: true,
                    newsletter_subscribed_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                }, { onConflict: 'id' });
                if (typeof window.loadNewsletterStatus === 'function') window.loadNewsletterStatus();
            } catch (e) { console.warn('[Newsletter] fallback upsert failed:', e && e.message); }
        }
    } catch (e) { console.warn('[Newsletter] sync failed:', e && e.message); }
}

/* Sync the in-memory user (and the header / map-gate UI) with a
   Supabase session object — or clear it when signed out. */
function _syncFromSession(session) {
    if (session && session.user) {
        _save({
            id: session.user.id,
            name: session.user.user_metadata.full_name || session.user.email.split("@")[0],
            email: session.user.email,
            user_metadata: session.user.user_metadata
        });
        if (typeof window.loadUserPremiumProfile === 'function') {
            window.loadUserPremiumProfile(session.user.id);
        }
        _syncNewsletterFromSession(session);
        if (typeof window.loadNewsletterStatus === 'function') {
            window.loadNewsletterStatus();
        }
    } else {
        _clear();
    }
    _updateNav();
    _updateMapGate();
}

try {
    if (window.supabaseClient && window.supabaseClient.auth) {
        window.supabaseClient.auth.onAuthStateChange(function (event, session) {
            if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
                if (!_startupComplete) {
                    _startupEventReceived = true;
                }
            }
            if (event === 'INITIAL_SESSION') return;
            // If we get SIGNED_OUT but it's due to refresh token reuse, try to recover once
            if (event === 'SIGNED_OUT' && _startupComplete) {
                // Small delay to allow supabase-js to attempt refresh
                console.warn('[Auth] Received SIGNED_OUT event, checking if recoverable...');
            }
            _syncFromSession(session);
        });

        window.supabaseClient.auth.getSession().then(async function (result) {
            var session = result && result.data ? result.data.session : null;
            if (!session || !session.user) {
                _clear();
                _updateNav();
                _updateMapGate();
                _startupComplete = true;
                if (_authReadyResolve) _authReadyResolve(_user);
                return;
            }

            var validationFailedFatal = false;
            var validatedUser = null;
            var isReuseError = false;
            try {
                var timeoutPromise = new Promise(function (resolve, reject) {
                    setTimeout(function () {
                        reject(new Error("Network timeout"));
                    }, 5000);
                });
                var getUserPromise = window.supabaseClient.auth.getUser();
                var userResult = await Promise.race([getUserPromise, timeoutPromise]);
                if (userResult && userResult.error) {
                    if (isRefreshTokenReuseError(userResult.error)) {
                        isReuseError = true;
                        console.warn('[Auth] Refresh token reuse detected during startup, preserving session to avoid logout loop:', userResult.error.message);
                    } else if (isAuthErrorFatal(userResult.error)) {
                        validationFailedFatal = true;
                    }
                } else if (userResult && userResult.data && userResult.data.user) {
                    validatedUser = userResult.data.user;
                }
            } catch (err) {
                if (isRefreshTokenReuseError(err)) {
                    isReuseError = true;
                    console.warn('[Auth] Refresh token reuse caught, preserving session:', err.message);
                } else if (isAuthErrorFatal(err)) {
                    validationFailedFatal = true;
                }
            }

            if (_startupEventReceived) {
                _startupComplete = true;
                if (_authReadyResolve) _authReadyResolve(_user);
                return;
            }

            if (validationFailedFatal) {
                try {
                    await window.supabaseClient.auth.signOut();
                } catch (e) {}
                _clear();
                _updateNav();
                _updateMapGate();
                _startupComplete = true;
                if (_authReadyResolve) _authReadyResolve(_user);
                return;
            }

            // If it's a reuse error, we preserve the session instead of signing out
            // This fixes the 3-second logout bug for duplicate accounts and concurrent tabs
            if (isReuseError) {
                console.warn('[Auth] Preserving session despite refresh token reuse error');
            }

            _syncFromSession(session);
            _startupComplete = true;
            if (_authReadyResolve) _authReadyResolve(_user);
        }).catch(function (err) {
            console.warn("Supabase getSession failed:", err);
            _clear();
            _updateNav();
            _updateMapGate();
            _startupComplete = true;
            if (_authReadyResolve) _authReadyResolve(_user);
        });
    } else {
        _startupComplete = true;
        if (_authReadyResolve) _authReadyResolve(null);
    }
} catch (err) {
    console.warn("Supabase init error:", err);
    _startupComplete = true;
    if (_authReadyResolve) _authReadyResolve(null);
}

function _save(u) {
    var changed = (_user !== u);
    _user = u;
    if (changed) _dispatchAuthChange();
}

function _clear() {
    var changed = (_user !== null);
    _user = null;
    if (changed) _dispatchAuthChange();
}

function _updateNav() {
    var pill = document.getElementById('navUser');
    var loginBtn = document.getElementById('navLoginBtn');
    var getAccess = document.getElementById('navGetAccess');
    if (_user) {
        var avatar = document.getElementById('navAvatar');
        var username = document.getElementById('navUsername');
        if (avatar) avatar.textContent = _user.name.charAt(0).toUpperCase();
        if (username) username.textContent = _user.name.split(' ')[0];
        if (pill) pill.classList.add('show');
        if (loginBtn) loginBtn.style.display = 'none';
        if (getAccess) getAccess.style.display = '';
    } else {
        if (pill) pill.classList.remove('show');
        if (loginBtn) loginBtn.style.display = '';
    }
}

function _showMsg(msg, type, isHtml) {
    var el = document.getElementById('authMsg');
    if (!el) return;
    if (isHtml) { el.innerHTML = msg; } else { el.textContent = msg; }
    el.className = 'auth-msg ' + (type || 'error');
}

function _clearMsg() {
    var el = document.getElementById('authMsg');
    if (el) {
        el.textContent = '';
        el.className = 'auth-msg';
    }
}

function fixMapLegendAndControls() {
    var legend = document.querySelector('.map-legend-bar');
    var controls = document.querySelector('.map-controls');
    var container = document.querySelector('#map-section .container');

    if (legend && controls && container) {
        container.appendChild(legend);
        container.appendChild(controls);
        legend.style.cssText = 'display: flex; flex-wrap: wrap; margin-top: 16px; position: relative;';
        controls.style.cssText = 'display: flex; gap: 16px; margin-top: 14px; position: relative;';
    }
}

document.addEventListener('DOMContentLoaded', fixMapLegendAndControls);
setTimeout(fixMapLegendAndControls, 500);

function _updateMapGate() {
    var gate = document.getElementById('mapAuthGate');
    if (!gate) return;
    if (_user) {
        gate.classList.add('hidden');
        _setMapControlsHidden(false);
    }
}

window.openAuth = function (tab) {
    _clearMsg();
    // Check for OAuth errors in URL (e.g. duplicate email rejected by hook)
    try {
        var hash = window.location.hash || '';
        var search = window.location.search || '';
        var combined = hash + '&' + search;
        if (combined.indexOf('error_description') !== -1 || combined.indexOf('error=') !== -1) {
            var params = new URLSearchParams(combined.replace(/^#/, '?').replace(/^\?/, '?'));
            // Also try hash parsing manually
            var errDesc = params.get('error_description') || params.get('error');
            if (errDesc) {
                errDesc = decodeURIComponent(errDesc.replace(/\+/g, ' '));
                if (isDuplicateEmailError({ message: errDesc })) {
                    _showMsg(friendlyDuplicateMessage(''), 'error');
                } else {
                    _showMsg(errDesc, 'error');
                }
                // Clean URL
                try {
                    var cleanUrl = window.location.pathname + window.location.search.replace(/[\?&]error[^&]*/g, '').replace(/[\?&]error_description[^&]*/g, '');
                    window.history.replaceState(null, '', cleanUrl + window.location.hash.replace(/#.*error.*/, ''));
                } catch(e){}
            }
        }
    } catch(e){}
    switchAuthTab(tab || 'login');
    var modal = document.getElementById('authModal');
    if (modal) modal.classList.add('show');
    setTimeout(function () {
        var f = document.querySelector('#authModal .auth-input');
        if (f) f.focus();
    }, 100);
};

window.closeAuth = function () {
    var modal = document.getElementById('authModal');
    if (modal) modal.classList.remove('show');
};

var authModal = document.getElementById('authModal');
if (authModal) {
    authModal.addEventListener('click', function (e) {
        if (e.target === this) closeAuth();
    });
}

document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeAuth();
});

window.switchAuthTab = function (tab) {
    var loginForm = document.getElementById('loginForm');
    var registerForm = document.getElementById('registerForm');
    var tabLogin = document.getElementById('authTabLogin');
    var tabRegister = document.getElementById('authTabRegister');
    
    if (loginForm) loginForm.style.display = tab === 'login' ? 'flex' : 'none';
    if (registerForm) registerForm.style.display = tab === 'register' ? 'flex' : 'none';
    if (tabLogin) tabLogin.classList.toggle('active', tab === 'login');
    if (tabRegister) tabRegister.classList.toggle('active', tab === 'register');
    _clearMsg();
};

/* ══════════════════════════════════════════════
   LOGIN - WITH DUPLICATE EMAIL DETECTION
══════════════════════════════════════════════ */
window.doLogin = async function () {
    console.log("=== doLogin START ===");
    
    try {
        var loginForm = document.getElementById('loginForm');
        if (!loginForm) {
            _showMsg('Login form not found');
            return;
        }
        
        var emailInputs = loginForm.querySelectorAll('input[type="email"]');
        var passwordInputs = loginForm.querySelectorAll('input[type="password"]');
        
        if (emailInputs.length === 0 || passwordInputs.length === 0) {
            _showMsg('Form fields not found. Check browser console.');
            return;
        }
        
        var email = emailInputs[0] ? (emailInputs[0].value || '').trim() : '';
        var pass = passwordInputs[0] ? (passwordInputs[0].value || '') : '';
        
        if (!email || !pass) {
            _showMsg('Please fill in all fields.');
            return;
        }

        var btn = loginForm.querySelector('.auth-submit');
        if (!btn) {
            _showMsg('Submit button not found');
            return;
        }
        
        btn.textContent = 'Logging in…';
        btn.disabled = true;

        try {
            if (!window.supabaseClient || !window.supabaseClient.auth) {
                throw new Error('Supabase not ready');
            }

            const { data, error } = await window.supabaseClient.auth.signInWithPassword({
                email: email,
                password: pass
            });

            if (error) throw error;

            const user = data.user;
            _save({
                id: user.id,
                name: user.user_metadata.full_name || user.email.split("@")[0],
                email: user.email,
                user_metadata: user.user_metadata
            });

            _updateNav();
            _updateMapGate();
            _showMsg("Welcome back!", "success");
            setTimeout(closeAuth, 1200);
            console.log("Login successful");
        } catch (err) {
            console.error('Supabase login error:', err);
            var msg = err.message || 'Login failed';
            var lower = msg.toLowerCase();
            // If invalid credentials, check if email exists and suggest Google
            if (lower.indexOf('invalid login credentials') !== -1 || lower.indexOf('invalid') !== -1) {
                try {
                    var exists = await checkEmailExists(email);
                    if (exists) {
                        // Could be Google-only account
                        msg = 'Invalid password. If you previously signed in with Google, please use "Continue with Google" instead. Otherwise, check your password or reset it.';
                    } else {
                        msg = 'No account found with this email. Please register first or use Google sign-in.';
                    }
                } catch (e) {}
            }
            _showMsg(msg);
        } finally {
            btn.textContent = 'Log In to DetectLab';
            btn.disabled = false;
        }
    } catch (err) {
        console.error('doLogin outer error:', err);
        _showMsg('An unexpected error occurred');
    }
    console.log("=== doLogin END ===");
};

/* ══════════════════════════════════════════════
   REGISTER - WITH DUPLICATE PREVENTION
══════════════════════════════════════════════ */
window.doRegister = async function () {
    console.log("=== doRegister START ===");
    
    try {
        var regForm = document.getElementById('registerForm');
        if (!regForm) {
            _showMsg('Register form not found');
            return;
        }
        
        var allInputs = regForm.querySelectorAll('input');
        var textInputs = [];
        var emailInputs = [];
        var passwordInputs = [];
        
        allInputs.forEach(function(inp) {
            if (inp.type === 'text') textInputs.push(inp);
            else if (inp.type === 'email') emailInputs.push(inp);
            else if (inp.type === 'password') passwordInputs.push(inp);
        });
        
        var name = textInputs[0] ? (textInputs[0].value || '').trim() : '';
        var email = emailInputs[0] ? (emailInputs[0].value || '').trim() : '';
        var pass = passwordInputs[0] ? (passwordInputs[0].value || '') : '';
        var pass2 = passwordInputs[1] ? (passwordInputs[1].value || '') : '';
        
        if (!name || !email || !pass || !pass2) {
            _showMsg('Please fill in all fields.');
            return;
        }
        
        if (pass !== pass2) {
            _showMsg('Passwords do not match.');
            return;
        }
        
        if (pass.length < 8) {
            _showMsg('Password must be at least 8 characters.');
            return;
        }

        var regTerms = document.getElementById('regTerms');
        if (!regTerms || !regTerms.checked) {
            _showMsg('Please agree to the Terms and Conditions to continue.');
            return;
        }
        var newsletterOptIn = document.getElementById('regNewsletter');
        var btn = regForm.querySelector('.auth-submit');
        if (!btn) {
            _showMsg('Submit button not found');
            return;
        }
        
        btn.textContent = 'Checking email…';
        btn.disabled = true;

        try {
            if (!window.supabaseClient || !window.supabaseClient.auth) {
                throw new Error('Supabase not ready');
            }

            // ── STEP 1: Client-side duplicate check via RPC ──
            // This prevents the bug where Google login + email signup creates duplicate accounts
            try {
                var exists = await checkEmailExists(email);
                if (exists === true) {
                    _showMsg(friendlyDuplicateMessage(email), 'error');
                    btn.textContent = 'Create Free Account';
                    btn.disabled = false;
                    console.log("Register blocked: email already exists:", email);
                    return;
                }
                // If RPC returns null (not available), we continue and let server hook handle it
            } catch (checkErr) {
                console.warn('[Auth] Duplicate check failed, proceeding to signup:', checkErr && checkErr.message);
            }

            btn.textContent = 'Creating Account…';

            var newsletterWanted = !!(newsletterOptIn && newsletterOptIn.checked);
            const { data, error } = await window.supabaseClient.auth.signUp({
                email: email,
                password: pass,
                options: {
                    data: {
                        full_name: name,
                        newsletter_opt_in: newsletterWanted
                    }
                }
            });

            if (error) throw error;

            // Supabase can return a user with identities empty if email already exists
            // and confirmations are enabled (to prevent enumeration). Detect that case.
            if (data && data.user && data.user.identities && data.user.identities.length === 0) {
                _showMsg(friendlyDuplicateMessage(email), 'error');
                console.log("Register blocked: Supabase returned empty identities (email already exists)");
                return;
            }

            if (newsletterWanted && data) {
                var newSession = data.session || null;
                var newUser = data.user || null;
                if (newSession && newSession.access_token) {
                    try {
                        var apiBase2 = (typeof window._dlApiBase !== 'undefined' && window._dlApiBase) ? window._dlApiBase : 'https://detectlab-backend-production.up.railway.app/api';
                        await fetch(apiBase2 + '/newsletter/subscribe', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + newSession.access_token }
                        });
                    } catch (e) { console.warn('[Newsletter] post-signup sync (session) failed:', e && e.message); }
                } else if (newUser && newUser.id && window.supabaseClient && window.supabaseClient.from) {
                    try {
                        await window.supabaseClient.from('profiles').upsert({
                            id: newUser.id,
                            newsletter_subscribed: true,
                            newsletter_subscribed_at: new Date().toISOString(),
                            updated_at: new Date().toISOString()
                        }, { onConflict: 'id' });
                    } catch (e) {}
                }
            }

            allInputs.forEach(function(inp) {
                if (inp.type === 'checkbox') inp.checked = false;
                else inp.value = '';
            });

            var successMsg = newsletterWanted
                ? 'Account created! Check your email for confirmation. You are subscribed to the newsletter — you can manage it in your account.'
                : 'Account created! Check your email for confirmation.';
            _showMsg(successMsg, 'success');

            setTimeout(closeAuth, 1200);
            console.log("Register successful");
        } catch (err) {
            console.error('Supabase register error:', err);
            var errMsg = err.message || 'Registration failed';
            if (isDuplicateEmailError(err)) {
                _showMsg(friendlyDuplicateMessage(email), 'error');
            } else {
                _showMsg(errMsg);
            }
        } finally {
            btn.textContent = 'Create Free Account';
            btn.disabled = false;
        }
    } catch (err) {
        console.error('doRegister outer error:', err);
        _showMsg('An unexpected error occurred');
    }
    console.log("=== doRegister END ===");
};

/* ══════════════════════════════════════════════
   OAUTH (Google / Apple) - WITH DUPLICATE HANDLING
══════════════════════════════════════════════ */
window.authWithProvider = async function (provider) {
    try {
        if (!window.supabaseClient || !window.supabaseClient.auth) {
            _showMsg('Supabase not ready');
            return;
        }
        _clearMsg();
        _showMsg('Redirecting to ' + provider + '...', 'success');
        const { error } = await window.supabaseClient.auth.signInWithOAuth({
            provider: provider,
            options: {
                redirectTo: window.location.origin + window.location.pathname,
                // For Google, request offline access to get refresh token
                queryParams: provider === 'google' ? { access_type: 'offline', prompt: 'consent' } : undefined
            }
        });
        if (error) {
            console.error(provider + ' OAuth error:', error);
            if (isDuplicateEmailError(error)) {
                _showMsg(friendlyDuplicateMessage(''), 'error');
            } else {
                _showMsg(error.message || (provider + ' sign-in failed'));
            }
        }
    } catch (err) {
        console.error(provider + ' OAuth outer error:', err);
        _showMsg('An unexpected error occurred');
    }
};

/* ── Logout ── */
window.authLogout = async function () {
    try {
        if (window.supabaseClient && window.supabaseClient.auth) {
            await window.supabaseClient.auth.signOut();
        }
        _clear();
        _updateNav();

        var accountPanel = document.getElementById('accountPanel');
        if (accountPanel && accountPanel.classList.contains('active') &&
            typeof window.closeAccountPanel === 'function') {
            window.closeAccountPanel();
        }

        _showAuthGate(
            'Explore the Map',
            'Log in or create a free account.',
            true
        );
    } catch (err) {
        console.error('Logout error:', err);
    }
};

window._authUser = function () { return _user; };
window._authNormalizeEmail = normalizeEmailClient;
window._authCheckEmailExists = checkEmailExists;

_updateNav();

function _setMapControlsHidden(hidden) {
    var elements = [
        'mapSearchWrap',
        'transpTab',
        'transpPanel',
        'verticalOpacityControl',
        'verticalSatPeriodControl',
        'mapHelpBtn'
    ];
    elements.forEach(function(elId) {
        var el = document.getElementById(elId);
        if (el) {
            if (hidden) el.classList.add('auth-hidden');
            else el.classList.remove('auth-hidden');
        }
    });
}

function _showAuthGate(titleText, descText, showBtns) {
    var gate = document.getElementById('mapAuthGate');
    if (!gate) return;
    gate.classList.remove('hidden');
    
    var title = document.getElementById('authGateTitle');
    var desc = document.getElementById('authGateDesc');
    if (title) title.textContent = titleText || 'Access the Map';
    if (desc) desc.textContent = descText || 'Log in or create account.';
    
    var btns = gate.querySelector('.auth-gate-btns');
    if (btns) btns.style.display = (showBtns === false) ? 'none' : '';
    
    _setMapControlsHidden(true);
}

window.switchTab = function (btn, tab) {
    var user = window._authUser ? window._authUser() : null;
    
    if (btn) {
        document.querySelectorAll('.map-tab').forEach(function(b) {
            b.classList.remove('active');
        });
        btn.classList.add('active');
    }
    
    if (!user && tab !== 'free' && tab !== 'weather') {
        _showAuthGate('Explore the Map', 'Log in or create a free account.', true);
        return;
    }
    
    if (user) {
        var gate = document.getElementById('mapAuthGate');
        if (gate) gate.classList.add('hidden');
    }
};

(function () {
    window.addEventListener('load', function() {
        if (!_user) {
            _showAuthGate('Explore the Map', 'Log in or create a free account.', true);
        }
        // Also check URL for OAuth errors after redirect
        try {
            var hash = window.location.hash || '';
            if (hash.indexOf('error') !== -1) {
                var params = new URLSearchParams(hash.replace(/^#/, '?'));
                var err = params.get('error_description') || params.get('error');
                if (err) {
                    err = decodeURIComponent(err.replace(/\+/g, ' '));
                    if (err.toLowerCase().indexOf('already exists') !== -1) {
                        _showMsg(friendlyDuplicateMessage(''), 'error');
                        if (typeof window.openAuth === 'function') {
                            setTimeout(function(){ window.openAuth('login'); }, 500);
                        }
                    }
                }
            }
        } catch(e){}
    });
})();

console.log("✅ AUTH JS LOADED - FIXED VERSION 20260922 (duplicate email prevention)");
        })();
