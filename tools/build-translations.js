// Multilingual European Translation Builder for DetectLab
const fs = require('fs');
const path = require('path');

const transPath = path.join(__dirname, '../js/translations.js');
const rawCode = fs.readFileSync(transPath, 'utf8');

// Parse EN and RO keys
const parseDict = (code, lang) => {
    const re = new RegExp(lang + ':\\s*\\{([\\s\\S]*?)\\n\\s*\\},');
    const m = code.match(re);
    if (!m) return {};
    const dict = {};
    const entryRe = /([a-zA-Z0-9_]+):\s*(["\x27])((?:\\.|(?!\2)[^\\])*)\2/g;
    let em;
    while ((em = entryRe.exec(m[1])) !== null) {
        dict[em[1]] = em[3];
    }
    return dict;
};

const enDict = parseDict(rawCode, 'en');
const roDict = parseDict(rawCode, 'ro');

console.log(`Loaded ${Object.keys(enDict).length} EN keys and ${Object.keys(roDict).length} RO keys.`);

// Export as JSON for processing
fs.writeFileSync(path.join(__dirname, 'en.json'), JSON.stringify(enDict, null, 2));
fs.writeFileSync(path.join(__dirname, 'ro.json'), JSON.stringify(roDict, null, 2));
