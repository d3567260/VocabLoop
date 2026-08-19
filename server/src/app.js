import express from 'express';
import cors from 'cors';
import { openDb, rowToWord } from './db.js';
import { schedule, previewIntervals, GRADES } from './srs.js';

const SAMPLE_WORDS = [
  { term: 'ephemeral', definition: 'Lasting for a very short time.', example: 'Fashions are ephemeral.' },
  { term: 'ubiquitous', definition: 'Present, appearing, or found everywhere.', example: 'Smartphones are ubiquitous today.' },
  { term: 'serendipity', definition: 'The occurrence of happy events by chance.', example: 'A fortunate stroke of serendipity.' },
  { term: 'pragmatic', definition: 'Dealing with things sensibly and realistically.', example: 'A pragmatic approach to problems.' },
  { term: 'eloquent', definition: 'Fluent or persuasive in speaking or writing.', example: 'An eloquent speech moved the crowd.' },
];

export function createApp(db = openDb()) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'vocabloop', time: Date.now() });
  });

  app.get('/api/stats', (_req, res) => {
    const now = Date.now();
    const row = db
      .prepare(
        `SELECT
           COUNT(*) AS total,
           COALESCE(SUM(CASE WHEN due_at <= ? THEN 1 ELSE 0 END), 0) AS due,
           COALESCE(SUM(CASE WHEN repetitions >= 3 THEN 1 ELSE 0 END), 0) AS learned,
           COALESCE(SUM(reviews), 0) AS reviews
         FROM words`
      )
      .get(now);
    res.json({
      total: row.total,
      due: row.due,
      learned: row.learned,
      reviews: row.reviews,
    });
  });

  app.get('/api/words', (_req, res) => {
    const rows = db.prepare('SELECT * FROM words ORDER BY created_at DESC').all();
    res.json(rows.map(rowToWord));
  });

  app.post('/api/words', (req, res) => {
    const { term, definition, example } = req.body ?? {};
    if (!term || !term.trim() || !definition || !definition.trim()) {
      return res.status(400).json({ error: 'term and definition are required' });
    }
    const trimmedTerm = term.trim();
    const dup = db.prepare('SELECT id FROM words WHERE LOWER(term) = LOWER(?)').get(trimmedTerm);
    if (dup) {
      return res.status(409).json({ error: 'that term is already in your deck' });
    }
    const now = Date.now();
    const info = db
      .prepare(
        `INSERT INTO words (term, definition, example, due_at, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(trimmedTerm, definition.trim(), (example ?? '').trim(), now, now);
    const row = db.prepare('SELECT * FROM words WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(rowToWord(row));
  });

  app.put('/api/words/:id', (req, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM words WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'not found' });
    const { term, definition, example } = req.body ?? {};
    const nextTerm = (term ?? existing.term).trim();
    const nextDefinition = (definition ?? existing.definition).trim();
    if (!nextTerm || !nextDefinition) {
      return res.status(400).json({ error: 'term and definition are required' });
    }
    const dup = db
      .prepare('SELECT id FROM words WHERE LOWER(term) = LOWER(?) AND id != ?')
      .get(nextTerm, id);
    if (dup) {
      return res.status(409).json({ error: 'that term is already in your deck' });
    }
    db.prepare(
      `UPDATE words SET term = ?, definition = ?, example = ? WHERE id = ?`
    ).run(nextTerm, nextDefinition, (example ?? existing.example ?? '').trim(), id);
    const row = db.prepare('SELECT * FROM words WHERE id = ?').get(id);
    res.json(rowToWord(row));
  });

  app.delete('/api/words/:id', (req, res) => {
    const id = Number(req.params.id);
    const info = db.prepare('DELETE FROM words WHERE id = ?').run(id);
    if (info.changes === 0) return res.status(404).json({ error: 'not found' });
    res.status(204).end();
  });

  // Next card that is due for review (most overdue first).
  // Optional ?exclude=:id skips a just-graded card when another due card exists,
  // so "Again" does not immediately loop the same word in a multi-card session.
  app.get('/api/review/next', (req, res) => {
    const now = Date.now();
    const exclude = Number(req.query.exclude);
    const order = 'ORDER BY due_at ASC, id ASC LIMIT 1';
    let row;
    if (Number.isInteger(exclude) && exclude > 0) {
      row = db
        .prepare(`SELECT * FROM words WHERE due_at <= ? AND id != ? ${order}`)
        .get(now, exclude);
      if (!row) {
        row = db.prepare(`SELECT * FROM words WHERE due_at <= ? ${order}`).get(now);
      }
    } else {
      row = db.prepare(`SELECT * FROM words WHERE due_at <= ? ${order}`).get(now);
    }
    res.json(withPreview(rowToWord(row)));
  });

  // Grade a card and reschedule it.
  app.post('/api/review/:id', (req, res) => {
    const id = Number(req.params.id);
    const { grade } = req.body ?? {};
    if (!(grade in GRADES)) {
      return res.status(400).json({ error: `grade must be one of ${Object.keys(GRADES).join(', ')}` });
    }
    const row = db.prepare('SELECT * FROM words WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: 'not found' });

    const next = schedule(
      { repetitions: row.repetitions, interval: row.interval, ease: row.ease },
      grade
    );
    db.prepare(
      `UPDATE words
         SET repetitions = ?, interval = ?, ease = ?, due_at = ?, reviews = reviews + 1
       WHERE id = ?`
    ).run(next.repetitions, next.interval, next.ease, next.dueAt, id);

    const updated = db.prepare('SELECT * FROM words WHERE id = ?').get(id);
    res.json(withPreview(rowToWord(updated)));
  });

  // Seed sample vocabulary. Only inserts when the deck is empty.
  app.post('/api/seed', (_req, res) => {
    const count = db.prepare('SELECT COUNT(*) AS c FROM words').get().c;
    if (count > 0) {
      return res.json({ inserted: 0, message: 'deck already has words' });
    }
    const now = Date.now();
    const insert = db.prepare(
      `INSERT INTO words (term, definition, example, due_at, created_at) VALUES (?, ?, ?, ?, ?)`
    );
    const tx = db.transaction((words) => {
      for (const w of words) insert.run(w.term, w.definition, w.example, now, now);
    });
    tx(SAMPLE_WORDS);
    res.json({ inserted: SAMPLE_WORDS.length });
  });

  return app;
}

function withPreview(word) {
  if (!word) return null;
  return {
    ...word,
    nextIntervals: previewIntervals({
      repetitions: word.repetitions,
      interval: word.interval,
      ease: word.ease,
    }),
  };
}
