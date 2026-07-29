        /* ══════════════════════════════════════════════
           DetectLab Auth System - ULTRA-DEFENSIVE VERSION
           Maximum error checking, logging, and fallbacks
           No .value calls on potentially null elements
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

            function isAuthErrorFatal(err) {
                if (!err) return false;
                var status = err.status || (err.error && err.error.status);
                if (status === 401 || status === 403 || status === 400) {
                    return true;
                }
                var msg = String(err.message || err.error_description || err.name || '').toLowerCase();
                var fatalKeywords = [
                    'invalid refresh token',
                    'refresh_token_not_found',
                    'already used',
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

/* Sync the in-memory user (and the header / map-gate UI) with a
   Supabase session object — or clear it when signed out. */
function _syncFromSession(session) {
    if (session && session.user) {
        _save({
            name: session.user.user_metadata.full_name || session.user.email.split("@")[0],
            email: session.user.email
        });
    } else {
        _clear();
    }
    _updateNav();
    _updateMapGate();
}

try {
    if (window.supabaseClient && window.supabaseClient.auth) {
        // Keep the UI synchronized with Supabase auth-state changes:
        // OAuth redirect return, token refresh, sign-in/out in other tabs.
        window.supabaseClient.auth.onAuthStateChange(function (event, session) {
            if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
                if (!_startupComplete) {
                    _startupEventReceived = true;
                }
            }
            if (event === 'INITIAL_SESSION') return; // handled by getSession() below
            _syncFromSession(session);
        });

        // Restore the persisted session from local storage so the account
        // controls reappear immediately on PWA relaunch — getSession()
        // resolves locally and does not depend on a network round trip.
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

            // A cached session exists: validate it with auth.getUser() before revealing UI
            var validationFailedFatal = false;
            var validatedUser = null;
            try {
                var timeoutPromise = new Promise(function (resolve, reject) {
                    setTimeout(function () {
                        reject(new Error("Network timeout"));
                    }, 5000);
                });
                var getUserPromise = window.supabaseClient.auth.getUser();
                var userResult = await Promise.race([getUserPromise, timeoutPromise]);
                if (userResult && userResult.error) {
                    if (isAuthErrorFatal(userResult.error)) {
                        validationFailedFatal = true;
                    }
                } else if (userResult && userResult.data && userResult.data.user) {
                    validatedUser = userResult.data.user;
                }
            } catch (err) {
                if (isAuthErrorFatal(err)) {
                    validationFailedFatal = true;
                }
            }

            // Handle a newer SIGNED_IN/SIGNED_OUT event received while startup validation was running
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

            // Valid session or preserved during temporary network failure/timeout
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
   LOGIN - ULTRA-SAFE VERSION
══════════════════════════════════════════════ */
window.doLogin = async function () {
    console.log("=== doLogin START ===");
    
    try {
        var loginForm = document.getElementById('loginForm');
        console.log("loginForm:", !!loginForm);
        
        if (!loginForm) {
            console.error("loginForm not found in DOM");
            _showMsg('Login form not found');
            return;
        }
        
        // Find email and password inputs
        var emailInputs = loginForm.querySelectorAll('input[type="email"]');
        var passwordInputs = loginForm.querySelectorAll('input[type="password"]');
        
        console.log("emailInputs found:", emailInputs.length);
        console.log("passwordInputs found:", passwordInputs.length);
        
        if (emailInputs.length === 0 || passwordInputs.length === 0) {
            console.error("Missing email or password input", {
                emails: emailInputs.length,
                passwords: passwordInputs.length
            });
            
            // Debug: list all inputs
            var allInputs = loginForm.querySelectorAll('input');
            console.log("All inputs in loginForm:", allInputs.length);
            allInputs.forEach(function(inp, idx) {
                console.log(idx + ":", {
                    type: inp.type,
                    id: inp.id,
                    name: inp.name,
                    placeholder: inp.placeholder
                });
            });
            
            _showMsg('Form fields not found. Check browser console.');
            return;
        }
        
        var email = emailInputs[0] ? (emailInputs[0].value || '').trim() : '';
        var pass = passwordInputs[0] ? (passwordInputs[0].value || '') : '';
        
        console.log("Extracted:", { email: email ? "✓" : "✗", pass: pass ? "✓" : "✗" });
        
        if (!email || !pass) {
            _showMsg('Please fill in all fields.');
            return;
        }

        var btn = loginForm.querySelector('.auth-submit');
        if (!btn) {
            console.error("Submit button not found");
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
                name: user.user_metadata.full_name || user.email.split("@")[0],
                email: user.email
            });

            _updateNav();
            _updateMapGate();
            _showMsg("Welcome back!", "success");
            setTimeout(closeAuth, 1200);
            console.log("Login successful");
        } catch (err) {
            console.error('Supabase login error:', err);
            _showMsg(err.message || 'Login failed');
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
   REGISTER - ULTRA-SAFE VERSION
══════════════════════════════════════════════ */
window.doRegister = async function () {
    console.log("=== doRegister START ===");
    
    try {
        var regForm = document.getElementById('registerForm');
        console.log("registerForm:", !!regForm);
        
        if (!regForm) {
            console.error("registerForm not found in DOM");
            _showMsg('Register form not found');
            return;
        }
        
        // Get all inputs
        var allInputs = regForm.querySelectorAll('input');
        console.log("Total inputs in registerForm:", allInputs.length);
        
        // Log each input for debugging
        var textInputs = [];
        var emailInputs = [];
        var passwordInputs = [];
        
        allInputs.forEach(function(inp, idx) {
            var info = {
                idx: idx,
                type: inp.type,
                id: inp.id,
                name: inp.name,
                placeholder: inp.placeholder,
                value: inp.value ? "***" : "(empty)"
            };
            console.log("Input " + idx + ":", info);
            
            if (inp.type === 'text') textInputs.push(inp);
            else if (inp.type === 'email') emailInputs.push(inp);
            else if (inp.type === 'password') passwordInputs.push(inp);
        });
        
        console.log("Categorized:", {
            texts: textInputs.length,
            emails: emailInputs.length,
            passwords: passwordInputs.length
        });
        
        // Extract values safely
        var name = textInputs[0] ? (textInputs[0].value || '').trim() : '';
        var email = emailInputs[0] ? (emailInputs[0].value || '').trim() : '';
        var pass = passwordInputs[0] ? (passwordInputs[0].value || '') : '';
        var pass2 = passwordInputs[1] ? (passwordInputs[1].value || '') : '';
        
        console.log("Extracted:", {
            name: name ? "✓ (" + name + ")" : "✗",
            email: email ? "✓ (" + email + ")" : "✗",
            pass: pass ? "✓" : "✗",
            pass2: pass2 ? "✓" : "✗"
        });
        
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

        var btn = regForm.querySelector('.auth-submit');
        if (!btn) {
            console.error("Submit button not found");
            _showMsg('Submit button not found');
            return;
        }
        
        btn.textContent = 'Creating Account…';
        btn.disabled = true;

        try {
            if (!window.supabaseClient || !window.supabaseClient.auth) {
                throw new Error('Supabase not ready');
            }

            const { data, error } = await window.supabaseClient.auth.signUp({
                email: email,
                password: pass,
                options: {
                    data: {
                        full_name: name
                    }
                }
            });

            if (error) throw error;

            // Clear inputs manually (div doesn't have .reset() method)
            allInputs.forEach(function(inp) {
                inp.value = '';
            });

            _showMsg(
                'Account created! Check your email for confirmation.',
                'success'
            );

            setTimeout(closeAuth, 1200);
            console.log("Register successful");
        } catch (err) {
            console.error('Supabase register error:', err);
            _showMsg(err.message || 'Registration failed');
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
   OAUTH (Google / Apple)
══════════════════════════════════════════════ */
window.authWithProvider = async function (provider) {
    try {
        if (!window.supabaseClient || !window.supabaseClient.auth) {
            _showMsg('Supabase not ready');
            return;
        }
        _clearMsg();
        const { error } = await window.supabaseClient.auth.signInWithOAuth({
            provider: provider, // 'google' or 'apple'
            options: {
                redirectTo: window.location.origin + window.location.pathname
            }
        });
        if (error) {
            console.error(provider + ' OAuth error:', error);
            _showMsg(error.message || (provider + ' sign-in failed'));
        }
        // On success Supabase redirects away from the page, so there's
        // nothing more to do here — the getUser() call at the top of this
        // file picks up the session once the user lands back on the page.
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

_updateNav();

function _setMapControlsHidden(hidden) {
    var elements = [
        'mapSearchWrap',
        'transpTab',
        'transpPanel'
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
    });
})();

console.log("✅ AUTH JS LOADED - ULTRA-DEFENSIVE VERSION");
        })();
