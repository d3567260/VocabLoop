import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function ensureColumn(db, name, definition) {
  const cols = db.prepare('PRAGMA table_info(words)').all();
  if (!cols.some((col) => col.name === name)) {
    db.exec(`ALTER TABLE words ADD COLUMN ${name} ${definition}`);
  }
}

/**
 * Open (and lazily initialize) the SQLite database.
 * Pass ':memory:' for tests.
 */
export function openDb(dbPath) {
  let resolvedPath = dbPath ?? process.env.VOCABLOOP_DB;
  if (!resolvedPath) {
    const dataDir = join(__dirname, '..', 'data');
    mkdirSync(dataDir, { recursive: true });
    resolvedPath = join(dataDir, 'vocabloop.db');
  }

  const db = new Database(resolvedPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS words (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      term        TEXT NOT NULL,
      definition  TEXT NOT NULL,
      example     TEXT,
      repetitions INTEGER NOT NULL DEFAULT 0,
      interval    INTEGER NOT NULL DEFAULT 0,
      ease        REAL    NOT NULL DEFAULT 2.5,
      due_at      INTEGER NOT NULL,
      reviews     INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL
    );
  `);

  ensureColumn(db, 'example_zh', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'category', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'score_range', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'star_rating', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'exam_tip', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'introduced_at', 'INTEGER NOT NULL DEFAULT 0');

  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS words_term_nocase ON words(term COLLATE NOCASE)`);

  return db;
}

export function rowToWord(row) {
  if (!row) return null;
  return {
    id: row.id,
    term: row.term,
    definition: row.definition,
    example: row.example ?? '',
    exampleZh: row.example_zh ?? '',
    category: row.category ?? '',
    scoreRange: row.score_range ?? '',
    starRating: row.star_rating ?? 0,
    examTip: row.exam_tip ?? '',
    repetitions: row.repetitions,
    interval: row.interval,
    ease: row.ease,
    dueAt: row.due_at,
    reviews: row.reviews,
    introducedAt: row.introduced_at ?? 0,
    createdAt: row.created_at,
  };
}

export function startOfLocalDay(now = Date.now()) {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function queueStats(db, now = Date.now(), newCardsPerDay = 15) {
  const dueReviews = db
    .prepare('SELECT COUNT(*) AS c FROM words WHERE due_at <= ? AND reviews > 0')
    .get(now).c;
  const introducedUngraded = db
    .prepare(
      'SELECT COUNT(*) AS c FROM words WHERE due_at <= ? AND reviews = 0 AND introduced_at > 0'
    )
    .get(now).c;
  const introducedToday = db
    .prepare('SELECT COUNT(*) AS c FROM words WHERE introduced_at >= ?')
    .get(startOfLocalDay(now)).c;
  const newLeft = db
    .prepare('SELECT COUNT(*) AS c FROM words WHERE reviews = 0 AND introduced_at = 0')
    .get().c;
  const remainingQuota = Math.max(0, newCardsPerDay - introducedToday);
  const newDue = introducedUngraded + Math.min(newLeft, remainingQuota);
  return {
    due: dueReviews + newDue,
    dueReviews,
    newDue,
    newLeft,
    remainingQuota,
    introducedToday,
    newCardsPerDay,
  };
}

export function nextReviewRow(db, now = Date.now(), newCardsPerDay = 15) {
  const dueReview = db
    .prepare(
      'SELECT * FROM words WHERE due_at <= ? AND reviews > 0 ORDER BY due_at ASC, id ASC LIMIT 1'
    )
    .get(now);
  if (dueReview) return dueReview;

  const introduced = db
    .prepare(
      `SELECT * FROM words
        WHERE due_at <= ? AND reviews = 0 AND introduced_at > 0
        ORDER BY introduced_at ASC, id ASC LIMIT 1`
    )
    .get(now);
  if (introduced) return introduced;

  const { remainingQuota } = queueStats(db, now, newCardsPerDay);
  if (remainingQuota <= 0) return null;

  const fresh = db
    .prepare(
      'SELECT * FROM words WHERE reviews = 0 AND introduced_at = 0 ORDER BY id ASC LIMIT 1'
    )
    .get();
  if (!fresh) return null;

  db.prepare('UPDATE words SET introduced_at = ? WHERE id = ? AND introduced_at = 0').run(
    now,
    fresh.id
  );
  return db.prepare('SELECT * FROM words WHERE id = ?').get(fresh.id);
}
