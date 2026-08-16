import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAliases, classifyLocationMention, LOCATION_ROLES } from '../src/services/evidence/engine.js';

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
