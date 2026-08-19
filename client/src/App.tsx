import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { api, type Grade, type GradeIntervals, type Stats, type ToeicPreview, type Word } from './api';
import { isSpeechSupported, onSpeechChange, speak, stopSpeaking } from './speech';

type Tab = 'library' | 'review';
type SortKey = 'due' | 'newest' | 'az';

const GRADES: Array<{ id: Grade; label: string; shortcut: string }> = [
  { id: 'again', label: '再來', shortcut: '1' },
  { id: 'hard', label: '困難', shortcut: '2' },
  { id: 'good', label: '記得', shortcut: '3' },
  { id: 'easy', label: '簡單', shortcut: '4' },
];

const EMPTY_STATS: Stats = {
  total: 0,
  due: 0,
  learned: 0,
  reviews: 0,
  newLeft: 0,
  introducedToday: 0,
  newCardsPerDay: 15,
};

export function App() {
  const [tab, setTab] = useState<Tab>('library');
  const [words, setWords] = useState<Word[]>([]);
  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
            <p className="tagline">TOEIC 單字間隔複習 · 預設適合約 350 分</p>
          </div>
        </div>
        <nav className="tabs" role="tablist" aria-label="主要功能">
          <button
            role="tab"
            aria-selected={tab === 'library'}
            className={tab === 'library' ? 'active' : ''}
            onClick={() => setTab('library')}
          >
            字庫
          </button>
          <button
            role="tab"
            aria-selected={tab === 'review'}
            className={tab === 'review' ? 'active' : ''}
            onClick={() => setTab('review')}
          >
            複習{stats.due > 0 ? <span className="badge">{stats.due}</span> : null}
          </button>
        </nav>
      </header>

      <StatsBar stats={stats} />

      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}

      <main>
        {tab === 'library' ? (
          <Library
            words={words}
            stats={stats}
            onChanged={refresh}
            setError={setError}
            setNotice={setNotice}
          />
        ) : (
          <Review stats={stats} onChanged={refresh} onDone={() => setTab('library')} setError={setError} />
        )}
      </main>
    </div>
  );
}

function StatsBar({ stats }: { stats: Stats }) {
  const items: Array<[string, number]> = [
    ['單字', stats.total],
    ['今日該背', stats.due],
    ['已學會', stats.learned],
    ['複習次數', stats.reviews],
  ];
  return (
    <section className="stats" aria-label="字庫統計">
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
  stats,
  onChanged,
  setError,
  setNotice,
}: {
  words: Word[];
  stats: Stats;
  onChanged: () => void;
  setError: (m: string | null) => void;
  setNotice: (m: string | null) => void;
}) {
  const [term, setTerm] = useState('');
  const [definition, setDefinition] = useState('');
  const [example, setExample] = useState('');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('due');
  const [listRange, setListRange] = useState('all');
  const [listCategory, setListCategory] = useState('all');
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
    if (!window.confirm(`確定刪除「${word.term}」？此動作無法復原。`)) return;
    try {
      await api.deleteWord(word.id);
      setError(null);
      if (editingId === word.id) setEditingId(null);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const categories = useMemo(
    () => [...new Set(words.map((w) => w.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-Hant')),
    [words]
  );
  const ranges = useMemo(
    () => [...new Set(words.map((w) => w.scoreRange).filter(Boolean))],
    [words]
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = words.filter((w) => {
      if (listRange !== 'all' && w.scoreRange !== listRange) return false;
      if (listCategory !== 'all' && w.category !== listCategory) return false;
      if (!q) return true;
      return (
        w.term.toLowerCase().includes(q) ||
        w.definition.toLowerCase().includes(q) ||
        w.example.toLowerCase().includes(q) ||
        w.exampleZh.toLowerCase().includes(q)
      );
    });
    filtered.sort((a, b) => {
      if (sort === 'az') return a.term.localeCompare(b.term);
      if (sort === 'newest') return b.createdAt - a.createdAt;
      if (a.dueAt !== b.dueAt) return a.dueAt - b.dueAt;
      return a.term.localeCompare(b.term);
    });
    return filtered;
  }, [words, query, sort, listRange, listCategory]);

  return (
    <div className="library">
      <ToeicImport stats={stats} onChanged={onChanged} setError={setError} setNotice={setNotice} />

      <form className="card add-form" onSubmit={submit}>
        <h2>手動加字</h2>
        <label>
          英文
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="例如 able"
            required
            autoComplete="off"
          />
        </label>
        <label>
          中文定義
          <textarea
            value={definition}
            onChange={(e) => setDefinition(e.target.value)}
            placeholder="有能力、能夠"
            required
            rows={2}
          />
        </label>
        <label>
          例句 <span className="muted">（選填）</span>
          <textarea
            value={example}
            onChange={(e) => setExample(e.target.value)}
            placeholder="She is able to finish the report."
            rows={2}
          />
        </label>
        <button className="primary" type="submit" disabled={busy}>
          {busy ? '新增中…' : '新增單字'}
        </button>
      </form>

      <div className="word-list">
        <div className="word-list-head">
          <h2>
            你的字庫（{visible.length}
            {visible.length !== words.length ? ` / ${words.length}` : ''}）
          </h2>
        </div>
        {words.length > 0 && (
          <div className="library-toolbar">
            <input
              className="search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜尋英文或中文"
              aria-label="搜尋單字"
            />
            <select value={listRange} onChange={(e) => setListRange(e.target.value)} aria-label="分數區間">
              <option value="all">全部分數</option>
              {ranges.map((range) => (
                <option key={range} value={range}>
                  {range}
                </option>
              ))}
            </select>
            <select
              value={listCategory}
              onChange={(e) => setListCategory(e.target.value)}
              aria-label="主題分類"
            >
              <option value="all">全部分類</option>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="排序">
              <option value="due">即將到期</option>
              <option value="newest">最新</option>
              <option value="az">A → Z</option>
            </select>
          </div>
        )}
        {words.length === 0 ? (
          <p className="empty">字庫還是空的。請先匯入 350 分入門卡組，或手動加一個字。</p>
        ) : visible.length === 0 ? (
          <p className="empty">沒有符合篩選條件的單字。</p>
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
                        <SpeakButton text={w.term} label={`朗讀 ${w.term}`} onError={setError} />
                      </div>
                      <div className="word-def">{w.definition}</div>
                      {w.example && (
                        <div className="word-example-row">
                          <div className="word-example">“{w.example}”</div>
                          <SpeakButton text={w.example} label={`朗讀例句：${w.example}`} onError={setError} />
                        </div>
                      )}
                      {w.exampleZh && <div className="word-example-zh">{w.exampleZh}</div>}
                      <div className="word-tags">
                        {w.starRating > 0 && <span className="pill star">{w.starRating}★</span>}
                        {w.scoreRange && <span className="pill">{w.scoreRange}</span>}
                        {w.category && <span className="pill">{w.category}</span>}
                        <span className={`pill${w.dueAt <= Date.now() ? ' due' : ''}`}>{dueLabel(w.dueAt)}</span>
                      </div>
                    </div>
                    <div className="word-meta">
                      <button className="ghost compact" onClick={() => setEditingId(w.id)}>
                        編輯
                      </button>
                      <button className="danger" aria-label={`刪除 ${w.term}`} onClick={() => remove(w)}>
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
  const [exampleZh, setExampleZh] = useState(word.exampleZh);
  const [busy, setBusy] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!term.trim() || !definition.trim()) return;
    setBusy(true);
    try {
      await api.updateWord(word.id, { term, definition, example, exampleZh });
      onSaved();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="edit-form" onSubmit={save}>
      <input value={term} onChange={(e) => setTerm(e.target.value)} aria-label="英文" required />
      <textarea
        value={definition}
        onChange={(e) => setDefinition(e.target.value)}
        aria-label="中文定義"
        rows={2}
        required
      />
      <textarea
        value={example}
        onChange={(e) => setExample(e.target.value)}
        aria-label="英文例句"
        rows={2}
        placeholder="英文例句（選填）"
      />
      <textarea
        value={exampleZh}
        onChange={(e) => setExampleZh(e.target.value)}
        aria-label="中文例句"
        rows={2}
        placeholder="中文例句（選填）"
      />
      <div className="edit-actions">
        <button className="primary compact" type="submit" disabled={busy}>
          {busy ? '儲存中…' : '儲存'}
        </button>
        <button className="ghost compact" type="button" onClick={onCancel} disabled={busy}>
          取消
        </button>
      </div>
    </form>
  );
}

function ToeicImport({
  stats,
  onChanged,
  setError,
  setNotice,
}: {
  stats: Stats;
  onChanged: () => void;
  setError: (m: string | null) => void;
  setNotice: (m: string | null) => void;
}) {
  const [scoreRange, setScoreRange] = useState('0-400');
  const [minStar, setMinStar] = useState(5);
  const [category, setCategory] = useState('');
  const [preview, setPreview] = useState<ToeicPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);

  const loadPreview = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.toeicPreview({ scoreRange, minStar, category });
      setPreview(data);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [scoreRange, minStar, category, setError]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadPreview();
    }, 200);
    return () => window.clearTimeout(timer);
  }, [loadPreview]);

  const applyBeginner = () => {
    setScoreRange('0-400');
    setMinStar(5);
    setCategory('');
  };

  const importDeck = async () => {
    setImporting(true);
    try {
      const result = await api.importToeic({ scoreRange, minStar, category });
      const daily = result.newCardsPerDay || stats.newCardsPerDay;
      setNotice(
        result.inserted > 0
          ? `已匯入 ${result.inserted} 張卡片。每天先學 ${daily} 個新字，其餘會留在字庫裡。`
          : '這些單字都已經在字庫裡了。'
      );
      setError(null);
      await loadPreview();
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <section className="card import-card">
      <div className="import-head">
        <div>
          <h2>匯入 TOEIC 詞庫</h2>
          <p className="muted">
            來源{' '}
            <a href="https://huggingface.co/datasets/kknono668/toeic-vocab-tw" target="_blank" rel="noreferrer">
              kknono668/toeic-vocab-tw
            </a>
            ，授權 CC BY-SA 4.0。350 分建議先從 0–400、5 星高頻詞開始。
          </p>
        </div>
        <button className="ghost" type="button" onClick={applyBeginner}>
          使用 350 分預設
        </button>
      </div>

      <div className="import-grid">
        <label>
          分數區間
          <select value={scoreRange} onChange={(e) => setScoreRange(e.target.value)}>
            {(preview?.scoreRanges ?? ['0-400', '400-600', '600-780', '780-900', '900+']).map((range) => (
              <option key={range} value={range}>
                {range}
              </option>
            ))}
            <option value="all">全部區間</option>
          </select>
        </label>
        <label>
          最低星級
          <select value={minStar} onChange={(e) => setMinStar(Number(e.target.value))}>
            <option value={5}>5 星（高頻必備）</option>
            <option value={4}>4 星以上</option>
            <option value={3}>3 星以上</option>
            <option value={0}>不限星級</option>
          </select>
        </label>
        <label>
          主題
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">全部主題</option>
            {(preview?.categories ?? []).map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="import-summary">
        {loading || !preview
          ? '正在載入詞庫…第一次會從 Hugging Face 下載，之後會使用本機快取。'
          : `符合 ${preview.matched} 筆，字庫已有 ${preview.alreadyImported} 筆，還可匯入 ${preview.remaining} 筆。`}
      </p>

      <button
        className="primary"
        type="button"
        onClick={importDeck}
        disabled={importing || loading || !preview || preview.remaining === 0}
      >
        {importing
          ? '匯入中…'
          : scoreRange === '0-400' && minStar === 5 && !category
            ? `匯入 350 分入門卡組${preview ? `（${preview.remaining} 筆）` : ''}`
            : `匯入篩選結果${preview ? `（${preview.remaining} 筆）` : ''}`}
      </button>
    </section>
  );
}

function Review({
  stats,
  onChanged,
  onDone,
  setError,
}: {
  stats: Stats;
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
        void speak(e.shiftKey && revealed ? card.definition : card.term).catch((err) => {
          setError((err as Error).message);
        });
        return;
      }
      if ((e.key === 'e' || e.key === 'E') && revealed && card.example) {
        e.preventDefault();
        void speak(card.example).catch((err) => {
          setError((err as Error).message);
        });
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
  }, [card, loading, grading, revealed, grade, setError]);

  if (loading && !card) return <div className="card review-empty">載入中…</div>;

  if (!card) {
    const capped = stats.newLeft > 0 && stats.introducedToday >= stats.newCardsPerDay;
    return (
      <div className="card review-empty">
        <div className="review-emoji" aria-hidden>
          {capped ? '☕' : '🎉'}
        </div>
        <h2>{capped ? '今天的新字已經學完了' : sessionReviews > 0 ? '這輪複習完成了' : '目前沒有到期卡片'}</h2>
        <p>
          {sessionReviews > 0
            ? `這次複習了 ${sessionReviews} 張卡片。`
            : capped
              ? `每日新字上限是 ${stats.newCardsPerDay} 個，字庫還有 ${stats.newLeft} 張明天再學。`
              : '到期的卡片會依間隔重複排程再出現。'}
        </p>
        <button className="primary" onClick={onDone}>
          回到字庫
        </button>
      </div>
    );
  }

  const remaining = Math.max(stats.due, 1);

  return (
    <div className="review">
      <div className="session-bar" aria-live="polite">
        <span>
          {remaining} 張待複習 · 這次已複習 {sessionReviews} 張
        </span>
        <span className="muted shortcut-hint">空白鍵翻面 · P 單字 · E 例句 · 1–4 評分</span>
      </div>

      <div className={`flashcard ${revealed ? 'revealed' : ''}`} onClick={() => setRevealed(true)}>
        <div className="flashcard-term-row">
          <div className="flashcard-term">{card.term}</div>
          <SpeakButton text={card.term} label={`朗讀 ${card.term}`} className="speak-lg" onError={setError} />
        </div>
        {card.starRating > 0 && (
          <div className="flashcard-meta">
            {card.starRating}★
            {card.scoreRange ? ` · ${card.scoreRange}` : ''}
            {card.category ? ` · ${card.category}` : ''}
          </div>
        )}
        {revealed ? (
          <div className="flashcard-back">
            <div className="flashcard-def-row">
              <div className="flashcard-def">{card.definition}</div>
              <SpeakButton text={card.definition} label="朗讀定義" onError={setError} />
            </div>
            {card.example && (
              <div className="flashcard-example-row">
                <div className="flashcard-example">{card.example}</div>
                <SpeakButton text={card.example} label="朗讀英文例句" onError={setError} />
              </div>
            )}
            {card.exampleZh && <div className="flashcard-example-zh">{card.exampleZh}</div>}
            {card.examTip && <div className="flashcard-tip">{card.examTip}</div>}
          </div>
        ) : (
          <div className="flashcard-hint">點擊看中文定義與雙語例句</div>
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
          顯示答案
        </button>
      )}
    </div>
  );
}

function SpeakButton({
  text,
  label,
  className = '',
  onError,
}: {
  text: string;
  label: string;
  className?: string;
  onError?: (m: string | null) => void;
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
    void speak(text).catch((err) => {
      onError?.((err as Error).message);
    });
  };

  return (
    <button
      type="button"
      className={`speak ${speaking ? 'active' : ''} ${className}`.trim()}
      onClick={toggle}
      disabled={!supported}
      aria-label={speaking ? '停止朗讀' : label}
      title={supported ? (speaking ? '停止' : '播放發音') : '這個瀏覽器不支援語音朗讀'}
    >
      {speaking ? '◼' : '🔊'}
    </button>
  );
}

function dueLabel(dueAt: number): string {
  const diff = dueAt - Date.now();
  if (diff <= 0) return '待複習';
  const minutes = Math.round(diff / (60 * 1000));
  if (minutes < 60) return minutes <= 1 ? '1 分鐘後' : `${minutes} 分鐘後`;
  const hours = Math.round(diff / (60 * 60 * 1000));
  if (hours < 24) return hours === 1 ? '1 小時後' : `${hours} 小時後`;
  const days = Math.round(diff / (24 * 60 * 60 * 1000));
  if (days === 1) return '1 天後';
  return `${days} 天後`;
}

function intervalLabel(intervals: GradeIntervals | undefined, grade: Grade): string {
  const days = intervals?.[grade];
  if (days == null) return '';
  if (days <= 0) return '即將';
  if (days === 1) return '1 天';
  return `${days} 天`;
}
