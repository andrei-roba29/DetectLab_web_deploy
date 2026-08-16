import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAliases, classifyLocationMention, extractClaims, LOCATION_ROLES } from '../src/services/evidence/engine.js';

test('aliases preserve the source spelling and deduplicate diacritic variants', () => {
  assert.deepEqual(buildAliases('Șimleu Silvaniei', ['Simleu Silvaniei', 'Szilágysomlyó']), ['Șimleu Silvaniei', 'Szilágysomlyó']);
});

test('classifies the archaeological target rather than a university location', () => {
  const sentence = 'Cercetările au fost efectuate de Universitatea Babeș-Bolyai din Cluj-Napoca. În castrul de la Porolissum au fost descoperite fragmente ceramice.';
  const porolissum = classifyLocationMention(sentence, 'Porolissum', { title: 'Cercetări arheologice la Porolissum', descriptors: ['Porolissum (loc geografic)'] });
  const cluj = classifyLocationMention(sentence, 'Cluj-Napoca');
  assert.equal(porolissum.role, 'FINDSPOT');
  assert.ok(porolissum.score >= 0.75);
  assert.equal(cluj.role, 'AUTHOR_AFFILIATION');
  assert.equal(cluj.score, 0);
});

test('separates an artefact findspot from its collection repository', () => {
  const sentence = 'O fibulă romană descoperită la Alba Iulia se află în colecția muzeului din Cluj-Napoca.';
  assert.equal(classifyLocationMention(sentence, 'Alba Iulia').role, 'FINDSPOT');
  assert.equal(classifyLocationMention(sentence, 'Cluj-Napoca').role, 'COLLECTION_LOCATION');
});

test('only emits role names from the required controlled vocabulary', () => {
  const result = classifyLocationMention('Menționare fără context arheologic la Apahida.', 'Apahida');
  assert.ok(LOCATION_ROLES.includes(result.role));
});

test('institution and collection mentions never become archaeological claims', () => {
  const document = { documentId:'1',title:'Cercetări la Porolissum',authors:[],year:1971,publication:'Test',volume:'I',url:'https://biblioteca-digitala.ro/?articol=1-test',pdfUrl:'https://biblioteca-digitala.ro/reviste/test.pdf',descriptors:[] };
  const pages = [{pdfPage:1,printedPage:'12',textChecksum:'abc',characterCount:190,text:'Cercetările au fost efectuate de Universitatea din Cluj-Napoca. Materialele descoperite la Porolissum sunt păstrate în colecția muzeului din Cluj-Napoca.',ocr:false}];
  assert.equal(extractClaims(document,pages,'Cluj-Napoca',['Cluj-Napoca'],'PDF_TEXT').length,0);
  assert.equal(extractClaims(document,pages,'Porolissum',['Porolissum'],'PDF_TEXT').length,1);
});

test('page identity and checksum travel with exact evidence', () => {
  const document = { documentId:'2',title:'Necropola de la Apahida',authors:[],year:1971,publication:'Test',volume:'I',url:'https://biblioteca-digitala.ro/?articol=2-test',pdfUrl:'https://biblioteca-digitala.ro/reviste/test2.pdf',descriptors:['Apahida (loc geografic)'] };
  const pages = [{pdfPage:4,printedPage:'40',textChecksum:'page-sha',characterCount:250,text:'În necropola de la Apahida au fost descoperite morminte de incinerație.',ocr:false}];
  const claim=extractClaims(document,pages,'Apahida',['Apahida'],'PDF_TEXT')[0];
  assert.equal(claim.evidence[0].pdfPage,4); assert.equal(claim.evidence[0].printedPage,'40'); assert.equal(claim.evidence[0].pageTextChecksum,'page-sha');
  assert.match(claim.evidence[0].excerpt,/Apahida/);
});
