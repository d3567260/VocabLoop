export interface Word {
  id: number;
  term: string;
  definition: string;
  example: string;
  repetitions: number;
  interval: number;
  ease: number;
  dueAt: number;
  reviews: number;
  createdAt: number;
}

export interface Stats {
  total: number;
  due: number;
  learned: number;
  reviews: number;
}

export type Grade = 'again' | 'hard' | 'good' | 'easy';

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const api = {
  listWords: () => fetch('/api/words').then((r) => json<Word[]>(r)),
  stats: () => fetch('/api/stats').then((r) => json<Stats>(r)),
  addWord: (input: { term: string; definition: string; example?: string }) =>
    fetch('/api/words', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }).then((r) => json<Word>(r)),
  deleteWord: (id: number) =>
    fetch(`/api/words/${id}`, { method: 'DELETE' }).then((r) => json<void>(r)),
  nextReview: () => fetch('/api/review/next').then((r) => json<Word | null>(r)),
  grade: (id: number, grade: Grade) =>
    fetch(`/api/review/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grade }),
    }).then((r) => json<Word>(r)),
  seed: () => fetch('/api/seed', { method: 'POST' }).then((r) => json<{ inserted: number }>(r)),
};
