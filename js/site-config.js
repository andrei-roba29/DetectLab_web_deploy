/* DetectLab domain/market configuration.
 *
 * The same Netlify deployment serves two first-class origins:
 *   - detectlab.ro: Romanian market, Romanian default language
 *   - detectlab.eu: European market, English default language
 *
 * A language selected by the visitor always wins. localStorage is scoped by
 * origin, so choosing a language on one domain does not unexpectedly change
 * the other domain.
 */
(function (root, document) {
    'use strict';

    function normalizedHost(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/\.$/, '')
            .replace(/^www\./, '');
    }

    var host = normalizedHost(root.location && root.location.hostname);
    var market = host === 'detectlab.eu' ? 'eu' : 'ro';
    var domain = market === 'eu' ? 'detectlab.eu' : 'detectlab.ro';
    var defaultLanguage = market === 'eu' ? 'en' : 'ro';
    var contactEmail = 'contact@' + domain;
    var canonicalOrigin = 'https://' + domain;

    function normalizePath(pathname) {
        var path = String(pathname || '/');
        if (!path || path === '/index.html') return '/';
        return path.charAt(0) === '/' ? path : '/' + path;
    }

    function languagePath(pathname, language) {
        var path = normalizePath(pathname);
        var pairs = {
            '/tehnologie.html': { ro: '/tehnologie.html', en: '/technology.html' },
            '/technology.html': { ro: '/tehnologie.html', en: '/technology.html' },
            '/proces.html': { ro: '/proces.html', en: '/process.html' },
            '/process.html': { ro: '/proces.html', en: '/process.html' },
            '/informatii-utile.html': { ro: '/informatii-utile.html', en: '/useful-information.html' },
            '/useful-information.html': { ro: '/informatii-utile.html', en: '/useful-information.html' }
        };
        return pairs[path] ? pairs[path][language] : path;
    }

    function urlForLanguage(language, pathname) {
        var languageDomain = language === 'en' ? 'detectlab.eu' : 'detectlab.ro';
        return 'https://' + languageDomain + languagePath(pathname, language);
    }

    function interpolate(value) {
        return String(value == null ? '' : value)
            .replace(/\{\{site_domain\}\}/g, domain)
            .replace(/\{\{contact_email\}\}/g, contactEmail);
    }

    var config = {
        market: market,
        domain: domain,
        defaultLanguage: defaultLanguage,
        contactEmail: contactEmail,
        canonicalOrigin: canonicalOrigin,
        isEurope: market === 'eu',
        isRomania: market === 'ro',
        interpolate: interpolate,
        urlForLanguage: urlForLanguage
    };

    root.DetectLabSite = config;
    root._dlInterpolateSiteText = interpolate;

    // Set the right document language before first paint when no explicit
    // visitor preference exists. translations.js performs the full UI update.
    var initialLanguage = defaultLanguage;
    try {
        var stored = root.localStorage && root.localStorage.getItem('detectlab_lang');
        if (stored === 'ro' || stored === 'en') initialLanguage = stored;
    } catch (e) {
        // Storage can be blocked in private/restricted WebViews.
    }
    if (document && document.documentElement) {
        document.documentElement.lang = initialLanguage;
    }

    function applyDomainContent() {
        if (!document || !document.querySelectorAll) return;
        var pathname = root.location && root.location.pathname;
        var canonicalPath = normalizePath(pathname);

        document.querySelectorAll('[data-site-canonical]').forEach(function (element) {
            element.setAttribute('href', canonicalOrigin + canonicalPath);
        });
        document.querySelectorAll('[data-site-hreflang]').forEach(function (element) {
            var language = element.getAttribute('data-site-hreflang');
            if (language === 'x-default') language = 'en';
            element.setAttribute('href', urlForLanguage(language, pathname));
        });
        document.querySelectorAll('[data-site-domain]').forEach(function (element) {
            element.textContent = domain;
        });
        document.querySelectorAll('[data-site-contact]').forEach(function (element) {
            element.textContent = contactEmail;
            if (element.tagName && element.tagName.toLowerCase() === 'a') {
                element.setAttribute('href', 'mailto:' + contactEmail);
            }
        });
    }

    root._dlApplyDomainContent = applyDomainContent;
    if (document && document.readyState === 'loading' && document.addEventListener) {
        document.addEventListener('DOMContentLoaded', applyDomainContent);
    } else {
        applyDomainContent();
    }
}(window, document));
