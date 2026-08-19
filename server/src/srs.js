// A compact SM-2 style spaced-repetition scheduler.
//
// Grades map to the classic 0-5 quality scale:
//   again -> 2 (failed recall)
//   hard  -> 3
//   good  -> 4
//   easy  -> 5
//
// A failed recall (again) resets the repetition streak and re-queues the card
// for the same day. Successful recalls grow the interval by the ease factor.

const DAY_MS = 24 * 60 * 60 * 1000;

export const GRADES = {
  again: 2,
  hard: 3,
  good: 4,
  easy: 5,
};

/**
 * Compute the next scheduling state for a card.
 *
 * @param {{ repetitions: number, interval: number, ease: number }} card
 * @param {'again'|'hard'|'good'|'easy'} grade
 * @param {number} [now] epoch millis (defaults to Date.now)
 * @returns {{ repetitions: number, interval: number, ease: number, dueAt: number }}
 */
export function schedule(card, grade, now = Date.now()) {
  const quality = GRADES[grade];
  if (quality === undefined) {
    throw new Error(`Unknown grade: ${grade}`);
  }

  let { repetitions = 0, interval = 0, ease = 2.5 } = card;

  // Update the ease factor using the SM-2 formula, clamped to a sane floor.
  ease = ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  if (ease < 1.3) ease = 1.3;

  let intervalDays;
  if (quality < 3) {
    // Failed recall: reset streak, review again today.
    repetitions = 0;
    intervalDays = 0;
  } else {
    repetitions += 1;
    if (repetitions === 1) {
      intervalDays = 1;
    } else if (repetitions === 2) {
      intervalDays = 3;
    } else {
      intervalDays = Math.round(interval * ease);
    }
    // "hard" grows more slowly; "easy" jumps further so the two grades feel distinct.
    if (grade === 'hard') {
      intervalDays = Math.max(1, Math.round(intervalDays * 0.6));
    } else if (grade === 'easy') {
      intervalDays = Math.max(intervalDays + 1, Math.round(intervalDays * 1.3));
    }
  }

  const dueAt = now + intervalDays * DAY_MS;
  return { repetitions, interval: intervalDays, ease: Number(ease.toFixed(3)), dueAt };
}

/**
 * Preview the interval (in days) that each grade would produce for a card,
 * without mutating scheduling state. Used by the review UI so learners can
 * see the consequence of each button before they tap it.
 *
 * @param {{ repetitions: number, interval: number, ease: number }} card
 * @param {number} [now]
 * @returns {{ again: number, hard: number, good: number, easy: number }}
 */
export function previewIntervals(card, now = Date.now()) {
  /** @type {{ again: number, hard: number, good: number, easy: number }} */
  const out = { again: 0, hard: 0, good: 0, easy: 0 };
  for (const grade of Object.keys(GRADES)) {
    out[grade] = schedule(card, grade, now).interval;
  }
  return out;
}
