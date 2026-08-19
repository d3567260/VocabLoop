import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';

async function withServer(fn) {
  const db = openDb(':memory:');
  const app = createApp(db);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}`;
  try {
    await fn({ url, db });
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    db.close();
  }
}

function json(res) {
  return res.json();
}

test('health check', async () => {
  await withServer(async ({ url }) => {
    const res = await fetch(`${url}/api/health`);
    assert.equal(res.status, 200);
    const body = await json(res);
    assert.equal(body.service, 'vocabloop');
  });
});

test('rejects a word without a definition', async () => {
  await withServer(async ({ url }) => {
    const res = await fetch(`${url}/api/words`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ term: 'foo' }),
    });
    assert.equal(res.status, 400);
  });
});

test('creates, edits, and rejects duplicate terms', async () => {
  await withServer(async ({ url }) => {
    const created = await fetch(`${url}/api/words`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ term: 'serendipity', definition: 'happy chance', example: 'a stroke of serendipity' }),
    });
    assert.equal(created.status, 201);
    const word = await json(created);

    const dup = await fetch(`${url}/api/words`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ term: 'Serendipity', definition: 'again' }),
    });
    assert.equal(dup.status, 409);

    const edited = await fetch(`${url}/api/words/${word.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ term: 'serendipity', definition: 'pleasant surprise', example: 'what luck' }),
    });
    assert.equal(edited.status, 200);
    const updated = await json(edited);
    assert.equal(updated.definition, 'pleasant surprise');
    assert.equal(updated.example, 'what luck');
  });
});

test('seed loads sample words once, stats and review flow work', async () => {
  await withServer(async ({ url }) => {
    const first = await fetch(`${url}/api/seed`, { method: 'POST' });
    const firstBody = await json(first);
    assert.equal(firstBody.inserted, 5);

    const second = await fetch(`${url}/api/seed`, { method: 'POST' });
    const secondBody = await json(second);
    assert.equal(secondBody.inserted, 0);

    const stats = await json(await fetch(`${url}/api/stats`));
    assert.equal(stats.total, 5);
    assert.equal(stats.due, 5);
    assert.equal(stats.learned, 0);

    const next = await json(await fetch(`${url}/api/review/next`));
    assert.ok(next.id);
    assert.equal(next.nextIntervals.again, 0);
    assert.ok(next.nextIntervals.easy > next.nextIntervals.good);

    const graded = await fetch(`${url}/api/review/${next.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grade: 'good' }),
    });
    assert.equal(graded.status, 200);

    const after = await json(await fetch(`${url}/api/stats`));
    assert.equal(after.due, 4);
    assert.equal(after.reviews, 1);
  });
});

test('review next exclude skips a just-graded card when another is due', async () => {
  await withServer(async ({ url }) => {
    await fetch(`${url}/api/words`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ term: 'alpha', definition: 'first' }),
    });
    await fetch(`${url}/api/words`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ term: 'bravo', definition: 'second' }),
    });

    const first = await json(await fetch(`${url}/api/review/next`));
    const skipped = await json(await fetch(`${url}/api/review/next?exclude=${first.id}`));
    assert.notEqual(skipped.id, first.id);

    await fetch(`${url}/api/review/${first.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grade: 'again' }),
    });
    const afterAgain = await json(await fetch(`${url}/api/review/next?exclude=${first.id}`));
    assert.notEqual(afterAgain.id, first.id);
  });
});

test('delete removes a word', async () => {
  await withServer(async ({ url }) => {
    const created = await json(
      await fetch(`${url}/api/words`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ term: 'gone', definition: 'not here' }),
      })
    );
    const del = await fetch(`${url}/api/words/${created.id}`, { method: 'DELETE' });
    assert.equal(del.status, 204);
    const missing = await fetch(`${url}/api/words/${created.id}`, { method: 'DELETE' });
    assert.equal(missing.status, 404);
  });
});
