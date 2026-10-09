import express from 'express';
import webpush from 'web-push';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './lib/store.js';
import { nextOccurrence, validateReminderInput, normalizeRepeat } from './lib/schedule.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const ACCESS_KEY = process.env.ACCESS_KEY || '';
const TICK_MS = 15000;

const store = new Store(DATA_DIR);

// VAPIDキー: 環境変数 → data/vapid.json → 初回起動時に自動生成
function loadVapid() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  }
  const f = path.join(DATA_DIR, 'vapid.json');
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const keys = webpush.generateVAPIDKeys();
  fs.writeFileSync(f, JSON.stringify(keys), { mode: 0o600 });
  return keys;
}
const vapid = loadVapid();
webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@example.com', vapid.publicKey, vapid.privateKey);

const app = express();
app.use(express.json({ limit: '100kb' }));

app.get('/api/config', (req, res) => res.json({ vapidPublicKey: vapid.publicKey, authRequired: !!ACCESS_KEY }));

// ACCESS_KEY が設定されていれば、他のAPIは x-access-key ヘッダが必須
app.use('/api', (req, res, next) => {
  if (!ACCESS_KEY) return next();
  const got = Buffer.from(String(req.get('x-access-key') || ''));
  const want = Buffer.from(ACCESS_KEY);
  if (got.length === want.length && crypto.timingSafeEqual(got, want)) return next();
  res.status(401).json({ error: 'アクセスキーが正しくありません' });
});

const db = store.data;
const newId = () => crypto.randomUUID();
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

function view(r) {
  const repeating = r.repeat.type !== 'none';
  const status = repeating ? 'repeat' : r.nextAt ? 'pending' : 'done';
  return { ...r, status };
}

// ---- ジャンル ----
function genreInput(b) {
  const name = String(b.name || '').trim();
  const icon = String(b.icon || '').trim() || '🔔';
  const color = String(b.color || '');
  if (!name || name.length > 30) return { error: 'ジャンル名は1〜30文字で入力してください' };
  if (icon.length > 16) return { error: 'アイコンは絵文字1〜2文字程度にしてください' };
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return { error: 'カラーが正しくありません' };
  return { value: { name, icon, color: color.toLowerCase() } };
}

app.get('/api/genres', (req, res) => res.json(db.genres));
app.post('/api/genres', (req, res) => {
  const { error, value } = genreInput(req.body);
  if (error) return bad(res, error);
  const g = { id: newId(), ...value };
  db.genres.push(g);
  store.save();
  res.status(201).json(g);
});
app.put('/api/genres/:id', (req, res) => {
  const g = db.genres.find((x) => x.id === req.params.id);
  if (!g) return bad(res, 'ジャンルが見つかりません', 404);
  const { error, value } = genreInput(req.body);
  if (error) return bad(res, error);
  Object.assign(g, value);
  store.save();
  res.json(g);
});
app.delete('/api/genres/:id', (req, res) => {
  const i = db.genres.findIndex((x) => x.id === req.params.id);
  if (i < 0) return bad(res, 'ジャンルが見つかりません', 404);
  db.genres.splice(i, 1);
  for (const r of db.reminders) if (r.genreId === req.params.id) r.genreId = null; // 未分類へ
  store.save();
  res.json({ ok: true });
});

// ---- 通知(リマインダー) ----
function buildReminder(b, prev) {
  const repeat = normalizeRepeat(b.repeat);
  const r = {
    id: prev?.id || newId(),
    title: b.title.trim(),
    detail: (b.detail || '').trim(),
    genreId: db.genres.some((g) => g.id === b.genreId) ? b.genreId : null,
    startAt: new Date(b.startAt).toISOString(),
    tz: b.tz,
    repeat,
    lastFiredAt: prev?.lastFiredAt || null,
    fireCount: prev?.fireCount || 0,
    createdAt: prev?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const unchangedDoneOneOff =
    prev && repeat.type === 'none' && prev.repeat.type === 'none' && prev.nextAt === null && prev.lastFiredAt && prev.startAt === r.startAt;
  if (unchangedDoneOneOff) r.nextAt = null; // 通知済みの単発を内容だけ編集しても再通知しない
  else {
    const n = nextOccurrence(r, Date.now(), true);
    r.nextAt = n == null ? null : new Date(n).toISOString();
  }
  return r;
}

app.get('/api/reminders', (req, res) => res.json(db.reminders.map(view)));
app.post('/api/reminders', (req, res) => {
  const errors = validateReminderInput(req.body);
  if (errors.length) return bad(res, errors.join('\n'));
  const r = buildReminder(req.body);
  db.reminders.push(r);
  store.save();
  res.status(201).json(view(r));
});
app.put('/api/reminders/:id', (req, res) => {
  const i = db.reminders.findIndex((x) => x.id === req.params.id);
  if (i < 0) return bad(res, '通知が見つかりません', 404);
  const errors = validateReminderInput(req.body);
  if (errors.length) return bad(res, errors.join('\n'));
  db.reminders[i] = buildReminder(req.body, db.reminders[i]);
  store.save();
  res.json(view(db.reminders[i]));
});
app.delete('/api/reminders/:id', (req, res) => {
  const i = db.reminders.findIndex((x) => x.id === req.params.id);
  if (i < 0) return bad(res, '通知が見つかりません', 404);
  db.reminders.splice(i, 1);
  store.save();
  res.json({ ok: true });
});

// ---- プッシュ購読 ----
app.post('/api/subscribe', (req, res) => {
  const s = req.body?.subscription;
  if (!s?.endpoint || !s?.keys?.p256dh || !s?.keys?.auth) return bad(res, '購読情報が正しくありません');
  if (!/^https:\/\//.test(s.endpoint)) return bad(res, '購読情報が正しくありません');
  const i = db.subscriptions.findIndex((x) => x.endpoint === s.endpoint);
  const rec = { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth }, createdAt: new Date().toISOString() };
  if (i >= 0) db.subscriptions[i] = rec;
  else db.subscriptions.push(rec);
  store.save();
  res.json({ ok: true });
});
app.post('/api/unsubscribe', (req, res) => {
  const ep = req.body?.endpoint;
  db.subscriptions = db.subscriptions.filter((x) => x.endpoint !== ep);
  store.save();
  res.json({ ok: true });
});
app.post('/api/test-push', async (req, res) => {
  const sent = await pushAll({ title: '🔔 テスト通知', body: '通知は正常に届いています', tag: 'test-' + Date.now(), url: '/' });
  res.json({ sent });
});

// ---- 送信とスケジューラ ----
async function pushAll(payload) {
  const body = JSON.stringify(payload);
  const dead = new Set();
  let sent = 0;
  await Promise.all(
    db.subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, body, { TTL: 60 * 60 * 24, urgency: 'high' });
        sent++;
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) dead.add(sub.endpoint);
        else console.error('push failed', e.statusCode || e.message);
      }
    }),
  );
  if (dead.size) {
    db.subscriptions = db.subscriptions.filter((s) => !dead.has(s.endpoint));
    store.save();
  }
  return sent;
}

function payloadFor(r) {
  const g = db.genres.find((x) => x.id === r.genreId);
  const firstLine = r.detail.split('\n')[0].slice(0, 120);
  return {
    title: `${g ? g.icon + ' ' : '🔔 '}${r.title}`,
    body: firstLine || (g ? g.name : ''),
    // 毎回ユニークなtag → 前回の通知を置き換えず、スワイプされるまで残る
    tag: `${r.id}-${Date.now()}`,
    url: `/?id=${r.id}`,
  };
}

let ticking = false;
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const now = Date.now();
    for (const r of db.reminders) {
      if (!r.nextAt || Date.parse(r.nextAt) > now) continue;
      const n = nextOccurrence(r, now, false); // 停止中に溜まった分はまとめて1回だけ通知
      r.nextAt = n == null ? null : new Date(n).toISOString();
      r.lastFiredAt = new Date(now).toISOString();
      r.fireCount++;
      store.save(); // 送信前に確定させ、二重通知を避ける
      await pushAll(payloadFor(r));
    }
  } catch (e) {
    console.error('tick error', e);
  } finally {
    ticking = false;
  }
}

app.use(express.static(path.join(__dirname, 'public'), { setHeaders: (res, p) => p.endsWith('sw.js') && res.set('Cache-Control', 'no-cache') }));

app.listen(PORT, () => {
  console.log(`notify-memo listening on http://localhost:${PORT}`);
  setInterval(tick, TICK_MS);
  tick();
});
