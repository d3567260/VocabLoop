import express from 'express';
import cors from 'cors';
import { openDb, rowToWord, queueStats, nextReviewRow } from './db.js';
import { schedule, GRADES } from './srs.js';
import {
  DEFAULT_FILTERS,
  NEW_CARDS_PER_DAY,
  catalogMeta,
  filterCatalog,
  loadToeicCatalog,
  parseFilters,
  selectImports,
} from './toeic.js';

const SAMPLE_WORDS = [
  { term: 'ephemeral', definition: 'Lasting for a very short time.', example: 'Fashions are ephemeral.' },
  { term: 'ubiquitous', definition: 'Present, appearing, or found everywhere.', example: 'Smartphones are ubiquitous today.' },
  { term: 'serendipity', definition: 'The occurrence of happy events by chance.', example: 'A fortunate stroke of serendipity.' },
  { term: 'pragmatic', definition: 'Dealing with things sensibly and realistically.', example: 'A pragmatic approach to problems.' },
  { term: 'eloquent', definition: 'Fluent or persuasive in speaking or writing.', example: 'An eloquent speech moved the crowd.' },
];

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function existingTerms(db) {
  return db.prepare('SELECT term FROM words').all().map((row) => row.term);
}

function insertWord(db, word, now = Date.now()) {
  return db
    .prepare(
      `INSERT INTO words (
         term, definition, example, example_zh, category, score_range, star_rating, exam_tip,
         due_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      word.term,
      word.definition,
      word.example ?? '',
      word.exampleZh ?? '',
      word.category ?? '',
      word.scoreRange ?? '',
      word.starRating ?? 0,
      word.examTip ?? '',
      now,
      now
    );
}

export function createApp(db = openDb(), options = {}) {
  const app = express();
  const loadCatalog = options.loadCatalog ?? loadToeicCatalog;
  const newCardsPerDay = options.newCardsPerDay ?? NEW_CARDS_PER_DAY;

  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'vocabloop', time: Date.now() });
  });

  app.get('/api/stats', (_req, res) => {
    const now = Date.now();
    const total = db.prepare('SELECT COUNT(*) AS c FROM words').get().c;
    const learned = db.prepare('SELECT COUNT(*) AS c FROM words WHERE repetitions >= 3').get().c;
    const reviews = db.prepare('SELECT COALESCE(SUM(reviews), 0) AS c FROM words').get().c;
    const queue = queueStats(db, now, newCardsPerDay);
    res.json({
      total,
      due: queue.due,
      learned,
      reviews,
      newLeft: queue.newLeft,
      introducedToday: queue.introducedToday,
      newCardsPerDay,
    });
  });

  app.get('/api/words', (_req, res) => {
    const rows = db.prepare('SELECT * FROM words ORDER BY created_at DESC, term COLLATE NOCASE').all();
    res.json(rows.map(rowToWord));
  });

  app.post('/api/words', (req, res) => {
    const { term, definition, example, exampleZh, category, scoreRange, starRating, examTip } =
      req.body ?? {};
    if (!term || !term.trim() || !definition || !definition.trim()) {
      return res.status(400).json({ error: 'term and definition are required' });
    }
    const now = Date.now();
    try {
      const info = insertWord(
        db,
        {
          term: term.trim(),
          definition: definition.trim(),
          example: (example ?? '').trim(),
          exampleZh: (exampleZh ?? '').trim(),
          category: (category ?? '').trim(),
          scoreRange: (scoreRange ?? '').trim(),
          starRating: Number(starRating) || 0,
          examTip: (examTip ?? '').trim(),
        },
        now
      );
      const row = db.prepare('SELECT * FROM words WHERE id = ?').get(info.lastInsertRowid);
      res.status(201).json(rowToWord(row));
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) {
        return res.status(409).json({ error: 'that word is already in your deck' });
      }
      throw err;
    }
  });

  app.put('/api/words/:id', (req, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM words WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'not found' });
    const { term, definition, example, exampleZh, category, scoreRange, starRating, examTip } =
      req.body ?? {};
    db.prepare(
      `UPDATE words
          SET term = ?, definition = ?, example = ?, example_zh = ?, category = ?,
              score_range = ?, star_rating = ?, exam_tip = ?
        WHERE id = ?`
    ).run(
      (term ?? existing.term).trim(),
      (definition ?? existing.definition).trim(),
      (example ?? existing.example ?? '').trim(),
      (exampleZh ?? existing.example_zh ?? '').trim(),
      (category ?? existing.category ?? '').trim(),
      (scoreRange ?? existing.score_range ?? '').trim(),
      starRating == null ? existing.star_rating : Number(starRating) || 0,
      (examTip ?? existing.exam_tip ?? '').trim(),
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

  app.get('/api/review/next', (_req, res) => {
    const row = nextReviewRow(db, Date.now(), newCardsPerDay);
    res.json(rowToWord(row));
  });

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

  app.post('/api/seed', (_req, res) => {
    const count = db.prepare('SELECT COUNT(*) AS c FROM words').get().c;
    if (count > 0) {
      return res.json({ inserted: 0, message: 'deck already has words' });
    }
    const now = Date.now();
    const tx = db.transaction((words) => {
      for (const word of words) insertWord(db, word, now);
    });
    tx(SAMPLE_WORDS);
    res.json({ inserted: SAMPLE_WORDS.length });
  });

  const previewImport = async (filters) => {
    const catalog = await loadCatalog();
    const parsed = parseFilters(filters);
    const matchedRows = filterCatalog(catalog, parsed);
    const selected = selectImports(matchedRows, existingTerms(db), parsed.limit);
    const meta = catalogMeta(catalog);
    return {
      source: 'kknono668/toeic-vocab-tw',
      license: 'CC BY-SA 4.0',
      defaults: DEFAULT_FILTERS,
      newCardsPerDay,
      catalogSize: catalog.length,
      ...meta,
      filters: parsed,
      matched: matchedRows.length,
      alreadyImported: matchedRows.length - selectImports(matchedRows, existingTerms(db)).length,
      remaining: selected.length,
    };
  };

  app.get(
    '/api/import/toeic/preview',
    asyncHandler(async (req, res) => {
      const preview = await previewImport(req.query);
      res.json(preview);
    })
  );

  app.post(
    '/api/import/toeic',
    asyncHandler(async (req, res) => {
      const catalog = await loadCatalog();
      const parsed = parseFilters(req.body ?? {});
      const matchedRows = filterCatalog(catalog, parsed);
      const selected = selectImports(matchedRows, existingTerms(db), parsed.limit);
      const now = Date.now();
      const tx = db.transaction((words) => {
        for (const word of words) insertWord(db, word, now);
      });
      tx(selected);
      res.status(201).json({
        inserted: selected.length,
        matched: matchedRows.length,
        skipped: matchedRows.length - selected.length,
        filters: parsed,
        newCardsPerDay,
      });
    })
  );

  app.use((err, _req, res, _next) => {
    console.error(err);
    const status = err.status ?? 500;
    res.status(status).json({ error: err.message || 'internal error' });
  });

  return app;
}
