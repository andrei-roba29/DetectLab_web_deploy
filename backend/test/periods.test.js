import test from 'node:test';
import assert from 'node:assert/strict';
import { periods, PERIOD_LABELS } from '../src/services/evidence/periods.js';

test('exposes the report canonical epoch taxonomy', () => {
  assert.deepEqual(PERIOD_LABELS, [
    'Paleolitic', 'Mezolitic', 'Eneolitic', 'Neolitic', 'Epoca bronzului',
    'Hallstatt', 'Epoca fierului', 'Dacic / getic', 'Roman',
    'Epoca migrațiilor', 'Medieval', 'Modern', 'Preistorie', 'Antichitate',
  ]);
});

test('classifies epoch names the same way as the Archaeological Report', () => {
  const cases = [
    ['așezare paleolitică', 'Paleolitic'],
    ['sit mezolitic', 'Mezolitic'],
    ['cultura Cucuteni', 'Eneolitic'], // eneolithic before neolithic
    ['Eneolitic', 'Eneolitic'],
    ['așezare neolitică', 'Neolitic'],
    ['epoca bronzului', 'Epoca bronzului'],
    ['Hallstatt', 'Hallstatt'],
    ['epoca fierului', 'Epoca fierului'],
    ['La Tène', 'Epoca fierului'],
    ['necropolă dacică', 'Dacic / getic'],
    ['castrul roman', 'Roman'],
    ['migrația popoarelor', 'Epoca migrațiilor'],
    ['așezare medievală', 'Medieval'],
    ['așezare modernă', 'Modern'],
    ['preistorie', 'Preistorie'],
    ['antichitate', 'Antichitate'],
  ];
  for (const [input, expected] of cases) {
    assert.deepEqual(periods(input), [expected], `${input} -> ${expected}`);
  }
});

test('century/millennium notation maps onto the same scale as the report', () => {
  const cases = [
    ['cercetări din sec. II-III p.Chr.', 'Roman'],
    ['satul este atestat în secolul al IV-lea', 'Epoca migrațiilor'],
    ['menționat în sec. XII-XIII', 'Medieval'],
    ['descoperiri din mileniul I î.Chr.', 'Epoca fierului'],
    ['așezare din sec. I î.Chr.', 'Dacic / getic'],
    ['cimitir din mileniul II î.Chr.', 'Epoca bronzului'],
  ];
  for (const [input, expected] of cases) {
    assert.deepEqual(periods(input), [expected], `${input} -> ${expected}`);
  }
});

test('returns empty when no epoch is detectable', () => {
  assert.deepEqual(periods('descoperiri în zona centrală'), []);
  assert.deepEqual(periods('', []), []);
});

test('descriptors contribute to classification', () => {
  assert.deepEqual(periods('', ['roman']), ['Roman']);
});
