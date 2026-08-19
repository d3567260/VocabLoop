import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

  return db;
}

export function rowToWord(row) {
  if (!row) return null;
  return {
    id: row.id,
    term: row.term,
    definition: row.definition,
    example: row.example ?? '',
    repetitions: row.repetitions,
    interval: row.interval,
    ease: row.ease,
    dueAt: row.due_at,
    reviews: row.reviews,
    createdAt: row.created_at,
  };
}
