import { useCallback, useEffect, useState } from 'react';
import { api, type Grade, type Stats, type Word } from './api';

type Tab = 'library' | 'review';

export function App() {
  const [tab, setTab] = useState<Tab>('library');
  const [words, setWords] = useState<Word[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, due: 0, learned: 0, reviews: 0 });
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [w, s] = await Promise.all([api.listWords(), api.stats()]);
      setWords(w);
      setStats(s);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>🔁</span>
          <div>
            <h1>VocabLoop</h1>
            <p className="tagline">Learn vocabulary with spaced repetition</p>
          </div>
        </div>
        <nav className="tabs">
          <button className={tab === 'library' ? 'active' : ''} onClick={() => setTab('library')}>
            Library
          </button>
          <button className={tab === 'review' ? 'active' : ''} onClick={() => setTab('review')}>
            Review{stats.due > 0 ? <span className="badge">{stats.due}</span> : null}
          </button>
        </nav>
      </header>

      <StatsBar stats={stats} />

      {error && <div className="error" role="alert">{error}</div>}

      <main>
        {tab === 'library' ? (
          <Library words={words} onChanged={refresh} setError={setError} />
        ) : (
          <Review onChanged={refresh} onDone={() => setTab('library')} />
        )}
      </main>
    </div>
  );
}

function StatsBar({ stats }: { stats: Stats }) {
  const items: Array<[string, number]> = [
    ['Words', stats.total],
    ['Due now', stats.due],
    ['Learned', stats.learned],
    ['Reviews', stats.reviews],
  ];
  return (
    <section className="stats">
      {items.map(([label, value]) => (
        <div className="stat" key={label}>
          <span className="stat-value">{value}</span>
          <span className="stat-label">{label}</span>
        </div>
      ))}
    </section>
  );
}

function Library({
  words,
  onChanged,
  setError,
}: {
  words: Word[];
  onChanged: () => void;
  setError: (m: string | null) => void;
}) {
  const [term, setTerm] = useState('');
  const [definition, setDefinition] = useState('');
  const [example, setExample] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!term.trim() || !definition.trim()) return;
    setBusy(true);
    try {
      await api.addWord({ term, definition, example });
      setTerm('');
      setDefinition('');
      setExample('');
      setError(null);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    await api.deleteWord(id);
    onChanged();
  };

  const seed = async () => {
    await api.seed();
    onChanged();
  };

  return (
    <div className="library">
      <form className="card add-form" onSubmit={submit}>
        <h2>Add a word</h2>
        <label>
          Term
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="e.g. serendipity"
            required
          />
        </label>
        <label>
          Definition
          <input
            value={definition}
            onChange={(e) => setDefinition(e.target.value)}
            placeholder="what it means"
            required
          />
        </label>
        <label>
          Example <span className="muted">(optional)</span>
          <input
            value={example}
            onChange={(e) => setExample(e.target.value)}
            placeholder="use it in a sentence"
          />
        </label>
        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'Adding…' : 'Add word'}
        </button>
      </form>

      <div className="word-list">
        <div className="word-list-head">
          <h2>Your words ({words.length})</h2>
          {words.length === 0 && (
            <button className="ghost" onClick={seed}>
              Load sample deck
            </button>
          )}
        </div>
        {words.length === 0 ? (
          <p className="empty">No words yet. Add one above or load the sample deck.</p>
        ) : (
          <ul>
            {words.map((w) => (
              <li className="card word" key={w.id}>
                <div className="word-main">
                  <div className="word-term">{w.term}</div>
                  <div className="word-def">{w.definition}</div>
                  {w.example && <div className="word-example">“{w.example}”</div>}
                </div>
                <div className="word-meta">
                  <span className="pill">{dueLabel(w.dueAt)}</span>
                  <button className="danger" aria-label={`Delete ${w.term}`} onClick={() => remove(w.id)}>
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Review({ onChanged, onDone }: { onChanged: () => void; onDone: () => void }) {
  const [card, setCard] = useState<Word | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadNext = useCallback(async () => {
    setLoading(true);
    const next = await api.nextReview();
    setCard(next);
    setRevealed(false);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadNext();
  }, [loadNext]);

  const grade = async (g: Grade) => {
    if (!card) return;
    await api.grade(card.id, g);
    onChanged();
    await loadNext();
  };

  if (loading) return <div className="card review-empty">Loading…</div>;

  if (!card) {
    return (
      <div className="card review-empty">
        <div className="review-emoji" aria-hidden>🎉</div>
        <h2>All caught up!</h2>
        <p>You have no cards due for review right now.</p>
        <button className="primary" onClick={onDone}>
          Back to library
        </button>
      </div>
    );
  }

  return (
    <div className="review">
      <div className={`flashcard ${revealed ? 'revealed' : ''}`} onClick={() => setRevealed(true)}>
        <div className="flashcard-term">{card.term}</div>
        {revealed ? (
          <div className="flashcard-back">
            <div className="flashcard-def">{card.definition}</div>
            {card.example && <div className="flashcard-example">“{card.example}”</div>}
          </div>
        ) : (
          <div className="flashcard-hint">Tap to reveal</div>
        )}
      </div>

      {revealed ? (
        <div className="grades">
          <button className="grade again" onClick={() => grade('again')}>
            Again
          </button>
          <button className="grade hard" onClick={() => grade('hard')}>
            Hard
          </button>
          <button className="grade good" onClick={() => grade('good')}>
            Good
          </button>
          <button className="grade easy" onClick={() => grade('easy')}>
            Easy
          </button>
        </div>
      ) : (
        <button className="primary reveal-btn" onClick={() => setRevealed(true)}>
          Reveal answer
        </button>
      )}
    </div>
  );
}

function dueLabel(dueAt: number): string {
  const diff = dueAt - Date.now();
  if (diff <= 0) return 'Due now';
  const days = Math.round(diff / (24 * 60 * 60 * 1000));
  if (days <= 0) return 'Due today';
  if (days === 1) return 'Due in 1 day';
  return `Due in ${days} days`;
}
