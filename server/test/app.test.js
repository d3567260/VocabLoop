import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'toeic-sample.json');
const catalog = JSON.parse(await readFile(fixturePath, 'utf8'));

async function withServer(options, fn) {
  if (typeof options === 'function') {
    fn = options;
    options = {};
  }
  const db = openDb(':memory:');
  const app = createApp(db, { loadCatalog: async () => catalog, newCardsPerDay: 2, ...options });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  try {
    return await fn({ port, db });
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    db.close();
  }
}

async function request(port, method, path, body) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return {
    status: res.status,
    body: text ? JSON.parse(text) : null,
  };
}

test('health check', async () => {
  await withServer({}, async ({ port }) => {
    const res = await request(port, 'GET', '/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.service, 'vocabloop');
  });
});

test('rejects a word without a definition', async () => {
  await withServer({}, async ({ port }) => {
    const res = await request(port, 'POST', '/api/words', { term: 'foo' });
    assert.equal(res.status, 400);
  });
});

test('creates, edits, and rejects duplicate terms', async () => {
  await withServer({}, async ({ port }) => {
    const created = await request(port, 'POST', '/api/words', {
      term: 'serendipity',
      definition: 'happy chance',
      example: 'a stroke of serendipity',
    });
    assert.equal(created.status, 201);

    const dup = await request(port, 'POST', '/api/words', {
      term: 'Serendipity',
      definition: 'again',
    });
    assert.equal(dup.status, 409);

    const edited = await request(port, 'PUT', `/api/words/${created.body.id}`, {
      term: 'serendipity',
      definition: 'pleasant surprise',
      example: 'what luck',
    });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.definition, 'pleasant surprise');
    assert.equal(edited.body.example, 'what luck');
  });
});

test('seed loads sample words once, stats and review flow work', async () => {
  await withServer({ newCardsPerDay: 15 }, async ({ port }) => {
    const first = await request(port, 'POST', '/api/seed');
    assert.equal(first.body.inserted, 5);

    const second = await request(port, 'POST', '/api/seed');
    assert.equal(second.body.inserted, 0);

    const stats = await request(port, 'GET', '/api/stats');
    assert.equal(stats.body.total, 5);
    assert.equal(stats.body.due, 5);
    assert.equal(stats.body.learned, 0);

    const next = await request(port, 'GET', '/api/review/next');
    assert.ok(next.body.id);
    assert.equal(next.body.nextIntervals.again, 0);
    assert.ok(next.body.nextIntervals.easy > next.body.nextIntervals.good);

    const graded = await request(port, 'POST', `/api/review/${next.body.id}`, { grade: 'good' });
    assert.equal(graded.status, 200);

    const after = await request(port, 'GET', '/api/stats');
    assert.equal(after.body.due, 4);
    assert.equal(after.body.reviews, 1);
  });
});

test('review next exclude skips a just-graded card when another is due', async () => {
  await withServer({ newCardsPerDay: 15 }, async ({ port }) => {
    await request(port, 'POST', '/api/words', { term: 'alpha', definition: 'first' });
    await request(port, 'POST', '/api/words', { term: 'bravo', definition: 'second' });

    const first = await request(port, 'GET', '/api/review/next');
    const skipped = await request(port, 'GET', `/api/review/next?exclude=${first.body.id}`);
    assert.notEqual(skipped.body.id, first.body.id);

    await request(port, 'POST', `/api/review/${first.body.id}`, { grade: 'again' });
    const afterAgain = await request(port, 'GET', `/api/review/next?exclude=${first.body.id}`);
    assert.notEqual(afterAgain.body.id, first.body.id);
  });
});

test('delete removes a word', async () => {
  await withServer({}, async ({ port }) => {
    const created = await request(port, 'POST', '/api/words', { term: 'gone', definition: 'not here' });
    const del = await request(port, 'DELETE', `/api/words/${created.body.id}`);
    assert.equal(del.status, 204);
    const missing = await request(port, 'DELETE', `/api/words/${created.body.id}`);
    assert.equal(missing.status, 404);
  });
});

test('TOEIC preview defaults to the 0-400 five-star beginner deck', async () => {
  await withServer({}, async ({ port }) => {
    const res = await request(port, 'GET', '/api/import/toeic/preview');
    assert.equal(res.status, 200);
    assert.equal(res.body.filters.scoreRange, '0-400');
    assert.equal(res.body.filters.minStar, 5);
    assert.equal(res.body.matched, 6);
    assert.equal(res.body.catalogRows, 7);
    assert.equal(res.body.alreadyImported, 0);
    assert.equal(res.body.remaining, 6);
    assert.equal(res.body.newCardsPerDay, 2);
  });
});

test('TOEIC import inserts bilingual cards and skips duplicates', async () => {
  await withServer({}, async ({ port }) => {
    const first = await request(port, 'POST', '/api/import/toeic', {});
    assert.equal(first.status, 201);
    assert.equal(first.body.inserted, 6);

    const stats = await request(port, 'GET', '/api/stats');
    assert.equal(stats.body.total, 6);
    assert.equal(stats.body.due, 2, 'new-card daily cap should limit due count');

    const second = await request(port, 'POST', '/api/import/toeic', {});
    assert.equal(second.body.inserted, 0);

    const words = await request(port, 'GET', '/api/words');
    const couple = words.body.find((word) => word.term === 'a couple of');
    assert.equal(couple.definition, '一對，幾個（指兩個）');
    assert.match(couple.example, /revisions/);
    assert.match(couple.exampleZh, /修改/);
    assert.equal(couple.scoreRange, '0-400');
    assert.equal(couple.starRating, 5);
  });
});

test('review serves at most newCardsPerDay fresh cards', async () => {
  await withServer({}, async ({ port }) => {
    await request(port, 'POST', '/api/import/toeic', {});

    const first = await request(port, 'GET', '/api/review/next');
    const again = await request(port, 'GET', '/api/review/next');
    assert.ok(first.body?.term);
    assert.equal(again.body.id, first.body.id, 'ungraded new cards should stay in front');

    await request(port, 'POST', `/api/review/${first.body.id}`, { grade: 'good' });
    const second = await request(port, 'GET', '/api/review/next');
    assert.ok(second.body?.term);
    assert.notEqual(second.body.id, first.body.id);

    await request(port, 'POST', `/api/review/${second.body.id}`, { grade: 'good' });
    const third = await request(port, 'GET', '/api/review/next');
    assert.equal(third.body, null);

    const stats = await request(port, 'GET', '/api/stats');
    assert.equal(stats.body.due, 0);
    assert.equal(stats.body.total, 6);
    assert.equal(stats.body.newLeft, 4);
    assert.equal(stats.body.introducedToday, 2);
  });
});

test('import can target a later score band', async () => {
  await withServer({}, async ({ port }) => {
    const res = await request(port, 'POST', '/api/import/toeic', {
      scoreRange: '400-600',
      minStar: 5,
    });
    assert.equal(res.body.inserted, 2);
    const words = await request(port, 'GET', '/api/words');
    assert.ok(words.body.every((word) => word.scoreRange === '400-600'));
  });
});
