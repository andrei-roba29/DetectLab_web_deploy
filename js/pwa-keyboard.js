/* iOS Home Screen keyboard safeguards.
 * Native taps own focus: no hidden input, no delayed focus(), no focus loop.
 * The recovery dialog is for the WebKit bug where focus works but UIKit never
 * presents the keyboard (WebKit #279904). It never clears site/offline data.
 */
(function () {
    'use strict';

    var NON_TEXT_TYPES = /^(button|checkbox|color|file|hidden|image|radio|range|reset|submit)$/i;
    var body = document.body;
    var root = document.documentElement;
    var help = null;
    var helpTrigger = null;
    var revealTimer = null;
    var blurFrame = null;

    function isIOS() {
        var nav = window.navigator || {};
        return /iPad|iPhone|iPod/.test(nav.userAgent || '') ||
            (nav.platform === 'MacIntel' && (nav.maxTouchPoints || 0) > 1);
    }

    function isPWA() {
        try {
            return window.navigator.standalone === true ||
                window.matchMedia('(display-mode: standalone)').matches ||
                window.matchMedia('(display-mode: fullscreen)').matches;
        } catch (_) { return window.navigator.standalone === true; }
    }

    function isEditable(node) {
        if (!node || node.nodeType !== 1 || node.disabled || node.readOnly) return false;
        var editableAttr = node.getAttribute ? node.getAttribute('contenteditable') : null;
        if (editableAttr !== null) {
            editableAttr = editableAttr.toLowerCase();
            if (editableAttr === '' || editableAttr === 'true' || editableAttr === 'plaintext-only') return true;
        }
        if (node.isContentEditable) return true;
        var tag = node.tagName;
        if (tag === 'TEXTAREA') return true;
        return tag === 'INPUT' && !NON_TEXT_TYPES.test(node.type || 'text');
    }

    function activeField() {
        var active = document.activeElement;
        return isEditable(active) ? active : null;
    }

    function visibleRect() {
        var vv = window.visualViewport;
        return {
            top: vv ? vv.offsetTop || 0 : 0,
            height: vv ? vv.height || window.innerHeight || 0 : window.innerHeight || 0
        };
    }

    function publishViewport() {
        var rect = visibleRect();
        root.style.setProperty('--pwa-visible-top', Math.round(rect.top) + 'px');
        root.style.setProperty('--pwa-visible-height', Math.round(rect.height) + 'px');
    }

    function scrollParent(node) {
        var parent = node.parentElement;
        while (parent && parent !== body) {
            var style = window.getComputedStyle(parent);
            if (/(auto|scroll)/.test(style.overflowY) && parent.scrollHeight > parent.clientHeight) return parent;
            parent = parent.parentElement;
        }
        return null;
    }

    function revealField(field) {
        if (!field || field !== document.activeElement || !field.isConnected) return;
        var rect = visibleRect();
        var box = field.getBoundingClientRect();
        var parent = scrollParent(field);
        if (!parent) return;
        var parentBox = parent.getBoundingClientRect();
        var top = Math.max(rect.top + 12, parentBox.top + 12);
        var bottom = Math.min(rect.top + rect.height - 12, parentBox.bottom - 12);
        if (bottom <= top) return;
        var delta = box.top < top ? box.top - top : (box.bottom > bottom ? box.bottom - bottom : 0);
        if (delta) parent.scrollTop += delta;
    }

    function scheduleReveal() {
        var field = activeField();
        if (!field) return;
        publishViewport();
        window.requestAnimationFrame(function () { revealField(field); });
        window.clearTimeout(revealTimer);
        revealTimer = window.setTimeout(function () { revealField(field); }, 280);
    }

    function syncEditing() {
        var editing = !!activeField();
        body.classList.toggle('pwa-keyboard-open', editing);
        if (editing) scheduleReveal();
    }

    function copy() {
        var ro = (root.lang || 'ro').toLowerCase().indexOf('ro') === 0;
        return ro ? {
            trigger: 'Tastatura nu apare? Ajutor iOS',
            title: 'Tastatura nu apare pe iPhone?',
            intro: 'Unele versiuni iOS pot bloca tastatura doar în aplicația instalată, deși câmpurile primesc focus. Încearcă, pe rând:',
            restart: 'Închide complet aplicața și redeschide-o. Dacă problema persistă, repornește iPhone-ul.',
            browser: 'Deschide aceeași adresă în Safari ca să poți scrie acum. Sesiunea din Safari este separată; poate fi nevoie să te autentifici din nou.',
            update: 'Actualizează iOS. Dacă tastatura tot nu apare, șterge numai iconul DetectLab de pe ecranul principal și adaugă site-ul din nou din Safari.',
            warning: 'Nu șterge datele site-ului din Safari. Ștergerea iconului poate pierde hărțile offline și alte date locale nesincronizate.',
            open: 'Deschide în Safari',
            close: 'Închide'
        } : {
            trigger: 'Keyboard not appearing? iOS help',
            title: 'Keyboard not appearing on iPhone?',
            intro: 'Some iOS versions can block the keyboard only in the installed app, even though fields receive focus. Try these steps:',
            restart: 'Force-close and reopen the app. If it still happens, restart the iPhone.',
            browser: 'Open the same address in Safari to type now. Safari has a separate session, so you may need to sign in again.',
            update: 'Update iOS. If the keyboard is still missing, remove only the DetectLab Home Screen icon and add the site again from Safari.',
            warning: 'Do not clear Safari site data. Removing the icon may lose offline maps and other unsynced local data.',
            open: 'Open in Safari',
            close: 'Close'
        };
    }

    function browserUrl() {
        var url = new URL(window.location.href);
        url.searchParams.delete('pwa');
        return url.href;
    }

    function make(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text) node.textContent = text;
        return node;
    }

    function buildHelp() {
        if (help) return help;
        var text = copy();
        help = make('div', 'pwa-keyboard-help-modal');
        help.id = 'pwaKeyboardHelpModal';
        help.hidden = true;
        help.setAttribute('role', 'dialog');
        help.setAttribute('aria-modal', 'true');
        help.setAttribute('aria-labelledby', 'pwaKeyboardHelpTitle');
        var card = make('div', 'pwa-keyboard-help-card');
        var title = make('h2', '', text.title);
        title.id = 'pwaKeyboardHelpTitle';
        var intro = make('p', '', text.intro);
        var list = document.createElement('ol');
        [text.restart, text.browser, text.update].forEach(function (step) {
            list.appendChild(make('li', '', step));
        });
        var link = make('a', 'pwa-keyboard-help-link', text.open);
        link.href = browserUrl();
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        var address = make('p', 'pwa-keyboard-help-address', browserUrl());
        var warning = make('p', 'pwa-keyboard-help-warning', text.warning);
        var close = make('button', 'pwa-keyboard-help-close', text.close);
        close.type = 'button';
        close.addEventListener('click', closeHelp);
        card.append(title, intro, list, link, address, warning, close);
        help.appendChild(card);
        help.addEventListener('click', function (event) {
            if (event.target === help) closeHelp();
        });
        body.appendChild(help);
        return help;
    }

    function refreshHelp() {
        document.querySelectorAll('[data-pwa-keyboard-help]').forEach(function (button) {
            button.textContent = copy().trigger;
        });
        if (help) {
            var wasOpen = !help.hidden;
            var trigger = helpTrigger;
            help.remove();
            help = null;
            if (wasOpen) openHelp(trigger);
        }
    }

    function openHelp(trigger) {
        helpTrigger = trigger || document.activeElement;
        var dialog = buildHelp();
        dialog.hidden = false;
        dialog.querySelector('button').focus();
    }

    function closeHelp() {
        if (!help) return;
        help.hidden = true;
        if (helpTrigger && helpTrigger.isConnected) helpTrigger.focus();
        helpTrigger = null;
    }

    body.classList.toggle('is-ios', isIOS());
    body.classList.toggle('is-installed-pwa', isPWA());
    publishViewport();

    document.addEventListener('focusin', function (event) {
        if (!isEditable(event.target)) return;
        if (blurFrame) window.cancelAnimationFrame(blurFrame);
        syncEditing();
    });
    document.addEventListener('focusout', function (event) {
        if (!isEditable(event.target)) return;
        if (blurFrame) window.cancelAnimationFrame(blurFrame);
        blurFrame = window.requestAnimationFrame(function () {
            blurFrame = null;
            syncEditing();
        });
    });
    document.addEventListener('click', function (event) {
        var trigger = event.target.closest && event.target.closest('[data-pwa-keyboard-help]');
        if (trigger) openHelp(trigger);
    });
    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && help && !help.hidden) closeHelp();
    });
    document.addEventListener('detectlab:langchange', refreshHelp);
    window.addEventListener('pageshow', syncEditing);
    document.addEventListener('visibilitychange', function () {
        if (!document.hidden) syncEditing();
    });
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', function () {
            publishViewport();
            if (activeField()) scheduleReveal();
        });
        window.visualViewport.addEventListener('scroll', publishViewport);
    }
    refreshHelp();

    window.DLPwaKeyboard = {
        isIOS: isIOS,
        isPWA: isPWA,
        isEditable: isEditable,
        openHelp: openHelp,
        closeHelp: closeHelp
    };
}());
