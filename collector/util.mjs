// Shared helpers for the collector.

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function getJSON(url, { timeout = 20000, headers = {} } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: 'application/json', 'user-agent': 'jobfinder-collector', ...headers },
    });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} for ${url.replace(/app_key=[^&]+/, 'app_key=***')}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Run async tasks with a concurrency cap; returns results in input order.
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = { ok: true, value: await fn(items[i], i) };
      } catch (error) {
        out[i] = { ok: false, error };
      }
    }
  });
  await Promise.all(workers);
  return out;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…', bull: '•' };

export function decodeEntities(s) {
  return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

export function htmlToText(html) {
  // Greenhouse double-escapes its HTML, so decode first, then strip.
  let s = decodeEntities(decodeEntities(html));
  s = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ');
  s = s.replace(/<\s*(br|\/p|\/li|\/h\d|\/div)\s*\/?>/gi, '\n');
  s = s.replace(/<li[^>]*>/gi, '\n• ');
  s = s.replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  return s.replace(/[ \t ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

export function slugCandidates(name) {
  const base = String(name || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/\b(inc|llc|ltd|corp|corporation|co|company|gmbh|plc|group|holdings|the)\b\.?/g, '')
    .trim();
  const words = base.split(/[^a-z0-9]+/).filter(Boolean);
  if (!words.length) return [];
  const set = new Set([words.join(''), words.join('-'), words[0]]);
  return [...set].filter((s) => s.length >= 3);
}

// Small stable hash for job ids.
export function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export const toISO = (v) => {
  if (v == null || v === '') return null;
  const d = typeof v === 'number' ? new Date(v) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
