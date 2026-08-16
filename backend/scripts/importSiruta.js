#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pool, withTransaction } from '../src/config/db.js';

const OFFICIAL_URL = process.env.SIRUTA_URL || 'https://data.gov.ro/dataset/fcba1a54-cffd-422c-b3ac-920f63564085/resource/0ab29d86-302c-4cfa-b9b9-fd5c7ff90710/download/siruta_s1_2025.csv';
const VERSION = process.env.SIRUTA_VERSION || 'S1 2025';
const curatedAliases = [
  ['Cluj','Cluj-Napoca','Kolozsvár','HUNGARIAN','hu'],['Cluj','Cluj-Napoca','Klausenburg','GERMAN','de'],['Cluj','Cluj-Napoca','Napoca','HISTORICAL','la'],
  ['Alba','Alba Iulia','Gyulafehérvár','HUNGARIAN','hu'],['Alba','Alba Iulia','Karlsburg','GERMAN','de'],['Alba','Alba Iulia','Apulum','LATIN','la'],
  ['Bihor','Oradea','Nagyvárad','HUNGARIAN','hu'],['Bihor','Oradea','Großwardein','GERMAN','de'],
  ['Sibiu','Sibiu','Nagyszeben','HUNGARIAN','hu'],['Sibiu','Sibiu','Hermannstadt','GERMAN','de'],
  ['Brașov','Brașov','Brassó','HUNGARIAN','hu'],['Brașov','Brașov','Kronstadt','GERMAN','de'],
  ['Timiș','Timișoara','Temesvár','HUNGARIAN','hu'],['Timiș','Timișoara','Temeschwar','GERMAN','de'],
  ['Satu Mare','Carei','Nagykároly','HUNGARIAN','hu']
];
const pilot = new Set([
  'Alba|Alba Iulia','Arad|Arad','Argeș|Curtea de Argeș','Bacău|Bacău','Bihor|Oradea','Bistrița-Năsăud|Bistrița','Brașov|Brașov','București|București','Cluj|Apahida','Cluj|Cluj-Napoca','Cluj|Turda','Constanța|Constanța','Constanța|Istria','Dolj|Craiova','Gorj|Târgu Jiu','Hunedoara|Deva','Hunedoara|Sarmizegetusa','Iași|Iași','Maramureș|Baia Mare','Maramureș|Sighetu Marmației','Mehedinți|Drobeta-Turnu Severin','Mureș|Târgu Mureș','Neamț|Piatra-Neamț','Prahova|Ploiești','Satu Mare|Carei','Sălaj|Zalău','Sibiu|Sibiu','Suceava|Suceava','Timiș|Timișoara','Tulcea|Tulcea'
].map(normalize));

function normalize(v) { return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[șş]/gi,'s').replace(/[țţ]/gi,'t').toLowerCase().trim(); }
function parseCsv(text) {
  const delimiter = (text.split(/\r?\n/, 1)[0].match(/;/g) || []).length > (text.split(/\r?\n/, 1)[0].match(/,/g) || []).length ? ';' : ',';
  const rows=[]; let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(c===delimiter&&!quoted){row.push(cell);cell='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(Boolean))rows.push(row);row=[];cell='';}else cell+=c;} if(cell||row.length){row.push(cell);rows.push(row);} return rows;
}
function pick(record, names) { for (const name of names) if (record[name] != null && record[name] !== '') return record[name]; return null; }
function localityType(tip) { return ({'1':'municipiu','2':'oraș','3':'comună','6':'sector','9':'localitate componentă reședință municipiu','10':'localitate componentă municipiu','11':'sat aparținător municipiu','17':'localitate componentă reședință oraș','18':'localitate componentă oraș','22':'sat reședință comună','23':'sat component comună'})[String(tip)] || String(tip || 'necunoscut'); }

async function acquire() {
  const supplied = process.argv[2];
  if (supplied) return { file: supplied, temporary: false };
  const file = path.join(os.tmpdir(), `detectlab-siruta-${process.pid}.csv`);
  const response = await fetch(OFFICIAL_URL, { headers: { 'User-Agent': 'DetectLab-SIRUTA-Importer/1.0' } });
  if (!response.ok) throw new Error(`SIRUTA download failed: HTTP ${response.status}`);
  await fs.writeFile(file, Buffer.from(await response.arrayBuffer()));
  return { file, temporary: true };
}

const source = await acquire();
try {
  const raw = await fs.readFile(source.file);
  let decoded = new TextDecoder('utf-8').decode(raw);
  if ((decoded.match(/�/g)||[]).length > 5) decoded = new TextDecoder('windows-1250').decode(raw);
  const rows = parseCsv(decoded.replace(/^\uFEFF/,''));
  const headers = rows.shift().map((h)=>h.trim().toUpperCase());
  const records = rows.map((values)=>Object.fromEntries(headers.map((h,i)=>[h,(values[i]||'').trim()])));
  const nodes = new Map(records.map((r)=>[String(pick(r,['SIRUTA','COD_SIRUTA','COD'])||''),r]));
  function ancestor(record, wantedLevel) { let current=record,guard=0; while(current&&guard++<8){if(Number(pick(current,['NIV','NIVEL']))===wantedLevel)return current;current=nodes.get(String(pick(current,['SIRSUP','PARINTE','COD_SUP'])||''));} return null; }
  const prepared = records.map((r)=>{
    const level=Number(pick(r,['NIV','NIVEL'])||0), countyNode=ancestor(r,1),uatNode=ancestor(r,2);
    const name=pick(r,['DENLOC','DENUMIRE','NUME']); const county=pick(r,['DENJUD','JUDET'])||pick(countyNode||{},['DENLOC','DENUMIRE','NUME']);
    return {siruta:String(pick(r,['SIRUTA','COD_SIRUTA','COD'])||''),name,normalized:normalize(name),countyCode:pick(r,['CODJUD','JUD']),county,parent:String(pick(r,['SIRSUP','PARINTE','COD_SUP'])||'')||null,uat:pick(uatNode||{},['DENLOC','DENUMIRE','NUME']),type:localityType(pick(r,['TIP','TIP_LOCALITATE'])),level,lat:Number(pick(r,['LAT','LATITUDINE']))||null,lon:Number(pick(r,['LON','LONG','LONGITUDINE']))||null,pilot:pilot.has(`${normalize(county)}|${normalize(name)}`)};
  }).filter((r)=>r.siruta&&r.name&&r.county&&r.level>=2);
  await withTransaction(async(client)=>{
    for(let i=0;i<prepared.length;i+=500){const batch=prepared.slice(i,i+500);await client.query(`INSERT INTO knowledge.localities(siruta_code,name,normalized_name,county_code,county,parent_siruta_code,uat_name,locality_type,level,latitude,longitude,source_version,source_url,pilot)
      SELECT x.siruta,x.name,x.normalized,x."countyCode",x.county,x.parent,x.uat,x.type,x.level,x.lat,x.lon,$2,$3,x.pilot FROM jsonb_to_recordset($1::jsonb) x(siruta text,name text,normalized text,"countyCode" text,county text,parent text,uat text,type text,level smallint,lat double precision,lon double precision,pilot boolean)
      ON CONFLICT(siruta_code) DO UPDATE SET name=EXCLUDED.name,normalized_name=EXCLUDED.normalized_name,county=EXCLUDED.county,uat_name=EXCLUDED.uat_name,locality_type=EXCLUDED.locality_type,level=EXCLUDED.level,latitude=COALESCE(EXCLUDED.latitude,knowledge.localities.latitude),longitude=COALESCE(EXCLUDED.longitude,knowledge.localities.longitude),source_version=EXCLUDED.source_version,source_url=EXCLUDED.source_url,pilot=EXCLUDED.pilot,updated_at=now()`,[JSON.stringify(batch),VERSION,OFFICIAL_URL]);}
    await client.query(`INSERT INTO knowledge.locality_aliases(locality_id,alias,normalized_alias,alias_type,source,verified) SELECT id,name,normalized_name,'CURRENT',$1,TRUE FROM knowledge.localities ON CONFLICT DO NOTHING`,[`${VERSION} / INS`]);
    for (const [county,name,alias,type,language] of curatedAliases) await client.query(`INSERT INTO knowledge.locality_aliases(locality_id,alias,normalized_alias,alias_type,language,source,verified) SELECT id,$3,$4,$5,$6,'DetectLab pilot curation — human verification required',FALSE FROM knowledge.localities WHERE lower(county)=lower($1) AND normalized_name=$2 ON CONFLICT DO NOTHING`,[county,normalize(name),alias,normalize(alias),type,language]);
  });
  const counts=await pool.query(`SELECT count(*)::int total,count(*) FILTER(WHERE pilot)::int pilot FROM knowledge.localities`);
  console.log(JSON.stringify({source:OFFICIAL_URL,version:VERSION,...counts.rows[0]},null,2));
} finally { if(source.temporary) await fs.rm(source.file,{force:true}); await pool.end(); }
