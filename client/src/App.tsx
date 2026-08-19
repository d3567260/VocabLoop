import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { api, type Grade, type GradeIntervals, type Stats, type Word } from './api';
import { isSpeechSupported, onSpeechChange, speak, stopSpeaking } from './speech';

type Tab = 'library' | 'review';
type SortKey = 'due' | 'newest' | 'az';

const GRADES: Array<{ id: Grade; label: string; shortcut: string }> = [
  { id: 'again', label: 'Again', shortcut: '1' },
  { id: 'hard', label: 'Hard', shortcut: '2' },
  { id: 'good', label: 'Good', shortcut: '3' },
  { id: 'easy', label: 'Easy', shortcut: '4' },
];

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
          <span className="logo" aria-hidden>
            🔁
          </span>
          <div>
            <h1>VocabLoop</h1>
            <p className="tagline">Learn vocabulary with spaced repetition</p>
          </div>
        </div>
        <nav className="tabs" role="tablist" aria-label="Main">
          <button
            role="tab"
            aria-selected={tab === 'library'}
            className={tab === 'library' ? 'active' : ''}
            onClick={() => setTab('library')}
          >
            Library
          </button>
          <button
            role="tab"
            aria-selected={tab === 'review'}
            className={tab === 'review' ? 'active' : ''}
            onClick={() => setTab('review')}
          >
            Review{stats.due > 0 ? <span className="badge">{stats.due}</span> : null}
          </button>
        </nav>
      </header>

      <StatsBar stats={stats} />

      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      <main>
        {tab === 'library' ? (
          <Library words={words} onChanged={refresh} setError={setError} />
        ) : (
          <Review due={stats.due} onChanged={refresh} onDone={() => setTab('library')} setError={setError} />
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
    <section className="stats" aria-label="Deck stats">
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
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('due');
  const [editingId, setEditingId] = useState<number | null>(null);

  const submit = async (e: FormEvent) => {
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

  const remove = async (word: Word) => {
    if (!window.confirm(`Delete “${word.term}”? This cannot be undone.`)) return;
    try {
      await api.deleteWord(word.id);
      setError(null);
      if (editingId === word.id) setEditingId(null);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const seed = async () => {
    setBusy(true);
    try {
      await api.seed();
      setError(null);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? words.filter(
          (w) =>
            w.term.toLowerCase().includes(q) ||
            w.definition.toLowerCase().includes(q) ||
            w.example.toLowerCase().includes(q)
        )
      : words.slice();
    filtered.sort((a, b) => {
      if (sort === 'az') return a.term.localeCompare(b.term);
      if (sort === 'newest') return b.createdAt - a.createdAt;
      if (a.dueAt !== b.dueAt) return a.dueAt - b.dueAt;
      return a.term.localeCompare(b.term);
    });
    return filtered;
  }, [words, query, sort]);

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
            autoComplete="off"
          />
        </label>
        <label>
          Definition
          <textarea
            value={definition}
            onChange={(e) => setDefinition(e.target.value)}
            placeholder="what it means"
            required
            rows={2}
          />
        </label>
        <label>
          Example <span className="muted">(optional)</span>
          <textarea
            value={example}
            onChange={(e) => setExample(e.target.value)}
            placeholder="use it in a sentence"
            rows={2}
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
            <button className="ghost" onClick={seed} disabled={busy}>
              Load sample deck
            </button>
          )}
        </div>

        {words.length > 0 && (
          <div className="toolbar">
            <input
              className="search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search terms, definitions…"
              aria-label="Search words"
            />
            <label className="sort">
              Sort
              <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort words">
                <option value="due">Due soonest</option>
                <option value="newest">Newest</option>
                <option value="az">A → Z</option>
              </select>
            </label>
          </div>
        )}

        {words.length === 0 ? (
          <p className="empty">No words yet. Add one above or load the sample deck.</p>
        ) : visible.length === 0 ? (
          <p className="empty">No words match “{query}”.</p>
        ) : (
          <ul>
            {visible.map((w) => (
              <li className="card word" key={w.id}>
                {editingId === w.id ? (
                  <EditWord
                    word={w}
                    onCancel={() => setEditingId(null)}
                    onSaved={() => {
                      setEditingId(null);
                      setError(null);
                      onChanged();
                    }}
                    onError={setError}
                  />
                ) : (
                  <>
                    <div className="word-main">
                      <div className="word-term-row">
                        <div className="word-term">{w.term}</div>
                        <SpeakButton text={w.term} label={`Pronounce ${w.term}`} />
                      </div>
                      <div className="word-def">{w.definition}</div>
                      {w.example && <div className="word-example">“{w.example}”</div>}
                    </div>
                    <div className="word-meta">
                      <span className={`pill${w.dueAt <= Date.now() ? ' due' : ''}`}>{dueLabel(w.dueAt)}</span>
                      <button className="ghost compact" onClick={() => setEditingId(w.id)}>
                        Edit
                      </button>
                      <button className="danger" aria-label={`Delete ${w.term}`} onClick={() => remove(w)}>
                        ✕
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function EditWord({
  word,
  onCancel,
  onSaved,
  onError,
}: {
  word: Word;
  onCancel: () => void;
  onSaved: () => void;
  onError: (m: string | null) => void;
}) {
  const [term, setTerm] = useState(word.term);
  const [definition, setDefinition] = useState(word.definition);
  const [example, setExample] = useState(word.example);
  const [busy, setBusy] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!term.trim() || !definition.trim()) return;
    setBusy(true);
    try {
      await api.updateWord(word.id, { term, definition, example });
      onSaved();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="edit-form" onSubmit={save}>
      <input value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Term" required />
      <textarea
        value={definition}
        onChange={(e) => setDefinition(e.target.value)}
        aria-label="Definition"
        rows={2}
        required
      />
      <textarea
        value={example}
        onChange={(e) => setExample(e.target.value)}
        aria-label="Example"
        rows={2}
        placeholder="Example (optional)"
      />
      <div className="edit-actions">
        <button className="primary compact" type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button className="ghost compact" type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function Review({
  due,
  onChanged,
  onDone,
  setError,
}: {
  due: number;
  onChanged: () => void;
  onDone: () => void;
  setError: (m: string | null) => void;
}) {
  const [card, setCard] = useState<Word | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [grading, setGrading] = useState(false);
  const [sessionReviews, setSessionReviews] = useState(0);
  const gradingLock = useRef(false);

  const loadNext = useCallback(
    async (exclude?: number) => {
      setLoading(true);
      try {
        const next = await api.nextReview(exclude);
        setCard(next);
        setRevealed(false);
        setError(null);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [setError]
  );

  useEffect(() => {
    loadNext();
  }, [loadNext]);

  useEffect(() => {
    stopSpeaking();
    return () => stopSpeaking();
  }, [card?.id]);

  const grade = useCallback(
    async (g: Grade) => {
      if (!card || gradingLock.current) return;
      gradingLock.current = true;
      setGrading(true);
      try {
        await api.grade(card.id, g);
        setSessionReviews((n) => n + 1);
        setError(null);
        onChanged();
        await loadNext(card.id);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        gradingLock.current = false;
        setGrading(false);
      }
    },
    [card, loadNext, onChanged, setError]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
        return;
      }
      if (!card || loading || grading) return;
      if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        void speak(e.shiftKey && revealed ? card.definition : card.term);
        return;
      }
      if (!revealed && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        setRevealed(true);
        return;
      }
      if (!revealed) return;
      const hit = GRADES.find((item) => item.shortcut === e.key);
      if (hit) {
        e.preventDefault();
        void grade(hit.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [card, loading, grading, revealed, grade]);

  if (loading && !card) return <div className="card review-empty">Loading…</div>;

  if (!card) {
    return (
      <div className="card review-empty">
        <div className="review-emoji" aria-hidden>
          🎉
        </div>
        <h2>All caught up!</h2>
        <p>
          {sessionReviews > 0
            ? `You reviewed ${sessionReviews} card${sessionReviews === 1 ? '' : 's'} this session.`
            : 'You have no cards due for review right now.'}
        </p>
        <button className="primary" onClick={onDone}>
          Back to library
        </button>
      </div>
    );
  }

  const remaining = Math.max(due, 1);

  return (
    <div className="review">
      <div className="session-bar" aria-live="polite">
        <span>
          {remaining} due · {sessionReviews} reviewed this session
        </span>
        <span className="muted shortcut-hint">Space to reveal · P to play · 1–4 to grade</span>
      </div>

      <div
        className={`flashcard ${revealed ? 'revealed' : ''}`}
        onClick={() => setRevealed(true)}
      >
        <div className="flashcard-term-row">
          <div className="flashcard-term">{card.term}</div>
          <SpeakButton text={card.term} label={`Pronounce ${card.term}`} className="speak-lg" />
        </div>
        {revealed ? (
          <div className="flashcard-back">
            <div className="flashcard-def-row">
              <div className="flashcard-def">{card.definition}</div>
              <SpeakButton text={card.definition} label="Pronounce definition" />
            </div>
            {card.example && <div className="flashcard-example">“{card.example}”</div>}
          </div>
        ) : (
          <div className="flashcard-hint">Tap to reveal</div>
        )}
      </div>

      {revealed ? (
        <div className="grades">
          {GRADES.map((g) => (
            <button
              key={g.id}
              className={`grade ${g.id}`}
              onClick={() => grade(g.id)}
              disabled={grading}
              title={`${g.label} (${g.shortcut})`}
            >
              <span className="grade-label">{g.label}</span>
              <span className="grade-interval">{intervalLabel(card.nextIntervals, g.id)}</span>
            </button>
          ))}
        </div>
      ) : (
        <button className="primary reveal-btn" onClick={() => setRevealed(true)}>
          Reveal answer
        </button>
      )}
    </div>
  );
}

function SpeakButton({
  text,
  label,
  className = '',
}: {
  text: string;
  label: string;
  className?: string;
}) {
  const [speaking, setSpeaking] = useState(false);
  const supported = isSpeechSupported();

  useEffect(() => onSpeechChange((active) => setSpeaking(active === text.trim())), [text]);

  const toggle = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!supported) return;
    if (speaking) {
      stopSpeaking();
      return;
    }
    void speak(text);
  };

  return (
    <button
      type="button"
      className={`speak ${speaking ? 'active' : ''} ${className}`.trim()}
      onClick={toggle}
      disabled={!supported}
      aria-label={speaking ? 'Stop pronunciation' : label}
      title={supported ? (speaking ? 'Stop' : 'Play pronunciation') : 'Speech is not supported in this browser'}
    >
      {speaking ? '◼' : '🔊'}
    </button>
  );
}

function dueLabel(dueAt: number): string {
  const diff = dueAt - Date.now();
  if (diff <= 0) return 'Due now';
  const minutes = Math.round(diff / (60 * 1000));
  if (minutes < 60) return minutes <= 1 ? 'Due in 1 min' : `Due in ${minutes} min`;
  const hours = Math.round(diff / (60 * 60 * 1000));
  if (hours < 24) return hours === 1 ? 'Due in 1 hour' : `Due in ${hours} hours`;
  const days = Math.round(diff / (24 * 60 * 60 * 1000));
  if (days === 1) return 'Due in 1 day';
  return `Due in ${days} days`;
}

function intervalLabel(intervals: GradeIntervals | undefined, grade: Grade): string {
  const days = intervals?.[grade];
  if (days == null) return '';
  if (days <= 0) return 'soon';
  if (days === 1) return '1 day';
  return `${days} days`;
}
