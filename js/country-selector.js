/* DetectLab European country picker. The picker is deliberately independent from
 * the data layers: it gives the map a clear geographic entry point before a
 * country is chosen, then hands the selected ISO code to the layer panel. */
(function (window, L) {
    'use strict';
    if (!window || !L) return;

    var EUROPE = {
        AL:true, AT:true, BE:true, BG:true, HR:true, CY:true, CZ:true, DK:true,
        EE:true, FI:true, FR:true, DE:true, GR:true, HU:true, IE:true, IT:true,
        LV:true, LT:true, LU:true, MT:true, NL:true, PL:true, PT:true, RO:true,
        SK:true, SI:true, ES:true, SE:true, GB:true, IS:true, NO:true, CH:true,
        LI:true, MC:true, SM:true, VA:true, AD:true, BA:true, RS:true, ME:true,
        XK:true, MK:true, AL:true, MD:true, UA:true, BY:true, TR:true, GE:true,
        AM:true, AZ:true, RU:true
    };
    var DATA_URL = 'https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson';
    var names = { RO:'România', DE:'Germania', FR:'Franța', IT:'Italia', ES:'Spania',
        PT:'Portugalia', GB:'Regatul Unit', GR:'Grecia', BG:'Bulgaria', HU:'Ungaria',
        AT:'Austria', PL:'Polonia', CZ:'Cehia', SK:'Slovacia', HR:'Croația',
        NL:'Țările de Jos', BE:'Belgia', CH:'Elveția', NO:'Norvegia', SE:'Suedia',
        FI:'Finlanda', DK:'Danemarca', IE:'Irlanda', UA:'Ucraina', TR:'Turcia' };

    function code(p) {
        p = p || {};
        return String(p.ISO_A2 || p.iso_a2 || p.ISO2 || p.iso2 || p.ISO_A3 || '').toUpperCase();
    }
    function countryName(p, c) { return names[c] || p.ADMIN || p.name || p.NAME || c; }

    window.DetectLabCountrySelector = {
        init: function (map) {
            if (!map || !L.geoJSON) return;
            var selected = null, hovered = null, layer;
            var pane = map.createPane('pane_country_picker');
            pane.style.zIndex = 650;
            pane.style.pointerEvents = 'auto';

            function style(feature) {
                var c = code(feature.properties);
                return { pane:'pane_country_picker', color: c === selected ? '#b9ff00' : '#d78cff',
                    weight: c === selected ? 2.8 : 1.25, opacity: c === selected ? 1 : .9,
                    fillColor: c === selected || c === hovered ? '#76ff00' : '#9d55c9',
                    fillOpacity: c === selected || c === hovered ? .34 : .22 };
            }
            function refresh() { if (layer) layer.setStyle(style); }
            function select(feature, target) {
                var c = code(feature.properties);
                if (!EUROPE[c]) return;
                selected = c; refresh();
                target && target.bringToFront();
                map.fitBounds(target.getBounds(), { padding:[28,28], maxZoom:7, animate:true });
                document.documentElement.classList.add('country-selected');
                document.body && document.body.classList.add('country-selected');
                window._detectlabSelectedCountry = c;
                window._detectlabSelectedCountryName = countryName(feature.properties, c);
                if (typeof window.filterLayersForCountry === 'function') window.filterLayersForCountry(c);
                var event = new CustomEvent('detectlab:country-selected', { detail:{ iso:c, name:window._detectlabSelectedCountryName } });
                document.dispatchEvent(event);
            }
            fetch(DATA_URL).then(function (r) { if (!r.ok) throw Error('country data'); return r.json(); })
                .then(function (data) {
                    var features = (data.features || []).filter(function (f) { return EUROPE[code(f.properties)]; });
                    layer = L.geoJSON({ type:'FeatureCollection', features:features }, {
                        pane:'pane_country_picker', style:style,
                        onEachFeature:function (feature, target) {
                            var c = code(feature.properties);
                            target.bindTooltip(countryName(feature.properties, c), { sticky:true, className:'country-picker-tooltip' });
                            target.on({ mouseover:function () { hovered=c; refresh(); target.bringToFront(); },
                                mouseout:function () { hovered=null; refresh(); }, click:function () { select(feature, target); } });
                        }
                    }).addTo(map);
                    window._detectlabCountryLayer = layer;
                }).catch(function (e) { console.warn('[DetectLab] European country picker unavailable', e); });
        }
    };
})(window, window.L);
