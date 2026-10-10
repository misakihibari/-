const $ = (s) => document.querySelector(s);
const state = { genres: [], reminders: [], tab: 'date', authRequired: false };
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
const DOW = ['日', '月', '火', '水', '木', '金', '土'];
const ICONS = ['💼', '🏠', '💊', '🛒', '📞', '📚', '🏃', '🍽️', '🎂', '💰', '✈️', '🐶', '🎵', '🔔', '⭐', '❤️'];

// ---------- helpers ----------
function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') e.className = v;
    else if (k === 'style') e.setAttribute('style', v);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
}
const pad = (n) => String(n).padStart(2, '0');
const toLocalInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fmtTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fmtFull = (d) => `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日(${DOW[d.getDay()]}) ${fmtTime(d)}`;
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function dayLabel(d) {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - t) / 864e5);
  const tag = { '-1': '昨日', 0: '今日', 1: '明日' }[diff];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日(${DOW[d.getDay()]})${tag ? ' ・' + tag : ''}`;
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2600);
}

async function api(path, opts = {}) {
  const key = localStorage.getItem('accessKey') || '';
  const res = await fetch('/api' + path, {
    ...opts,
    headers: { 'content-type': 'application/json', 'x-access-key': key, ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401 && state.authRequired) {
    const k = prompt('アクセスキーを入力してください');
    if (k == null) throw new Error('アクセスキーが必要です');
    localStorage.setItem('accessKey', k);
    return api(path, opts);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `エラー (${res.status})`);
  return data;
}

const genreOf = (id) => state.genres.find((g) => g.id === id) || { id: null, name: '未分類', icon: '🔔', color: '#8a90a2' };
const displayTime = (r) => new Date(r.nextAt || r.lastFiredAt || r.startAt);
function repeatText(r) {
  const p = r.repeat;
  if (p.type === 'daily') return '毎日';
  if (p.type === 'weekly') return '毎週 ' + p.days.map((d) => DOW[d]).join('・');
  if (p.type === 'interval') {
    const { hours, minutes } = p.every;
    return (hours ? `${hours}時間` : '') + (minutes ? `${minutes}分` : '') + 'おき';
  }
  return '';
}

// ---------- data ----------
async function load() {
  [state.genres, state.reminders] = await Promise.all([api('/genres'), api('/reminders')]);
  render();
}

// ---------- list views ----------
function card(r) {
  const g = genreOf(r.genreId);
  const when = r.status === 'repeat'
    ? `🔁 ${repeatText(r)} ・ 次回 ${r.nextAt ? fmtFull(new Date(r.nextAt)) : '-'}`
    : r.status === 'done' ? `✅ 通知済み ${fmtFull(new Date(r.lastFiredAt))}` : `⏰ ${fmtFull(new Date(r.nextAt))}`;
  return h('button', { class: `card ${r.status}`, style: `--c:${g.color}`, onclick: () => showDetail(r.id) },
    h('div', { class: 't' }, `${g.icon} ${r.title}`),
    h('div', { class: 'm' }, `${g.name} ・ ${when}`));
}

function legend() {
  return h('div', { class: 'legend' },
    h('span', {}, h('i', {}), '未通知(枠のみ)'),
    h('span', {}, h('i', { style: 'background:color-mix(in srgb,#888 50%,transparent)' }), '通知済み(50%)'),
    h('span', {}, h('i', { style: 'background:color-mix(in srgb,#888 70%,transparent)' }), '繰り返し(70%)'));
}

function groupBy(items, keyFn) {
  const m = new Map();
  for (const it of items) { const k = keyFn(it); if (!m.has(k)) m.set(k, []); m.get(k).push(it); }
  return m;
}

function renderDate() {
  const sorted = [...state.reminders].sort((a, b) => displayTime(a) - displayTime(b));
  const groups = groupBy(sorted, (r) => dayKey(displayTime(r)));
  const out = [legend()];
  for (const [, items] of groups) out.push(h('h2', { class: 'grp' }, dayLabel(displayTime(items[0]))), ...items.map(card));
  return out;
}

function renderGenre() {
  const sorted = [...state.reminders].sort((a, b) => displayTime(a) - displayTime(b));
  const groups = groupBy(sorted, (r) => genreOf(r.genreId).id ?? '_none');
  const out = [legend()];
  const order = [...state.genres.map((g) => g.id), '_none'];
  for (const gid of order) {
    const items = groups.get(gid);
    if (!items) continue;
    const g = genreOf(items[0].genreId);
    out.push(h('h2', { class: 'grp' }, `${g.icon} ${g.name} (${items.length})`), ...items.map(card));
  }
  return out;
}

function renderGenres() {
  const out = state.genres.map((g) =>
    h('div', { class: 'gl', style: `--c:${g.color}` },
      h('span', { class: 'ic' }, g.icon), h('span', { class: 'nm' }, g.name),
      h('button', { onclick: () => genreDialog(g) }, '編集')));
  out.push(h('button', { class: 'btn-add', onclick: () => genreDialog() }, '＋ ジャンルを追加'));
  return out;
}

function render() {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === state.tab));
  const main = $('#main');
  main.replaceChildren();
  const body = state.tab === 'genres' ? renderGenres()
    : state.reminders.length ? (state.tab === 'date' ? renderDate() : renderGenre())
    : [h('div', { class: 'empty' }, '通知はまだありません。右下の＋から登録できます。')];
  main.append(...body);
}

// ---------- dialogs ----------
const dlg = $('#dlg');
function openDlg(...kids) { dlg.replaceChildren(h('div', { class: 'dlg' }, ...kids)); if (!dlg.open) dlg.showModal(); }
function closeDlg() { if (dlg.open) dlg.close(); }
dlg.addEventListener('click', (e) => { if (e.target === dlg) closeDlg(); });

function showDetail(id) {
  const r = state.reminders.find((x) => x.id === id);
  if (!r) return toast('この通知は見つかりませんでした');
  const g = genreOf(r.genreId);
  openDlg(
    h('div', { class: 'bar', style: `--c:${g.color}` }, h('h3', {}, `${g.icon} ${r.title}`), h('div', { class: 'kv' }, g.name)),
    r.detail ? h('div', { class: 'detail' }, r.detail) : h('div', { class: 'kv' }, '(詳細なし)'),
    h('div', { class: 'kv' }, `通知日時: ${fmtFull(new Date(r.startAt))}`),
    r.status === 'repeat' && h('div', { class: 'kv' }, `繰り返し: ${repeatText(r)} ・ 次回 ${r.nextAt ? fmtFull(new Date(r.nextAt)) : '-'}`),
    r.lastFiredAt && h('div', { class: 'kv' }, `最終通知: ${fmtFull(new Date(r.lastFiredAt))}(${r.fireCount}回)`),
    h('div', { class: 'actions' },
      h('button', { class: 'del', onclick: () => removeReminder(r) }, '削除'),
      h('button', { onclick: () => reminderForm(r) }, '編集'),
      h('button', { class: 'pri', onclick: closeDlg }, '閉じる')));
}

async function removeReminder(r) {
  if (!confirm(`「${r.title}」を削除しますか?`)) return;
  try { await api('/reminders/' + r.id, { method: 'DELETE' }); closeDlg(); await load(); toast('削除しました'); } catch (e) { toast(e.message); }
}

function genreFields(g = {}) {
  const name = h('input', { type: 'text', maxlength: 30, value: g.name || '', placeholder: '例: 仕事' });
  const icon = h('input', { type: 'text', maxlength: 8, value: g.icon || '🔔' });
  const color = h('input', { type: 'color', value: g.color || '#4f6df5' });
  const el = h('div', {},
    h('label', { class: 'f' }, 'ジャンル名'), name,
    h('label', { class: 'f' }, 'アイコン(絵文字を入力 / 下から選択)'), icon,
    h('div', { class: 'picks' }, ICONS.map((i) => h('button', { type: 'button', onclick: () => (icon.value = i) }, i))),
    h('label', { class: 'f' }, 'カラー(通知の枠の色)'), color);
  return { el, get: () => ({ name: name.value, icon: icon.value, color: color.value }) };
}

function genreDialog(g) {
  const f = genreFields(g);
  openDlg(h('h3', {}, g ? 'ジャンルを編集' : 'ジャンルを追加'), f.el,
    h('div', { class: 'actions' },
      g && h('button', { class: 'del', onclick: async () => {
        if (!confirm(`ジャンル「${g.name}」を削除しますか?(この通知は未分類になります)`)) return;
        try { await api('/genres/' + g.id, { method: 'DELETE' }); closeDlg(); await load(); } catch (e) { toast(e.message); }
      } }, '削除'),
      h('button', { onclick: closeDlg }, 'キャンセル'),
      h('button', { class: 'pri', onclick: async () => {
        try {
          await api(g ? '/genres/' + g.id : '/genres', { method: g ? 'PUT' : 'POST', body: f.get() });
          closeDlg(); await load(); toast('保存しました');
        } catch (e) { toast(e.message); }
      } }, '保存')));
}

function reminderForm(r) {
  const editing = !!r;
  const start = r ? new Date(r.startAt) : (() => { const d = new Date(Date.now() + 36e5); d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0); return d; })();
  const rep = r?.repeat || { type: 'none' };

  const title = h('input', { type: 'text', maxlength: 200, value: r?.title || '', placeholder: '通知に表示する内容' });
  const detail = h('textarea', { maxlength: 5000, placeholder: 'この通知についての詳細(通知をタップすると確認できます)' }, r?.detail || '');
  const when = h('input', { type: 'datetime-local', value: toLocalInput(start) });
  const genre = h('select', {});
  const fillGenres = (sel) => genre.replaceChildren(h('option', { value: '' }, '未分類'), ...state.genres.map((g) => h('option', { value: g.id, selected: g.id === sel }, `${g.icon} ${g.name}`)));
  fillGenres(r?.genreId);

  const type = h('select', {}, [['none', '繰り返さない'], ['daily', '毎日'], ['weekly', '曜日を指定'], ['interval', '○時間・○分おき']].map(([v, l]) => h('option', { value: v, selected: v === rep.type }, l)));
  const days = h('div', { class: 'days' }, DOW.map((d, i) => h('label', {}, h('input', { type: 'checkbox', value: i, checked: rep.days?.includes(i) }), h('span', {}, d))));
  const hh = h('input', { type: 'number', min: 0, max: 999, value: rep.every?.hours ?? 1 });
  const mm = h('input', { type: 'number', min: 0, max: 59, value: rep.every?.minutes ?? 0 });
  const every = h('div', { class: 'row' }, hh, h('span', {}, '時間'), mm, h('span', {}, '分おき'));
  const sync = () => { days.hidden = type.value !== 'weekly'; every.hidden = type.value !== 'interval'; };
  type.addEventListener('change', sync); sync();

  let newGenre = null;
  const newGenreBox = h('div', { hidden: true });
  const addGenreBtn = h('button', { type: 'button', class: 'chip', onclick: () => {
    if (!newGenre) {
      newGenre = genreFields();
      newGenreBox.append(newGenre.el, h('div', { class: 'actions' }, h('button', { type: 'button', class: 'pri', onclick: async () => {
        try {
          const g = await api('/genres', { method: 'POST', body: newGenre.get() });
          state.genres.push(g); fillGenres(g.id); newGenreBox.hidden = true; newGenreBox.replaceChildren(); newGenre = null; toast('ジャンルを追加しました');
        } catch (e) { toast(e.message); }
      } }, 'このジャンルを追加')));
    }
    newGenreBox.hidden = !newGenreBox.hidden;
  } }, '＋ 新しいジャンル');

  const save = async () => {
    const body = {
      title: title.value, detail: detail.value, genreId: genre.value || null, tz,
      startAt: when.value ? new Date(when.value).toISOString() : '',
      repeat: type.value === 'weekly' ? { type: 'weekly', days: [...days.querySelectorAll('input:checked')].map((i) => +i.value) }
        : type.value === 'interval' ? { type: 'interval', every: { hours: +hh.value || 0, minutes: +mm.value || 0 } }
        : { type: type.value },
    };
    if (body.repeat.type === 'none' && body.startAt && new Date(body.startAt) < new Date() && !confirm('過去の日時です。保存するとすぐに通知されます。よろしいですか?')) return;
    try {
      await api(editing ? '/reminders/' + r.id : '/reminders', { method: editing ? 'PUT' : 'POST', body });
      closeDlg(); await load(); toast(editing ? '更新しました' : '登録しました');
    } catch (e) { toast(e.message); }
  };

  openDlg(h('h3', {}, editing ? '通知を編集' : '通知を登録'),
    h('label', { class: 'f' }, '通知内容'), title,
    h('label', { class: 'f' }, '詳細'), detail,
    h('label', { class: 'f' }, 'ジャンル'), h('div', { class: 'row' }, genre, addGenreBtn), newGenreBox,
    h('label', { class: 'f' }, '通知日時(繰り返しの場合は開始日時)'), when,
    h('label', { class: 'f' }, '繰り返し'), type, days, every,
    h('div', { class: 'actions' },
      editing && h('button', { class: 'del', onclick: () => removeReminder(r) }, '削除'),
      h('button', { onclick: closeDlg }, 'キャンセル'),
      h('button', { class: 'pri', onclick: save }, editing ? '更新' : '登録')));
}

// ---------- push ----------
const swReady = 'serviceWorker' in navigator ? navigator.serviceWorker.register('/sw.js') : Promise.resolve(null);
const urlB64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
let vapidKey = '';

async function subscribePush() {
  await swReady;
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64(vapidKey) });
  await api('/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
}

async function refreshPushUI() {
  const btn = $('#btn-push'), help = $('#push-help');
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  btn.hidden = true; help.hidden = true;
  if (!pushSupported()) {
    help.hidden = false;
    help.textContent = ios && !standalone
      ? 'iPhoneでは、Safariの共有ボタンから「ホーム画面に追加」し、ホーム画面のアイコンから開くと通知を受け取れます(iOS 16.4以降)。'
      : 'このブラウザはプッシュ通知に対応していません。';
    return;
  }
  btn.hidden = false;
  if (Notification.permission === 'granted') {
    await subscribePush().catch(() => {});
    btn.textContent = '通知ON ✓(タップでテスト)'; btn.className = 'chip on';
    btn.onclick = async () => {
      try { const { sent } = await api('/test-push', { method: 'POST' }); toast(sent ? 'テスト通知を送信しました' : '送信先がありません'); } catch (e) { toast(e.message); }
    };
  } else if (Notification.permission === 'denied') {
    btn.hidden = true; help.hidden = false;
    help.textContent = '通知がブロックされています。端末またはブラウザの設定で、このサイトの通知を許可してください。';
  } else {
    btn.textContent = '通知を有効にする'; btn.className = 'chip';
    btn.onclick = async () => {
      if (await Notification.requestPermission() === 'granted') { await refreshPushUI(); toast('通知を有効にしました'); } else refreshPushUI();
    };
  }
}

// ---------- boot ----------
$('#tabs').addEventListener('click', (e) => { const t = e.target.dataset?.tab; if (t) { state.tab = t; render(); } });
$('#fab').addEventListener('click', () => reminderForm());
document.addEventListener('visibilitychange', () => { if (!document.hidden) load().catch(() => {}); });

function openFromUrl(u) {
  const id = new URL(u, location.origin).searchParams.get('id');
  if (!id) return;
  history.replaceState(null, '', '/');
  load().then(() => showDetail(id)).catch((e) => toast(e.message));
}
navigator.serviceWorker?.addEventListener('message', (e) => e.data?.type === 'open' && openFromUrl(e.data.url));

(async () => {
  try {
    const cfg = await fetch('/api/config').then((r) => r.json());
    vapidKey = cfg.vapidPublicKey; state.authRequired = cfg.authRequired;
    await load();
    openFromUrl(location.href);
  } catch (e) { toast(e.message); }
  refreshPushUI();
})();
