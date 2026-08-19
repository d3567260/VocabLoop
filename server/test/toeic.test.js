import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  catalogMeta,
  filterCatalog,
  mapToeicEntry,
  parseFilters,
  selectImports,
} from '../src/toeic.js';

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'toeic-sample.json');
const catalog = JSON.parse(await readFile(fixturePath, 'utf8'));

test('parseFilters defaults to the 350-score beginner preset', () => {
  assert.deepEqual(parseFilters({}), {
    scoreRange: '0-400',
    minStar: 5,
    category: '',
    limit: null,
  });
});

test('filterCatalog keeps 0-400 five-star words by default', () => {
  const matched = filterCatalog(catalog, {});
  assert.equal(matched.length, 7);
  assert.ok(matched.every((row) => row.toeic_score_range === '0-400' && row.star_rating >= 5));
});

test('filterCatalog can widen to all score ranges and a category', () => {
  const office = filterCatalog(catalog, { scoreRange: 'all', minStar: 5, category: '辦公日常' });
  assert.deepEqual(
    office.map((row) => row.english_word).sort(),
    ['a copy of', 'a number of', 'a sheet of', 'able', 'able']
  );
});

test('mapToeicEntry copies the first bilingual example and exam tip', () => {
  const word = mapToeicEntry(catalog[0]);
  assert.equal(word.term, 'a couple of');
  assert.equal(word.definition, '一對，幾個（指兩個）');
  assert.match(word.example, /revisions/);
  assert.match(word.exampleZh, /修改/);
  assert.equal(word.category, '溝通互動');
  assert.equal(word.scoreRange, '0-400');
  assert.equal(word.starRating, 5);
  assert.match(word.examTip, /2 或 3/);
});

test('mapToeicEntry tolerates missing examples', () => {
  const word = mapToeicEntry(catalog.find((row) => row.english_word === 'noexampleword'));
  assert.equal(word.example, '');
  assert.equal(word.exampleZh, '');
  assert.equal(word.examTip, '');
});

test('selectImports skips existing terms case-insensitively and honors limit', () => {
  const beginner = filterCatalog(catalog, {});
  const selected = selectImports(beginner, ['A Couple Of'], 2);
  assert.equal(selected.length, 2);
  assert.ok(!selected.some((word) => word.term.toLowerCase() === 'a couple of'));
});

test('catalogMeta lists score ranges and Chinese categories', () => {
  const meta = catalogMeta(catalog);
  assert.ok(meta.scoreRanges.includes('0-400'));
  assert.ok(meta.categories.includes('住宿與餐飲'));
});
