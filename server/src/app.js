import express from 'express';
import cors from 'cors';
import { openDb, rowToWord } from './db.js';
import { schedule, GRADES } from './srs.js';

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
    const total = db.prepare('SELECT COUNT(*) AS c FROM words').get().c;
    const due = db.prepare('SELECT COUNT(*) AS c FROM words WHERE due_at <= ?').get(now).c;
    const learned = db.prepare('SELECT COUNT(*) AS c FROM words WHERE repetitions >= 3').get().c;
    const reviews = db.prepare('SELECT COALESCE(SUM(reviews), 0) AS c FROM words').get().c;
    res.json({ total, due, learned, reviews });
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
    const now = Date.now();
    const info = db
      .prepare(
        `INSERT INTO words (term, definition, example, due_at, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(term.trim(), definition.trim(), (example ?? '').trim(), now, now);
    const row = db.prepare('SELECT * FROM words WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(rowToWord(row));
  });

  app.put('/api/words/:id', (req, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM words WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'not found' });
    const { term, definition, example } = req.body ?? {};
    db.prepare(
      `UPDATE words SET term = ?, definition = ?, example = ? WHERE id = ?`
    ).run(
      (term ?? existing.term).trim(),
      (definition ?? existing.definition).trim(),
      (example ?? existing.example ?? '').trim(),
      id
    );
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
  app.get('/api/review/next', (_req, res) => {
    const now = Date.now();
    const row = db
      .prepare('SELECT * FROM words WHERE due_at <= ? ORDER BY due_at ASC LIMIT 1')
      .get(now);
    res.json(rowToWord(row));
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
    res.json(rowToWord(updated));
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
