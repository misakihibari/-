// 通知時刻の計算(純粋関数)。繰り返しは reminder.tz のローカル時刻で解釈する。
const MIN = 60000;

const fmtCache = new Map();
function formatter(tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export function isValidTz(tz) {
  try { formatter(tz); return true; } catch { return false; }
}

/** UTCミリ秒 → tz のローカル年月日時分 */
export function tzParts(ms, tz) {
  const o = {};
  for (const p of formatter(tz).formatToParts(new Date(ms))) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour, mi: +o.minute };
}

function offsetAt(ms, tz) {
  const t = Math.floor(ms / MIN) * MIN;
  const p = tzParts(t, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi) - t;
}

/** tz のローカル日時 → UTCミリ秒 */
export function zonedToUtc(y, m, d, h, mi, tz) {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let t = guess - offsetAt(guess, tz);
  t = guess - offsetAt(t, tz);
  return t;
}

export function intervalMs(repeat) {
  const e = repeat.every || {};
  return ((+e.hours || 0) * 60 + (+e.minutes || 0)) * MIN;
}

/**
 * 次回の通知時刻(UTCミリ秒)。なければ null。
 * inclusive=true なら after ちょうども含む。
 */
export function nextOccurrence(r, after, inclusive = false) {
  const start = Date.parse(r.startAt);
  const ok = (t) => (inclusive ? t >= after : t > after);
  const type = r.repeat?.type || 'none';

  if (type === 'none') return ok(start) ? start : null;

  if (type === 'interval') {
    const step = intervalMs(r.repeat);
    if (step < MIN) return null;
    if (ok(start)) return start;
    let t = start + Math.ceil((after - start) / step) * step;
    if (!ok(t)) t += step;
    return t;
  }

  if (type === 'daily' || type === 'weekly') {
    const days = type === 'weekly' ? r.repeat.days || [] : null;
    if (type === 'weekly' && days.length === 0) return null;
    const tod = tzParts(start, r.tz);
    const base = tzParts(Math.max(after, start), r.tz);
    for (let i = 0; i < 400; i++) {
      const dt = new Date(Date.UTC(base.y, base.m - 1, base.d + i));
      if (days && !days.includes(dt.getUTCDay())) continue;
      const cand = zonedToUtc(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate(), tod.h, tod.mi, r.tz);
      if (cand >= start && ok(cand)) return cand;
    }
  }
  return null;
}

export function validateReminderInput(b) {
  const errors = [];
  if (typeof b.title !== 'string' || !b.title.trim()) errors.push('通知内容を入力してください');
  if (typeof b.title === 'string' && b.title.length > 200) errors.push('通知内容は200文字以内にしてください');
  if (b.detail != null && (typeof b.detail !== 'string' || b.detail.length > 5000)) errors.push('詳細は5000文字以内にしてください');
  if (!b.startAt || Number.isNaN(Date.parse(b.startAt))) errors.push('通知日時が正しくありません');
  if (!b.tz || !isValidTz(b.tz)) errors.push('タイムゾーンが正しくありません');
  const rep = b.repeat || { type: 'none' };
  if (!['none', 'daily', 'weekly', 'interval'].includes(rep.type)) errors.push('繰り返し設定が正しくありません');
  if (rep.type === 'weekly') {
    const ok = Array.isArray(rep.days) && rep.days.length > 0 && rep.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6);
    if (!ok) errors.push('曜日を1つ以上選んでください');
  }
  if (rep.type === 'interval' && intervalMs(rep) < MIN) errors.push('間隔は1分以上にしてください');
  return errors;
}

export function normalizeRepeat(rep) {
  const type = rep?.type || 'none';
  if (type === 'weekly') return { type, days: [...new Set(rep.days)].sort() };
  if (type === 'interval') return { type, every: { hours: Math.floor(+rep.every?.hours || 0), minutes: Math.floor(+rep.every?.minutes || 0) } };
  return { type };
}
