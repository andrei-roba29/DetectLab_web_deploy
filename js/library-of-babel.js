/* DetectLab Premium — Library of Babel multi-source archaeological research.
 * The browser queries public knowledge APIs independently: one failed source
 * never prevents the other sources from being displayed.
 */
(function () {
    'use strict';

    var MIN_ZOOM = 12;
    var lastSearch = null;
    var running = false;
    var lastNominatimAt = 0;

    var copy = {
        en: {
            title: 'Library of Babel', subtitle: 'Seven sources · one archaeological search',
            search: 'Search here', zoom: 'Zoom in more', locating: 'Finding nearest town…',
            searching: 'Searching seven archives for {place}…', results: 'Research near {place}',
            stats: '{results} results · {active}/7 sources active', noResults: 'No archaeological information was found. Try a nearby town or a broader period.',
            failed: 'The search could not start. Please try again.', close: 'Close', allTypes: 'All types',
            allPeriods: 'All periods', articles: 'Articles', images: 'Images', documents: 'Documents', data: 'Structured data',
            periodAny: 'All periods', prehistoric: 'Prehistory', dacian: 'Dacian / Getic', roman: 'Roman', medieval: 'Medieval',
            expand: 'Expand', collapse: 'Collapse', score: 'Relevance', source: 'Source', exportJson: 'Export JSON', exportCsv: 'Export CSV',
            ambiguous: 'Possible locality matches', categories: ['General archaeology','Prehistory','Dacian / Geto-Dacian','Roman','Medieval','Artefacts / coins / hoards','Fortifications / roads / infrastructure','Reports / research / heritage'],
            sourceUnavailable: 'Unavailable this time'
        },
        ro: {
            title: 'Biblioteca din Babel', subtitle: 'Șapte surse · o singură căutare arheologică',
            search: 'Caută aici', zoom: 'Zoom in mai mult', locating: 'Se caută localitatea cea mai apropiată…',
            searching: 'Se caută în șapte arhive pentru {place}…', results: 'Cercetare în apropiere de {place}',
            stats: '{results} rezultate · {active}/7 surse active', noResults: 'Nu au fost găsite informații arheologice. Încearcă o localitate apropiată sau o perioadă mai largă.',
            failed: 'Căutarea nu a putut porni. Încearcă din nou.', close: 'Închide', allTypes: 'Toate tipurile',
            allPeriods: 'Toate perioadele', articles: 'Articole', images: 'Imagini', documents: 'Documente', data: 'Date structurate',
            periodAny: 'Toate perioadele', prehistoric: 'Preistorie', dacian: 'Dacic / getic', roman: 'Roman', medieval: 'Medieval',
            expand: 'Extinde', collapse: 'Restrânge', score: 'Relevanță', source: 'Sursă', exportJson: 'Exportă JSON', exportCsv: 'Exportă CSV',
            ambiguous: 'Localități posibile', categories: ['General arheologic','Preistorie','Dacic / geto-dacic','Roman','Medieval','Artefacte / monede / tezaure','Fortificații / drumuri / infrastructură','Rapoarte / cercetări / patrimoniu'],
            sourceUnavailable: 'Indisponibilă momentan'
        }
    };

    var categoryTerms = [
        ['archaeolog','arheolog','heritage','patrimoni','ancient','antic','vestig','excavat','săpătur'],
        ['prehistor','paleolit','mesolit','mezolit','neolit','eneolit','bronze age','epoca bronzului','iron age','hallstatt','la tène','cucuteni','gumelni','wietenberg'],
        ['daci','dacian','getic','geto','dava','sarmizegetusa','oppidum'],
        ['roman','romano','dacia','moesia','castr','castellum','burgus','vicus','legion','imperi','terra sigillata','denar','limes'],
        ['medieval','evul mediu','middle ages','byzant','bizantin','castle','castel','monastery','mănăstir','church','biseric'],
        ['artefact','artifact','coin','moned','hoard','tezaur','ceramic','pottery','fibul','inscrip','jewellery','bijut','weapon','armă','mormânt','necropol'],
        ['fort','cetate','road','drum','bridge','pod','wall','zid','limes','tower','turn','infrastructure','infrastruct','val de pământ','aqueduct','apeduct'],
        ['report','raport','research','cercet','registry','repertori','ran','lmi','monument','survey','perieghez','excavation','heritage','patrimoni']
    ];
    var archaeologyTerms = categoryTerms.reduce(function (all, terms) { return all.concat(terms); }, []);

    function lang() { return (typeof window._currentLang === 'function' && window._currentLang() === 'en') ? 'en' : 'ro'; }
    function t(key) { return copy[lang()][key] || key; }
    function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
    function strip(value) { var d = document.createElement('div'); d.innerHTML = String(value || ''); return (d.textContent || '').replace(/\s+/g, ' ').trim(); }
    function truncate(value, max) { value = strip(value); return value.length > max ? value.slice(0, max - 1).replace(/\s+\S*$/, '') + '…' : value; }
    function description(value, title, place) {
        var text = strip(value);
        if (text.length < 50) text = [text, title, '—', lang() === 'ro' ? 'resursă istorică asociată localității' : 'historical resource associated with', place].join(' ');
        return truncate(text, 150);
    }
    function safeUrl(value) { try { var u = new URL(value); return /^https?:$/.test(u.protocol) ? u.href : '#'; } catch (_) { return '#'; } }
    function fetchJson(url, options, timeout) {
        var controller = new AbortController();
        var timer = setTimeout(function () { controller.abort(); }, timeout || 12000);
        return fetch(url, Object.assign({}, options || {}, { signal: controller.signal })).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        }).finally(function () { clearTimeout(timer); });
    }
    function queryUrl(base, params) { var u = new URL(base); Object.keys(params).forEach(function (k) { u.searchParams.set(k, params[k]); }); return u.href; }

    function classify(result, place) {
        var haystack = (result.title + ' ' + result.description + ' ' + (result.fullText || '')).toLocaleLowerCase();
        var scores = categoryTerms.map(function (terms) {
            var hits = terms.reduce(function (n, term) { return n + (haystack.indexOf(term) !== -1 ? 1 : 0); }, 0);
            return Math.min(100, hits * 18 + (hits ? 22 : 0));
        });
        var archaeologicalHits = archaeologyTerms.reduce(function (n, term) { return n + (haystack.indexOf(term) !== -1 ? 1 : 0); }, 0);
        var localityBonus = haystack.indexOf(String(place).toLocaleLowerCase()) !== -1 ? 18 : 0;
        result.categoryScores = scores;
        result.relevance = Math.min(100, 18 + localityBonus + Math.min(64, archaeologicalHits * 7));
        result.period = scores[1] ? 'prehistoric' : scores[2] ? 'dacian' : scores[3] ? 'roman' : scores[4] ? 'medieval' : 'any';
        return result;
    }

    function normalise(raw, place) {
        var title = strip(raw.title) || (lang() === 'ro' ? 'Resursă fără titlu' : 'Untitled resource');
        var full = strip(raw.fullText || raw.description || '');
        return classify({
            title: title,
            description: description(raw.description || full, title, place),
            fullText: full || description('', title, place),
            type: raw.type || 'data', source: raw.source, url: safeUrl(raw.url), thumbnail: safeUrl(raw.thumbnail || ''),
            date: raw.date || ''
        }, place);
    }

    async function reverseLocality(center) {
        // Nominatim's public policy allows at most one request per second.
        var delay=Math.max(0,1000-(Date.now()-lastNominatimAt));
        if(delay) await new Promise(function(resolve){setTimeout(resolve,delay);});
        lastNominatimAt=Date.now();
        var url = queryUrl('https://nominatim.openstreetmap.org/reverse', { format: 'jsonv2', lat: center.lat, lon: center.lng, zoom: 10, addressdetails: 1, 'accept-language': lang() });
        var data = await fetchJson(url, { headers: { 'Accept-Language': lang() } }, 12000);
        var a = data.address || {};
        var name = a.city || a.town || a.village || a.municipality || a.hamlet || a.county || data.name;
        if (!name) throw new Error('No locality');
        return { name: name, displayName: data.display_name || name, raw: data };
    }

    function wikipedia(place) {
        var language = lang();
        var query = place + (language === 'ro' ? ' arheologie OR istorie OR cetate' : ' archaeology OR history OR fortress');
        var url = queryUrl('https://' + language + '.wikipedia.org/w/api.php', { action:'query', list:'search', srsearch:query, srlimit:8, srprop:'snippet|timestamp', format:'json', origin:'*' });
        return fetchJson(url).then(function (d) {
            var hits=d.query && d.query.search || [];
            if(!hits.length) return [];
            var detailsUrl=queryUrl('https://' + language + '.wikipedia.org/w/api.php', { action:'query', pageids:hits.map(function(x){return x.pageid;}).join('|'), prop:'extracts|pageimages', exintro:1, explaintext:1, exchars:1200, piprop:'thumbnail', pithumbsize:320, format:'json', origin:'*' });
            return fetchJson(detailsUrl).then(function(details){var pages=details.query && details.query.pages || {};return hits.map(function(x){var p=pages[x.pageid] || {}, full=strip(p.extract || x.snippet);return { title:x.title, description:full, fullText:full, type:'article', source:'Wikipedia', url:'https://' + language + '.wikipedia.org/wiki/' + encodeURIComponent(x.title.replace(/ /g, '_')), thumbnail:p.thumbnail && p.thumbnail.source, date:x.timestamp };});});
        });
    }

    function wikidata(place) {
        var language = lang();
        var sparql = 'SELECT DISTINCT ?item ?itemLabel ?itemDescription ?typeLabel WHERE {' +
            ' SERVICE wikibase:mwapi { bd:serviceParam wikibase:endpoint "www.wikidata.org"; wikibase:api "EntitySearch"; mwapi:search ' + JSON.stringify(place + ' archaeology') + '; mwapi:language "' + language + '". ?item wikibase:apiOutputItem mwapi:item. }' +
            ' OPTIONAL { ?item wdt:P31 ?type. } SERVICE wikibase:label { bd:serviceParam wikibase:language "' + language + ',en". } } LIMIT 8';
        var url = queryUrl('https://query.wikidata.org/sparql', { query:sparql, format:'json' });
        return fetchJson(url, { headers:{ Accept:'application/sparql-results+json' } }, 16000).then(function (d) { return (d.results.bindings || []).map(function (x) {
            return { title:x.itemLabel && x.itemLabel.value, description:(x.itemDescription && x.itemDescription.value) || (x.typeLabel && x.typeLabel.value), fullText:[x.itemDescription && x.itemDescription.value, x.typeLabel && x.typeLabel.value].filter(Boolean).join('. '), type:'data', source:'Wikidata', url:x.item.value };
        }); });
    }

    function commons(place) {
        var query = place + ' archaeology';
        var url = queryUrl('https://commons.wikimedia.org/w/api.php', { action:'query', generator:'search', gsrsearch:query, gsrnamespace:6, gsrlimit:8, prop:'imageinfo', iiprop:'url|extmetadata', iiurlwidth:320, format:'json', origin:'*' });
        return fetchJson(url).then(function (d) { return Object.keys(d.query && d.query.pages || {}).map(function (k) {
            var p=d.query.pages[k], i=p.imageinfo && p.imageinfo[0] || {}, m=i.extmetadata || {};
            return { title:(p.title || '').replace(/^File:/, ''), description:strip((m.ImageDescription && m.ImageDescription.value) || (m.ObjectName && m.ObjectName.value)), fullText:strip((m.ImageDescription && m.ImageDescription.value) || ''), type:'image', source:'Wikimedia Commons', url:i.descriptionurl || i.url, thumbnail:i.thumburl || i.url };
        }); });
    }

    function dbpedia(place) {
        var language=lang(), q='SELECT DISTINCT ?s ?label ?abstract WHERE { ?s rdfs:label ?label. OPTIONAL {?s dbo:abstract ?abstract. FILTER(lang(?abstract)="' + language + '" || lang(?abstract)="en")} FILTER(lang(?label)="' + language + '" || lang(?label)="en") FILTER(CONTAINS(LCASE(STR(?label)), LCASE(' + JSON.stringify(place) + '))) } LIMIT 8';
        return fetchJson(queryUrl('https://dbpedia.org/sparql', { query:q, format:'application/sparql-results+json' }), { headers:{Accept:'application/sparql-results+json'} }, 16000).then(function(d){ return (d.results.bindings || []).map(function(x){
            return { title:x.label.value, description:x.abstract && x.abstract.value, fullText:x.abstract && x.abstract.value, type:'data', source:'DBpedia', url:x.s.value };
        }); });
    }

    function archiveOrg(place) {
        var q='title:("' + place.replace(/["()]/g, '') + '") AND (archaeology OR archaeological OR history OR arheologie OR istorie)';
        return fetchJson(queryUrl('https://archive.org/advancedsearch.php', { q:q, fl:'identifier,title,description,date,mediatype', rows:8, page:1, output:'json' }), {}, 16000).then(function(d){ return (d.response.docs || []).map(function(x){
            return { title:x.title, description:Array.isArray(x.description)?x.description[0]:x.description, fullText:Array.isArray(x.description)?x.description.join(' '):x.description, type:'document', source:'Archive.org', url:'https://archive.org/details/' + encodeURIComponent(x.identifier), date:x.date };
        }); });
    }

    function europeana(place) {
        var key=window.EUROPEANA_API_KEY || '';
        if (!key) return Promise.reject(new Error('Europeana API key not configured'));
        return fetchJson(queryUrl('https://api.europeana.eu/record/v2/search.json', { wskey:key, query:place + ' archaeology', rows:8, profile:'rich' }), {}, 16000).then(function(d){ return (d.items || []).map(function(x){
            var title=Array.isArray(x.title)?x.title[0]:x.title, desc=Array.isArray(x.dcDescription)?x.dcDescription[0]:x.dcDescription;
            return { title:title, description:desc, fullText:desc, type:(x.type==='IMAGE'?'image':'document'), source:'Europeana', url:x.guid, thumbnail:x.edmPreview && x.edmPreview[0] };
        }); });
    }

    function osmResult(locality) {
        var d=locality.raw;
        return [{ title:locality.name, description:d.display_name, fullText:d.display_name, type:'map', source:'OpenStreetMap Nominatim', url:'https://www.openstreetmap.org/' + (d.osm_type || 'node') + '/' + d.osm_id }];
    }

    function dedupe(results, place) {
        var seen={};
        return results.map(function(x){return normalise(x, place);}).filter(function(x){
            var key=x.title.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
            if (!key || seen[key]) return false; seen[key]=true; return true;
        }).sort(function(a,b){return b.relevance-a.relevance;});
    }

    function isPremium() {
        if (typeof window._dlIsPremium === 'function') return window._dlIsPremium();
        var u=typeof window._authUser === 'function' ? window._authUser() : null;
        return !!(u && u.plan==='premium' && u.premiumExpiresAt && new Date(u.premiumExpiresAt).getTime()>Date.now());
    }

    function updateButton() {
        var btn=document.getElementById('babelSearchBtn'), map=window._dlMap;
        if (!btn) return;
        var enough=!!(map && map.getZoom()>=MIN_ZOOM);
        btn.disabled=!enough || running;
        btn.textContent=running ? '…' : (enough?t('search'):t('zoom'));
        btn.setAttribute('aria-label', btn.textContent);
    }

    function openModal() { var m=document.getElementById('babelModal'); if(m){m.hidden=false;document.body.classList.add('babel-modal-open');document.getElementById('babelClose').focus();} }
    function closeModal() { var m=document.getElementById('babelModal'); if(m){m.hidden=true;document.body.classList.remove('babel-modal-open');} }

    function status(text, loading) {
        openModal();
        var body=document.getElementById('babelBody');
        body.innerHTML='<div class="babel-state' + (loading?' is-loading':'') + '"><span class="babel-orbit" aria-hidden="true"></span><p>' + esc(text) + '</p></div>';
    }

    async function search() {
        var map=window._dlMap;
        if (!map || map.getZoom()<MIN_ZOOM || running) { updateButton(); return; }
        if (!isPremium()) { if(typeof window.openPremiumModal==='function') window.openPremiumModal(); return; }
        running=true; updateButton(); status(t('locating'), true);
        try {
            var locality=await reverseLocality(map.getCenter());
            status(t('searching').replace('{place}', locality.name), true);
            var jobs=[Promise.resolve(osmResult(locality)), wikipedia(locality.name), wikidata(locality.name), commons(locality.name), dbpedia(locality.name), archiveOrg(locality.name), europeana(locality.name)];
            var settled=await Promise.allSettled(jobs), raw=[], active=0, sourceStates=[];
            settled.forEach(function(x,i){ var source=['OpenStreetMap','Wikipedia','Wikidata','Wikimedia Commons','DBpedia','Archive.org','Europeana'][i]; if(x.status==='fulfilled'){active++;raw=raw.concat(x.value);sourceStates.push({source:source,active:true});}else{sourceStates.push({source:source,active:false});} });
            lastSearch={ place:locality.name, displayName:locality.displayName, coordinates:map.getCenter(), results:dedupe(raw,locality.name), activeSources:active, sourceStates:sourceStates, searchedAt:new Date().toISOString() };
            render();
        } catch(e) { console.warn('[Library of Babel]',e); status(t('failed'),false); }
        finally { running=false;updateButton(); }
    }

    function selectedResults() {
        if(!lastSearch) return [];
        var type=document.getElementById('babelTypeFilter').value, period=document.getElementById('babelPeriodFilter').value;
        return lastSearch.results.filter(function(r){
            var typeOk=type==='all' || (type==='article'&&r.type==='article') || (type==='image'&&r.type==='image') || (type==='document'&&(r.type==='document'||r.type==='map')) || (type==='data'&&r.type==='data');
            return typeOk && (period==='any' || r.period===period || (r.categoryScores[{prehistoric:1,dacian:2,roman:3,medieval:4}[period]]||0)>0);
        });
    }

    function resultHtml(r,index) {
        var scores=r.categoryScores.map(function(score,i){return '<li class="babel-score' + (score?' has-score':'') + '"><span>' + esc(t('categories')[i]) + '</span><b>' + score + '%</b></li>';}).join('');
        var thumb=r.thumbnail && r.thumbnail!=='#' ? '<img src="'+esc(r.thumbnail)+'" alt="" loading="lazy">' : '';
        return '<article class="babel-result" data-index="'+index+'">'+thumb+'<div class="babel-result-main"><div class="babel-result-top"><span class="babel-source">'+esc(r.source)+'</span><span class="babel-relevance">'+esc(t('score'))+' '+r.relevance+'%</span></div><h3><a href="'+esc(r.url)+'" target="_blank" rel="noopener noreferrer">'+esc(r.title)+'</a></h3><p class="babel-brief">'+esc(r.description)+'</p><div class="babel-full" hidden><p>'+esc(r.fullText)+'</p><ul>'+scores+'</ul></div><button class="babel-expand" type="button" data-expand="'+index+'">… '+esc(t('expand'))+'</button></div></article>';
    }

    function renderList() {
        var list=document.getElementById('babelResults'), results=selectedResults();
        list.innerHTML=results.length ? results.map(resultHtml).join('') : '<div class="babel-empty">'+esc(t('noResults'))+'</div>';
        list.querySelectorAll('[data-expand]').forEach(function(btn){btn.onclick=function(){var full=btn.parentNode.querySelector('.babel-full'), opening=full.hidden;full.hidden=!opening;btn.textContent=opening?t('collapse'):'… '+t('expand');};});
        document.getElementById('babelStats').textContent=t('stats').replace('{results}',results.length).replace('{active}',lastSearch.activeSources);
    }

    function render() {
        openModal(); var unavailable=lastSearch.sourceStates.filter(function(s){return !s.active;}).map(function(s){return s.source;});
        var categoryOverview=t('categories').map(function(name,i){var values=lastSearch.results.map(function(r){return r.categoryScores[i]||0;}), score=values.length?Math.round(values.reduce(function(a,b){return a+b;},0)/values.length):0, matches=values.filter(function(v){return v>0;}).length;return '<div class="babel-category-card"><span>'+esc(name)+'</span><b>'+score+'%</b><small>'+matches+' '+(lang()==='ro'?'rezultate':'results')+'</small></div>';}).join('');
        document.getElementById('babelBody').innerHTML='<header class="babel-results-head"><div><span class="babel-kicker">'+esc(lastSearch.displayName)+'</span><h2>'+esc(t('results').replace('{place}',lastSearch.place))+'</h2><p id="babelStats"></p></div></header><div class="babel-category-grid">'+categoryOverview+'</div><div class="babel-toolbar"><label><span>'+esc(t('allTypes'))+'</span><select id="babelTypeFilter"><option value="all">'+esc(t('allTypes'))+'</option><option value="article">'+esc(t('articles'))+'</option><option value="image">'+esc(t('images'))+'</option><option value="document">'+esc(t('documents'))+'</option><option value="data">'+esc(t('data'))+'</option></select></label><label><span>'+esc(t('allPeriods'))+'</span><select id="babelPeriodFilter"><option value="any">'+esc(t('periodAny'))+'</option><option value="prehistoric">'+esc(t('prehistoric'))+'</option><option value="dacian">'+esc(t('dacian'))+'</option><option value="roman">'+esc(t('roman'))+'</option><option value="medieval">'+esc(t('medieval'))+'</option></select></label><button id="babelJson">'+esc(t('exportJson'))+'</button><button id="babelCsv">'+esc(t('exportCsv'))+'</button></div>'+(unavailable.length?'<p class="babel-source-warning">'+esc(t('sourceUnavailable'))+': '+esc(unavailable.join(', '))+'</p>':'')+'<section id="babelResults" class="babel-results"></section>';
        document.getElementById('babelTypeFilter').onchange=renderList; document.getElementById('babelPeriodFilter').onchange=renderList;
        document.getElementById('babelJson').onclick=function(){download('detectlab-babel-'+slug(lastSearch.place)+'.json',JSON.stringify(Object.assign({},lastSearch,{results:selectedResults()}),null,2),'application/json');};
        document.getElementById('babelCsv').onclick=function(){var rows=[['title','description','type','source','relevance','url']].concat(selectedResults().map(function(r){return [r.title,r.description,r.type,r.source,r.relevance,r.url];}));download('detectlab-babel-'+slug(lastSearch.place)+'.csv',rows.map(function(row){return row.map(function(v){return '"'+String(v).replace(/"/g,'""')+'"';}).join(',');}).join('\n'),'text/csv');};
        renderList();
    }

    function slug(s){return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');}
    function download(name,content,type){var a=document.createElement('a'),u=URL.createObjectURL(new Blob([content],{type:type+';charset=utf-8'}));a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(u);},1000);}

    function applyLanguage(){var title=document.getElementById('babelModalTitle'),sub=document.getElementById('babelScrollSubtitle'),close=document.getElementById('babelClose');if(title)title.textContent=t('title');if(sub)sub.textContent=t('subtitle');if(close)close.setAttribute('aria-label',t('close'));updateButton();}

    function init(){
        var btn=document.getElementById('babelSearchBtn'), close=document.getElementById('babelClose'), modal=document.getElementById('babelModal');
        if(!btn||!modal)return; btn.onclick=search; close.onclick=closeModal; modal.addEventListener('click',function(e){if(e.target===modal)closeModal();});document.addEventListener('keydown',function(e){if(e.key==='Escape'&&!modal.hidden)closeModal();});
        var wait=setInterval(function(){if(window._dlMap){clearInterval(wait);window._dlMap.on('zoomend',updateButton);updateButton();}},100);setTimeout(function(){clearInterval(wait);updateButton();},15000);
        var original=window.setLang;if(typeof original==='function'){window.setLang=function(language){original(language);applyLanguage();if(lastSearch&&!modal.hidden)render();};}
        applyLanguage();
    }
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
    window.LibraryOfBabel={search:search,close:closeModal,refresh:updateButton};
})();
