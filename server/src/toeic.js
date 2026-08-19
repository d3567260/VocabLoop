import { mkdirSync, existsSync } from 'node:fs';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const HF_DATASET = 'kknono668/toeic-vocab-tw';
export const HF_JSON_URL =
  'https://huggingface.co/datasets/kknono668/toeic-vocab-tw/resolve/main/data/toeic_vocabulary.json';
export const SCORE_RANGES = ['0-400', '400-600', '600-780', '780-900', '900+'];
export const DEFAULT_FILTERS = {
  scoreRange: '0-400',
  minStar: 5,
  category: '',
};
export const NEW_CARDS_PER_DAY = 15;

const DEFAULT_CACHE_PATH = join(__dirname, '..', 'data', 'toeic_vocabulary.json');

let memoryCache = null;
let pendingLoad = null;

export function resetToeicCache() {
  memoryCache = null;
  pendingLoad = null;
}

export function cachePath() {
  return process.env.VOCABLOOP_TOEIC_CACHE || DEFAULT_CACHE_PATH;
}

export function parseFilters(input = {}) {
  const rawRange = input.scoreRange;
  const scoreRange =
    rawRange === undefined || rawRange === null || rawRange === ''
      ? DEFAULT_FILTERS.scoreRange
      : String(rawRange);
  const rawStar = input.minStar;
  const minStar =
    rawStar === undefined || rawStar === null || rawStar === ''
      ? DEFAULT_FILTERS.minStar
      : Number(rawStar);
  const category = input.category == null ? DEFAULT_FILTERS.category : String(input.category).trim();
  const limitRaw = input.limit;
  const limit =
    limitRaw === undefined || limitRaw === null || limitRaw === ''
      ? null
      : Math.max(0, Number(limitRaw));

  return {
    scoreRange: scoreRange === 'all' ? 'all' : scoreRange,
    minStar: Number.isFinite(minStar) ? minStar : DEFAULT_FILTERS.minStar,
    category,
    limit: Number.isFinite(limit) ? limit : null,
  };
}

export function filterCatalog(rows, filters = {}) {
  const { scoreRange, minStar, category } = parseFilters(filters);
  return rows.filter((row) => {
    if (scoreRange && scoreRange !== 'all' && row.toeic_score_range !== scoreRange) return false;
    if (minStar > 0 && Number(row.star_rating) < minStar) return false;
    if (category && row.category !== category) return false;
    return true;
  });
}

export function mapToeicEntry(row) {
  const examples = Array.isArray(row.examples) ? row.examples : [];
  const example = examples.find((item) => item && (item.english || item.chinese)) ?? {};
  const tips = Array.isArray(row.exam_tips) ? row.exam_tips.filter(Boolean) : [];
  return {
    term: String(row.english_word ?? '').trim(),
    definition: String(row.chinese_definition ?? '').trim(),
    example: String(example.english ?? '').trim(),
    exampleZh: String(example.chinese ?? '').trim(),
    category: String(row.category ?? '').trim(),
    scoreRange: String(row.toeic_score_range ?? '').trim(),
    starRating: Number(row.star_rating) || 0,
    examTip: String(tips[0] ?? '').trim(),
  };
}

export function catalogMeta(rows) {
  const scoreRanges = [...new Set(rows.map((row) => row.toeic_score_range).filter(Boolean))];
  const categories = [...new Set(rows.map((row) => row.category).filter(Boolean))];
  scoreRanges.sort((a, b) => SCORE_RANGES.indexOf(a) - SCORE_RANGES.indexOf(b) || a.localeCompare(b, 'zh-Hant'));
  categories.sort((a, b) => a.localeCompare(b, 'zh-Hant'));
  return { scoreRanges: scoreRanges.length ? scoreRanges : [...SCORE_RANGES], categories };
}

export function selectImports(rows, existingTerms, limit = null) {
  const seen = new Set(
    [...existingTerms].map((term) => String(term).trim().toLowerCase()).filter(Boolean)
  );
  const selected = [];
  for (const row of rows) {
    const word = mapToeicEntry(row);
    if (!word.term || !word.definition) continue;
    const key = word.term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push(word);
    if (limit != null && selected.length >= limit) break;
  }
  return selected;
}

async function readJsonArray(path) {
  const parsed = JSON.parse(await readFile(path, 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new Error('TOEIC catalog is not a JSON array');
  }
  return parsed;
}

async function downloadCatalog(url, dest, fetchImpl) {
  const res = await fetchImpl(url, {
    headers: { 'User-Agent': 'vocabloop-toeic-import/1.0', Accept: 'application/json' },
    redirect: 'follow',
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    throw new Error(`Hugging Face returned ${res.status}`);
  }
  const parsed = await res.json();
  if (!Array.isArray(parsed)) {
    throw new Error('TOEIC catalog is not a JSON array');
  }
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(parsed));
  await rename(tmp, dest);
  return parsed;
}

/**
 * Load the TOEIC catalog (memory → disk cache → Hugging Face).
 * Tests can inject a fixture with VOCABLOOP_TOEIC_PATH or options.
 */
export async function loadToeicCatalog(options = {}) {
  if (memoryCache) return memoryCache;
  if (pendingLoad) return pendingLoad;

  pendingLoad = (async () => {
    const sourcePath = options.sourcePath ?? process.env.VOCABLOOP_TOEIC_PATH;
    if (sourcePath) {
      memoryCache = await readJsonArray(sourcePath);
      return memoryCache;
    }
    const dest = options.cachePath ?? cachePath();
    if (existsSync(dest)) {
      memoryCache = await readJsonArray(dest);
      return memoryCache;
    }
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    memoryCache = await downloadCatalog(options.url ?? HF_JSON_URL, dest, fetchImpl);
    return memoryCache;
  })();

  try {
    return await pendingLoad;
  } finally {
    pendingLoad = null;
  }
}
