import { test } from 'node:test';
import assert from 'node:assert/strict';
import { schedule } from '../src/srs.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

test('a good grade on a fresh card schedules it one day out', () => {
  const next = schedule({ repetitions: 0, interval: 0, ease: 2.5 }, 'good', NOW);
  assert.equal(next.repetitions, 1);
  assert.equal(next.interval, 1);
  assert.equal(next.dueAt, NOW + 1 * DAY_MS);
});

test('again resets the streak and re-queues for today', () => {
  const next = schedule({ repetitions: 4, interval: 20, ease: 2.5 }, 'again', NOW);
  assert.equal(next.repetitions, 0);
  assert.equal(next.interval, 0);
  assert.equal(next.dueAt, NOW);
  assert.ok(next.ease < 2.5, 'ease should drop after a failed recall');
});

test('successive good grades grow the interval', () => {
  const first = schedule({ repetitions: 0, interval: 0, ease: 2.5 }, 'good', NOW);
  const second = schedule(first, 'good', NOW);
  const third = schedule(second, 'good', NOW);
  assert.equal(second.interval, 3);
  assert.ok(third.interval > second.interval, 'third interval should exceed the second');
});

test('ease is clamped to a floor of 1.3', () => {
  let card = { repetitions: 0, interval: 0, ease: 1.3 };
  for (let i = 0; i < 10; i++) {
    card = schedule(card, 'again', NOW);
  }
  assert.ok(card.ease >= 1.3);
});
