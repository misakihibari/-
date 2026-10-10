import test from 'node:test';
import assert from 'node:assert/strict';
import { nextOccurrence, zonedToUtc, validateReminderInput } from '../lib/schedule.js';

const TZ = 'Asia/Tokyo';
const jst = (y, m, d, h, mi) => zonedToUtc(y, m, d, h, mi, TZ);
const base = (over) => ({ startAt: new Date(jst(2026, 10, 9, 9, 30)).toISOString(), tz: TZ, repeat: { type: 'none' }, ...over });

test('zonedToUtc: JST は UTC+9', () => {
  assert.equal(new Date(jst(2026, 10, 9, 9, 30)).toISOString(), '2026-10-09T00:30:00.000Z');
});

test('単発: 未来は開始時刻、過去は null', () => {
  const r = base();
  assert.equal(nextOccurrence(r, jst(2026, 10, 9, 0, 0), true), jst(2026, 10, 9, 9, 30));
  assert.equal(nextOccurrence(r, jst(2026, 10, 9, 9, 30), false), null);
});

test('毎日: 通知後は翌日同時刻', () => {
  const r = base({ repeat: { type: 'daily' } });
  assert.equal(nextOccurrence(r, jst(2026, 10, 9, 9, 30), false), jst(2026, 10, 10, 9, 30));
  assert.equal(nextOccurrence(r, jst(2026, 10, 9, 8, 0), false), jst(2026, 10, 9, 9, 30));
  assert.equal(nextOccurrence(r, jst(2026, 12, 31, 23, 0), false), jst(2027, 1, 1, 9, 30));
});

test('毎日: 開始日より前には発火しない', () => {
  const r = base({ repeat: { type: 'daily' } });
  assert.equal(nextOccurrence(r, jst(2026, 10, 1, 0, 0), true), jst(2026, 10, 9, 9, 30));
});

test('曜日指定: 2026-10-09 は金曜。月・水なら次は月曜 10/12', () => {
  const r = base({ repeat: { type: 'weekly', days: [1, 3] } });
  assert.equal(nextOccurrence(r, jst(2026, 10, 9, 9, 30), true), jst(2026, 10, 12, 9, 30));
  assert.equal(nextOccurrence(r, jst(2026, 10, 12, 9, 30), false), jst(2026, 10, 14, 9, 30));
});

test('間隔: 90分おきはグリッド上の次の時刻', () => {
  const r = base({ repeat: { type: 'interval', every: { hours: 1, minutes: 30 } } });
  const s = jst(2026, 10, 9, 9, 30);
  assert.equal(nextOccurrence(r, s, false), s + 90 * 60000);
  assert.equal(nextOccurrence(r, s + 100 * 60000, false), s + 180 * 60000);
  assert.equal(nextOccurrence(r, s - 1000, true), s);
});

test('夏時間のある地域でもローカル時刻を維持する', () => {
  const ny = 'America/New_York';
  const r = { startAt: new Date(zonedToUtc(2026, 3, 7, 9, 0, ny)).toISOString(), tz: ny, repeat: { type: 'daily' } };
  const next = nextOccurrence(r, zonedToUtc(2026, 3, 8, 9, 0, ny), false); // 3/8 は夏時間開始日
  assert.equal(next, zonedToUtc(2026, 3, 9, 9, 0, ny));
  assert.equal(new Date(zonedToUtc(2026, 3, 9, 9, 0, ny)).toISOString(), '2026-03-09T13:00:00.000Z');
});

test('入力検証', () => {
  const ok = { title: 'a', startAt: new Date().toISOString(), tz: TZ, repeat: { type: 'none' } };
  assert.deepEqual(validateReminderInput(ok), []);
  assert.ok(validateReminderInput({ ...ok, title: ' ' }).length);
  assert.ok(validateReminderInput({ ...ok, repeat: { type: 'weekly', days: [] } }).length);
  assert.ok(validateReminderInput({ ...ok, repeat: { type: 'interval', every: { hours: 0, minutes: 0 } } }).length);
  assert.ok(validateReminderInput({ ...ok, tz: 'Nope/Zone' }).length);
});
