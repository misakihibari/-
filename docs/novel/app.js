'use strict';
/* おはなし帳 — トーク形式で小説を書くアプリ
 * データはすべて端末のブラウザ(localStorage)に保存されます。 */

// ================= 共通ヘルパー =================
const STORE_KEY = 'ohanashi-app-v1';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const app = $('#app');
const layer = $('#layer');

/** **で囲まれた部分を半分のサイズにして HTML 化 */
function fmt(text) {
  return esc(text).replace(/\*\*([\s\S]+?)\*\*/g, '<span class="half">$1</span>');
}

// ---- 色 ----
function normHex(s) {
  s = String(s || '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(s)) s = s.split('').map(c => c + c).join('');
  return /^[0-9a-f]{6}$/i.test(s) ? '#' + s.toLowerCase() : null;
}
const hexRgb = h => { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const rgba = (h, a = 1) => { const [r, g, b] = hexRgb(h); return `rgba(${r},${g},${b},${a})`; };
function lum([r, g, b]) {
  const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; };
  return .2126 * f(r) + .7152 * f(g) + .0722 * f(b);
}
const blend = (h, a, bg) => { const c = hexRgb(h), d = hexRgb(bg); return c.map((v, i) => Math.round(v * a + d[i] * (1 - a))); };
const inkOn = rgb => lum(rgb) > 0.22 ? '#231e19' : '#ffffff';
const PRESETS = ['#ffffff', '#f6d6dc', '#ffd9a8', '#fff1a8', '#c9f0c1', '#bfe6f5', '#c9d3ff', '#e3cff7', '#f4efe8', '#8fc9a8', '#6aa3d9', '#e87b8b', '#b48ad6', '#3b3b3b', '#1d2433'];

// ================= データ =================
let db = loadDB();
function loadDB() {
  try {
    const d = JSON.parse(localStorage.getItem(STORE_KEY));
    if (d && Array.isArray(d.novels)) return d;
  } catch (e) { /* 読めなければ新規 */ }
  return {novels: []};
}
let saveTimer = null;
function save(now = true) {
  clearTimeout(saveTimer);
  const run = () => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); }
    catch (e) { toast('保存できませんでした(端末の保存容量が不足している可能性があります)'); }
  };
  if (now) run(); else saveTimer = setTimeout(run, 400);
}
function touch(n) { n.updatedAt = Date.now(); }
const findNovel = id => db.novels.find(n => n.id === id);
const findChar = (n, id) => n.characters.find(c => c.id === id);

function newNovel({title, subtitle, frameColor}) {
  return {
    id: uid(), title: title || '無題のおはなし', subtitle: subtitle || '', frameColor: frameColor || '#e87b8b',
    bgColor: '#f4efe8', characters: [], items: [], memo: '', bubbleSize: 12, textSize: 12,
    createdAt: Date.now(), updatedAt: Date.now(), deletedAt: null,
  };
}
function newChar() {
  return {id: uid(), name: '', icon: null, bubbleColor: '#ffffff', bubbleAlpha: 1, side: 'left', height: '', gender: '', birthday: '', other: ''};
}
const sideOf = (it, ch) => it.side || (ch && ch.side) || 'left';

// ================= UI 小物 =================
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}
function avatarHTML(ch, extra = '') {
  if (!ch) return `<div class="avatar" ${extra}></div>`;
  if (ch.icon) return `<div class="avatar" ${extra}><img src="${ch.icon}" alt=""></div>`;
  return `<div class="avatar" style="--av:${rgba(ch.bubbleColor, Math.max(ch.bubbleAlpha, .35))};border:1px solid rgba(0,0,0,.12)" ${extra}></div>`;
}

/** 下から出るシート(重ねて開ける) */
function openSheet(html, {full = false, center = false, onClose} = {}) {
  const ov = document.createElement('div');
  ov.className = 'overlay' + (center ? ' center' : '');
  ov.innerHTML = `<div class="sheet${full ? ' full' : ''}" role="dialog" aria-modal="true">${html}</div>`;
  const sheet = ov.firstElementChild;
  sheet.close = () => { ov.remove(); onClose && onClose(); };
  ov.addEventListener('click', e => { if (e.target === ov) sheet.close(); });
  sheet.addEventListener('click', e => { if (e.target.closest('[data-close]')) sheet.close(); });
  layer.appendChild(ov);
  return sheet;
}
function closeAllSheets() { layer.innerHTML = ''; }

function confirmDialog(msg, {yes = 'はい', no = 'いいえ', danger = true} = {}) {
  return new Promise(res => {
    let answered = false;
    const s = openSheet(`<div class="dialog-body">${esc(msg)}</div>
      <div class="sheet-foot"><button class="btn" data-no>${esc(no)}</button><button class="btn ${danger ? 'danger' : 'primary'}" data-yes>${esc(yes)}</button></div>`,
      {center: true, onClose: () => { if (!answered) res(false); }});
    $('[data-no]', s).onclick = () => { answered = true; s.close(); res(false); };
    $('[data-yes]', s).onclick = () => { answered = true; s.close(); res(true); };
  });
}
function actionSheet(title, actions) {
  const s = openSheet(`${title ? `<div class="dialog-body" style="padding-bottom:0;font-size:13px;opacity:.75">${esc(title)}</div>` : ''}
    <div class="actions">${actions.map((a, i) => `<button class="btn ${a.danger ? 'danger' : ''}" data-i="${i}">${esc(a.label)}</button>`).join('')}
    <button class="btn ghost" data-close>キャンセル</button></div>`);
  $$('[data-i]', s).forEach(b => b.onclick = () => { s.close(); actions[+b.dataset.i].run(); });
}

/** カラー入力(カラーピッカー + カラーコード + 候補 + 透明度) */
function colorFieldHTML(hex, alpha = null) {
  const t = alpha == null ? null : Math.round((1 - alpha) * 100);
  return `<div class="cf">
    <div class="cf-row">
      <input type="color" class="cf-pick" value="${hex}" aria-label="カラーを選ぶ">
      <label class="cf-hexwrap"><span>#</span><input class="cf-hex" value="${hex.slice(1)}" maxlength="7" autocapitalize="off" autocomplete="off" spellcheck="false" aria-label="カラーコード"></label>
    </div>
    <div class="cf-presets">${PRESETS.map(c => `<button type="button" style="background:${c}" data-c="${c}" aria-label="${c}"></button>`).join('')}</div>
    ${t == null ? '' : `<label class="cf-alpha">透明度<input type="range" class="cf-a" min="0" max="95" value="${t}"><output>${t}%</output></label>`}
  </div>`;
}
function bindColorField(root, hex, alpha, onChange) {
  const pick = $('.cf-pick', root), hx = $('.cf-hex', root), a = $('.cf-a', root);
  let cur = hex, al = alpha;
  const emit = () => onChange(cur, al);
  pick.oninput = () => { cur = pick.value; hx.value = cur.slice(1); hx.classList.remove('bad'); emit(); };
  hx.oninput = () => {
    const v = normHex(hx.value);
    hx.classList.toggle('bad', !v);
    if (v) { cur = v; pick.value = v; emit(); }
  };
  hx.onblur = () => { hx.value = cur.slice(1); hx.classList.remove('bad'); };
  $$('.cf-presets button', root).forEach(b => b.onclick = () => { cur = b.dataset.c; pick.value = cur; hx.value = cur.slice(1); hx.classList.remove('bad'); emit(); });
  if (a) a.oninput = () => { al = 1 - a.value / 100; a.nextElementSibling.textContent = a.value + '%'; emit(); };
}

// ================= ルーティング =================
let homeTab = (() => { try { return localStorage.getItem('ohanashi-tab') || 'write'; } catch (e) { return 'write'; } })();
function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
function route() {
  closeAllSheets();
  C = null;
  const [page, id] = location.hash.replace(/^#\/?/, '').split('/');
  if (page === 'write' || page === 'read') {
    const n = findNovel(id);
    if (n && !n.deletedAt) return renderChat(n, page === 'read');
  }
  if (page === 'trash') return renderTrash();
  renderHome();
}
window.addEventListener('hashchange', route);

// ================= ホーム画面 =================
function novelCard(n, attrs) {
  const d = new Date(n.updatedAt);
  return `<button class="ncard" style="--fc:${n.frameColor}" ${attrs}>
    <div class="ntitle">${esc(n.title)}</div>
    ${n.subtitle ? `<div class="nsub">${esc(n.subtitle)}</div>` : ''}
    <div class="nmeta">キャラクター ${n.characters.length}人 ・ ${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} 更新</div>
  </button>`;
}
function renderHome() {
  const list = db.novels.filter(n => !n.deletedAt).sort((a, b) => b.updatedAt - a.updatedAt);
  const w = homeTab === 'write';
  app.innerHTML = `<div class="screen home">
    <header class="home-head">
      <div class="tabs" role="tablist">
        <button class="tab ${w ? 'on' : ''}" role="tab" aria-selected="${w}" data-tab="write">おはなしを書く</button>
        <button class="tab ${!w ? 'on' : ''}" role="tab" aria-selected="${!w}" data-tab="read">おはなしを読む</button>
      </div>
      <button class="icon-btn" data-trash aria-label="削除した作品">🗑</button>
    </header>
    <main class="home-list">
      ${w ? '<button class="new-card" data-new>＋ 新しいおはなしを作る</button>' : ''}
      ${list.map(n => novelCard(n, `data-open="${n.id}"`)).join('')}
      ${list.length ? '' : `<p class="empty">${w ? 'まだおはなしがありません。<br>「新しいおはなしを作る」から始めましょう。' : '読めるおはなしがまだありません。'}</p>`}
    </main>
  </div>`;
  $$('[data-tab]', app).forEach(b => b.onclick = () => {
    homeTab = b.dataset.tab; try { localStorage.setItem('ohanashi-tab', homeTab); } catch (e) {}
    renderHome();
  });
  $('[data-trash]', app).onclick = () => go('#/trash');
  const nb = $('[data-new]', app); if (nb) nb.onclick = openNewNovel;
  $$('[data-open]', app).forEach(b => b.onclick = () => go(`#/${homeTab}/${b.dataset.open}`));
}

function openNewNovel() {
  let frame = '#e87b8b';
  const s = openSheet(`<div class="sheet-head"><h2>新しいおはなし</h2><button class="btn ghost" data-close>閉じる</button></div>
    <div class="sheet-body">
      <label class="field"><span>題名</span><input class="inp" id="nn-title" placeholder="無題のおはなし"></label>
      <label class="field"><span>サブタイトル(一覧で題名の下に表示)</span><textarea class="inp" id="nn-sub" rows="2"></textarea></label>
      <div class="field"><span>枠のカラー</span>${colorFieldHTML(frame)}</div>
      <div class="field"><span>プレビュー</span><div id="nn-prev"></div></div>
    </div>
    <div class="sheet-foot"><button class="btn primary" id="nn-ok">作成する</button></div>`, {full: true});
  const prev = () => {
    $('#nn-prev', s).innerHTML = novelCard({title: $('#nn-title', s).value || '無題のおはなし', subtitle: $('#nn-sub', s).value, frameColor: frame, characters: [], updatedAt: Date.now()}, 'tabindex="-1" disabled');
  };
  bindColorField($('.cf', s), frame, null, h => { frame = h; prev(); });
  $('#nn-title', s).oninput = prev; $('#nn-sub', s).oninput = prev; prev();
  $('#nn-ok', s).onclick = () => {
    const n = newNovel({title: $('#nn-title', s).value.trim(), subtitle: $('#nn-sub', s).value.trim(), frameColor: frame});
    db.novels.push(n); save(); s.close(); go(`#/write/${n.id}`);
  };
  setTimeout(() => $('#nn-title', s).focus(), 50);
}

// ---- ゴミ箱 ----
function renderTrash() {
  const list = db.novels.filter(n => n.deletedAt).sort((a, b) => b.deletedAt - a.deletedAt);
  app.innerHTML = `<div class="screen home">
    <header class="sub-head"><button class="icon-btn" data-back aria-label="戻る">‹</button><h1>🗑 削除した作品</h1></header>
    <main class="home-list">
      ${list.map(n => `<div class="trash-item">${novelCard(n, 'tabindex="-1"')}
        <div class="row-btns"><button class="btn" data-restore="${n.id}">元に戻す</button><button class="btn danger" data-purge="${n.id}">完全に削除</button></div></div>`).join('')}
      ${list.length ? '' : '<p class="empty">削除した作品はありません。</p>'}
    </main></div>`;
  $('[data-back]', app).onclick = () => go('#/');
  $$('[data-restore]', app).forEach(b => b.onclick = () => {
    const n = findNovel(b.dataset.restore); n.deletedAt = null; touch(n); save(); toast('元に戻しました'); renderTrash();
  });
  $$('[data-purge]', app).forEach(b => b.onclick = async () => {
    if (!await confirmDialog('この作品を完全に削除しますか？\nもう元に戻せません。')) return;
    db.novels = db.novels.filter(n => n.id !== b.dataset.purge); save(); renderTrash();
  });
}

// ================= トーク画面 =================
let C = null; // 開いているトーク画面の状態

function itemHTML(n, it, cls = '') {
  if (it.type === 'space') return `<div class="item ${cls}" data-id="${it.id}"><div class="space"></div></div>`;
  if (it.type === 'text') return `<div class="item ${cls}" data-id="${it.id}"><div class="narr">${it.html ?? fmt(it.text)}</div></div>`;
  const ch = findChar(n, it.charId);
  if (!ch) return '';
  const side = sideOf(it, ch);
  const bg = rgba(ch.bubbleColor, ch.bubbleAlpha);
  const ink = inkOn(blend(ch.bubbleColor, ch.bubbleAlpha, n.bgColor));
  return `<div class="item ${cls}" data-id="${it.id}"><div class="b-row ${side}">
    ${ch.icon ? avatarHTML(ch) : ''}
    <div class="b-col"><div class="b-name">${esc(ch.name || '名前なし')}</div>
    <div class="bubble" style="background:${bg};color:${ink}">${it.html ?? fmt(it.text)}</div></div>
  </div></div>`;
}

function applyChatStyle() {
  const n = C.novel, scr = $('.chat', app);
  scr.style.setProperty('--bg', n.bgColor);
  scr.style.setProperty('--txt', inkOn(hexRgb(n.bgColor)));
  scr.style.setProperty('--bsize', n.bubbleSize + 'pt');
  scr.style.setProperty('--tsize', n.textSize + 'pt');
}

function renderChat(n, readOnly) {
  C = {novel: n, ro: readOnly, mode: null, charId: null, side: 'left', editingId: null, panel: null};
  app.innerHTML = `<div class="screen chat ${readOnly ? 'read' : 'write'}">
    <header class="chat-head">
      <button class="icon-btn" data-back aria-label="ホームへ戻る">‹</button>
      <div class="chat-title"><span id="c-title"></span>${readOnly ? '<span class="read-badge">読む</span>' : ''}</div>
      ${readOnly ? '<span class="icon-btn"></span>' : '<button class="icon-btn" data-settings aria-label="設定">⚙️</button>'}
    </header>
    <main class="chat-body" id="c-body">
      <div class="items" id="c-items"></div>
      ${readOnly ? '' : `<div class="plus-wrap"><div class="plus-menu" id="c-plusmenu" hidden>
          <button class="btn" data-space>余白</button><button class="btn" data-text>文章作成</button></div>
        <button class="plus" id="c-plus" aria-label="余白・文章を追加">＋</button></div>`}
    </main>
    ${readOnly ? '' : `<footer class="composer">
      <div class="panel" id="c-panel" hidden></div>
      <div class="mode-chip" id="c-chip"></div>
      <div class="tool-row">
        <button class="btn" data-panel="chars">キャラ選択</button>
        <button class="btn" data-panel="memo">メモ</button>
        <button class="btn" data-panel="size">文字サイズ</button>
      </div>
      <div class="input-row">
        <button class="sq ok" id="c-ok" aria-label="決定">✔</button>
        <button class="sq" id="c-ast" aria-label="アスタリスクを入力">*</button>
        <textarea id="c-input" rows="1" placeholder="キャラ選択 か ＋ から作成" enterkeyhint="enter"></textarea>
      </div>
    </footer>`}
  </div>`;
  $('#c-title').textContent = n.title;
  applyChatStyle();
  $('[data-back]', app).onclick = () => go('#/');
  renderItems();
  scrollBottom();

  const body = $('#c-body');
  body.addEventListener('click', e => {
    const el = e.target.closest('.item');
    if (!el || el.classList.contains('draft')) return;
    const it = n.items.find(x => x.id === el.dataset.id);
    if (!it) return;
    if (readOnly) { if (it.type === 'bubble') showProfile(n, findChar(n, it.charId)); return; }
    itemMenu(it);
  });
  if (readOnly) return;

  $('[data-settings]', app).onclick = () => openSettings(n);
  const plus = $('#c-plus'), pm = $('#c-plusmenu');
  plus.onclick = () => { pm.hidden = !pm.hidden; plus.textContent = pm.hidden ? '＋' : '×'; if (!pm.hidden) scrollBottom(); };
  const closePlus = () => { pm.hidden = true; plus.textContent = '＋'; };
  $('[data-space]', app).onclick = () => {
    n.items.push({id: uid(), type: 'space'}); touch(n); save(); closePlus(); renderItems(); scrollBottom();
  };
  $('[data-text]', app).onclick = () => { closePlus(); startMode('text'); };

  $$('[data-panel]', app).forEach(b => b.onclick = () => togglePanel(b.dataset.panel));

  const ta = $('#c-input');
  ta.addEventListener('input', () => { autosize(); updateDraft(); });
  // ボタンを押しても入力欄からフォーカスが外れないように
  ['#c-ok', '#c-ast'].forEach(s => $(s).addEventListener('pointerdown', e => e.preventDefault()));
  $('#c-ok').onclick = commit;
  $('#c-ast').onclick = () => {
    if (!C.mode) { toast('先に キャラ選択 か ＋ から作成'); return; }
    const s = ta.selectionStart, e = ta.selectionEnd, v = ta.value;
    // 範囲選択中なら **〜** で囲む、そうでなければ * を1つ入力
    if (e > s) { ta.value = v.slice(0, s) + '**' + v.slice(s, e) + '**' + v.slice(e); ta.setSelectionRange(e + 4, e + 4); }
    else { ta.value = v.slice(0, s) + '*' + v.slice(e); ta.setSelectionRange(s + 1, s + 1); }
    ta.focus(); autosize(); updateDraft();
  };
  renderChip();
}

function autosize() {
  const ta = $('#c-input'); if (!ta) return;
  ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight + 2, innerHeight * .32) + 'px';
}
function scrollBottom() { const b = $('#c-body'); if (b) requestAnimationFrame(() => { b.scrollTop = b.scrollHeight; }); }

function renderItems() {
  const n = C.novel;
  $('#c-items').innerHTML = n.items.map(it => itemHTML(n, it, it.id === C.editingId ? 'editing-src' : '')).join('')
    + (n.items.length || !C.ro ? '' : '<p class="empty">まだ何も書かれていません。</p>');
  updateDraft();
}

/** 入力中の文章をリアルタイムで画面に表示 */
function updateDraft() {
  if (C.ro) return;
  const box = $('#c-items');
  let d = $('.item.draft', box);
  if (!C.mode) { d && d.remove(); return; }
  const n = C.novel, text = $('#c-input').value;
  const draft = {id: 'draft', type: C.mode === 'text' ? 'text' : 'bubble', charId: C.charId, side: C.side,
    html: fmt(text) + '<span class="caret"></span>'};
  const tmp = document.createElement('div');
  tmp.innerHTML = itemHTML(n, draft, 'draft');
  const nd = tmp.firstElementChild;
  if (!nd) { d && d.remove(); return; }
  if (d) d.replaceWith(nd); else {
    const src = C.editingId && $(`.item[data-id="${C.editingId}"]`, box);
    if (src) src.after(nd); else box.appendChild(nd);
  }
  if (!C.editingId) { const b = $('#c-body'); if (b.scrollHeight - b.scrollTop - b.clientHeight < 160) b.scrollTop = b.scrollHeight; }
}

function startMode(mode, charId) {
  C.mode = mode;
  if (mode === 'bubble') {
    C.charId = charId;
    const ch = findChar(C.novel, charId);
    if (!C.editingId) C.side = ch.side || 'left';
  }
  const ta = $('#c-input');
  ta.disabled = false;
  ta.placeholder = mode === 'text' ? '地の文を入力(改行できます)' : 'セリフを入力(改行できます)';
  renderChip(); updateDraft(); ta.focus();
}
function endMode() {
  const wasEditing = !!C.editingId;
  C.mode = null; C.editingId = null;
  const ta = $('#c-input'); ta.value = ''; autosize();
  ta.placeholder = 'キャラ選択 か ＋ から作成';
  if (wasEditing) renderItems(); else updateDraft();
  renderChip();
}

function renderChip() {
  const chip = $('#c-chip'); if (!chip) return;
  const n = C.novel;
  const edit = C.editingId ? '<b>編集中</b> ・ ' : '';
  if (C.mode === 'bubble') {
    const ch = findChar(n, C.charId);
    chip.innerHTML = `${avatarHTML(ch)}<span class="grow">${edit}<b>${esc(ch.name || '名前なし')}</b> の吹き出し</span>
      <span class="seg" role="group" aria-label="表示する側"><button data-side="left" class="${C.side === 'left' ? 'on' : ''}">左</button><button data-side="right" class="${C.side === 'right' ? 'on' : ''}">右</button></span>
      <button class="chip-x" data-x aria-label="やめる">×</button>`;
    $$('[data-side]', chip).forEach(b => b.onclick = () => { C.side = b.dataset.side; renderChip(); updateDraft(); });
  } else if (C.mode === 'text') {
    chip.innerHTML = `<span class="grow">${edit}<b>吹き出し無しの文章</b>を作成中</span><button class="chip-x" data-x aria-label="やめる">×</button>`;
  } else {
    chip.innerHTML = `<span class="grow">セリフは「キャラ選択」、地の文・余白は画面の「＋」から</span>`;
  }
  const x = $('[data-x]', chip); if (x) x.onclick = endMode;
  $$('[data-panel]', app).forEach(b => b.classList.toggle('on', b.dataset.panel === C.panel));
}

function commit() {
  const n = C.novel, ta = $('#c-input'), text = ta.value;
  if (!C.mode) { toast('キャラ選択 か ＋ から作成'); return; }
  if (!text.trim()) { toast('文章を入力してください'); return; }
  const ch = C.mode === 'bubble' ? findChar(n, C.charId) : null;
  const side = ch && C.side !== (ch.side || 'left') ? C.side : null; // キャラの既定と同じなら null(キャラ設定に追従)
  if (C.editingId) {
    const it = n.items.find(x => x.id === C.editingId);
    if (it) { it.text = text; if (ch) { it.charId = ch.id; it.side = side; } }
    touch(n); save(); endMode(); toast('変更しました');
    return;
  }
  if (C.mode === 'bubble') n.items.push({id: uid(), type: 'bubble', charId: ch.id, side, text});
  else n.items.push({id: uid(), type: 'text', text});
  touch(n); save();
  ta.value = ''; autosize();
  if (C.mode === 'text') { C.mode = null; ta.placeholder = 'キャラ選択 か ＋ から作成'; renderChip(); }
  renderItems(); scrollBottom();
}

function itemMenu(it) {
  const n = C.novel, i = n.items.indexOf(it);
  const acts = [];
  if (it.type !== 'space') acts.push({label: '編集する', run: () => {
    C.editingId = it.id;
    const ta = $('#c-input'); ta.value = it.text;
    if (it.type === 'bubble') { C.side = sideOf(it, findChar(n, it.charId)); startMode('bubble', it.charId); }
    else startMode('text');
    renderItems(); autosize();
    const src = $(`.item.draft`); src && src.scrollIntoView({block: 'center'});
  }});
  if (it.type === 'bubble') acts.push({label: 'キャラクター設定を開く', run: () => openCharEditor(n, findChar(n, it.charId))});
  if (i > 0) acts.push({label: '上へ移動', run: () => { n.items.splice(i, 1); n.items.splice(i - 1, 0, it); touch(n); save(); renderItems(); }});
  if (i < n.items.length - 1) acts.push({label: '下へ移動', run: () => { n.items.splice(i, 1); n.items.splice(i + 1, 0, it); touch(n); save(); renderItems(); }});
  acts.push({label: '削除する', danger: true, run: async () => {
    if (!await confirmDialog('この' + (it.type === 'bubble' ? '吹き出し' : it.type === 'text' ? '文章' : '余白') + 'を削除しますか？')) return;
    n.items = n.items.filter(x => x !== it); if (C.editingId === it.id) endMode();
    touch(n); save(); renderItems();
  }});
  const label = it.type === 'space' ? '余白' : it.text.slice(0, 30) + (it.text.length > 30 ? '…' : '');
  actionSheet(label, acts);
}

// ---- 入力欄の上のパネル(キャラ選択・メモ・文字サイズ) ----
function togglePanel(name) {
  C.panel = C.panel === name ? null : name;
  renderPanel(); renderChip();
}
function renderPanel() {
  const p = $('#c-panel'), n = C.novel;
  if (!p) return;
  p.hidden = !C.panel;
  if (C.panel === 'chars') {
    p.innerHTML = `<div class="char-strip">
      ${n.characters.map(c => `<button class="char-pick ${C.mode === 'bubble' && C.charId === c.id ? 'on' : ''}" data-pick="${c.id}">${avatarHTML(c)}<span class="cp-name">${esc(c.name || '名前なし')}</span></button>`).join('')}
      <button class="char-pick" data-newchar><div class="avatar plus-av">＋</div><span class="cp-name">新しく作る</span></button>
    </div>${n.characters.length ? '' : '<p class="panel-note">キャラクターがまだいません。「新しく作る」か ⚙️ の「キャラクター作成」から作れます。</p>'}`;
    $$('[data-pick]', p).forEach(b => b.onclick = () => {
      C.panel = null; renderPanel(); startMode('bubble', b.dataset.pick);
    });
    $('[data-newchar]', p).onclick = () => openCharEditor(n, null, ch => { C.panel = null; renderPanel(); startMode('bubble', ch.id); });
  } else if (C.panel === 'memo') {
    p.innerHTML = `<textarea class="memo-area" id="c-memo" placeholder="自由にメモできます(自動で保存されます)">${esc(n.memo)}</textarea><p class="panel-note">メモはおはなしの本文には表示されません。</p>`;
    $('#c-memo').oninput = e => { n.memo = e.target.value; save(false); };
  } else if (C.panel === 'size') {
    const row = (key, label) => `<div class="size-row" data-key="${key}"><label>${label}</label>
      <button class="step" data-d="-0.5" aria-label="小さく">−</button>
      <input type="range" min="6" max="40" step="0.5" value="${n[key]}" aria-label="${label}の文字サイズ">
      <button class="step" data-d="0.5" aria-label="大きく">＋</button>
      <span><input type="number" min="4" max="72" step="0.5" value="${n[key]}" aria-label="${label}(pt)"></span></div>`;
    p.innerHTML = row('bubbleSize', '吹き出し') + row('textSize', '画面文字') + '<p class="panel-note">単位は pt です。「画面文字」は吹き出しではない文章のサイズです。</p>';
    $$('.size-row', p).forEach(r => {
      const key = r.dataset.key, rng = $('input[type=range]', r), num = $('input[type=number]', r);
      const set = v => {
        v = Math.round(Math.min(72, Math.max(4, +v || n[key])) * 2) / 2;
        n[key] = v; rng.value = v; if (document.activeElement !== num) num.value = v;
        applyChatStyle(); save(false);
      };
      rng.oninput = () => set(rng.value);
      num.oninput = () => { if (num.value !== '') set(num.value); };
      num.onblur = () => { num.value = n[key]; };
      $$('.step', r).forEach(b => b.onclick = () => set(n[key] + +b.dataset.d));
    });
  } else p.innerHTML = '';
}

// ================= 設定(⚙️) =================
function openSettings(n) {
  const s = openSheet(`<div class="sheet-head"><h2>設定</h2><button class="btn ghost" data-close>閉じる</button></div>
    <div class="sheet-body">
      <section class="sec" id="st-bg"><h3>1. 画面のカラー</h3>${colorFieldHTML(n.bgColor)}</section>
      <section class="sec"><h3>2. キャラクター作成・編集</h3>
        <button class="btn primary block" data-newchar>＋ キャラクター作成</button>
        <h4>キャラクター一覧</h4><ul class="char-list" id="st-chars"></ul></section>
      <section class="sec"><h3>3. 題名</h3><input class="inp" id="st-title" value="${esc(n.title)}"></section>
      <section class="sec"><h3>4. サブタイトル</h3><textarea class="inp" id="st-sub" rows="2" placeholder="ホーム画面の一覧で題名の下に表示されます">${esc(n.subtitle)}</textarea></section>
      <section class="sec" id="st-frame"><h3>一覧の枠のカラー</h3>${colorFieldHTML(n.frameColor)}</section>
      <section class="sec"><h3>5. 作品の削除</h3><button class="btn danger block" data-del>作品を削除</button>
        <p class="panel-note">削除した作品はホーム画面の 🗑 から確認・元に戻すことができます。</p></section>
    </div>`, {full: true});
  bindColorField($('#st-bg', s), n.bgColor, null, h => { n.bgColor = h; touch(n); applyChatStyle(); renderItems(); save(false); });
  bindColorField($('#st-frame', s), n.frameColor, null, h => { n.frameColor = h; touch(n); save(false); });
  $('#st-title', s).oninput = e => { n.title = e.target.value || '無題のおはなし'; $('#c-title').textContent = n.title; touch(n); save(false); };
  $('#st-sub', s).oninput = e => { n.subtitle = e.target.value; touch(n); save(false); };
  const list = () => {
    $('#st-chars', s).innerHTML = n.characters.length ? n.characters.map(c => `<li><button class="char-row" data-edit="${c.id}">
      ${avatarHTML(c)}<span class="cr-name">${esc(c.name || '名前なし')}</span><span class="chev">›</span></button></li>`).join('')
      : '<li class="panel-note">まだキャラクターがいません。</li>';
    $$('[data-edit]', s).forEach(b => b.onclick = () => openCharEditor(n, findChar(n, b.dataset.edit), list));
  };
  list();
  $('[data-newchar]', s).onclick = () => openCharEditor(n, null, list);
  $('[data-del]', s).onclick = async () => {
    if (!await confirmDialog('本当に削除しますか？')) return;
    n.deletedAt = Date.now(); save(); toast('作品を削除しました(🗑 から元に戻せます)'); go('#/');
  };
}

// ---- キャラクター作成・編集 ----
function openCharEditor(n, existing, onSaved) {
  const ch = existing ? JSON.parse(JSON.stringify(existing)) : newChar();
  const isNew = !existing;
  const s = openSheet(`<div class="sheet-head"><h2>${isNew ? 'キャラクター作成' : 'キャラクター編集'}</h2><button class="btn ghost" data-close>キャンセル</button></div>
    <div class="sheet-body">
      <section class="sec"><h3>アイコン</h3>
        <div class="icon-edit"><div id="ce-av"></div><div class="btns">
          <label class="btn">写真を選ぶ<input type="file" accept="image/*" id="ce-file" hidden></label>
          <button class="btn ghost" id="ce-adjust">位置・サイズを調整</button>
          <button class="btn ghost" id="ce-noicon">写真を外す</button></div></div>
        <p class="panel-note">写真を設定しない場合、吹き出しはアイコンなしで表示されます(一覧では吹き出し色の丸になります)。</p></section>
      <section class="sec"><h3>名前</h3><input class="inp" id="ce-name" value="${esc(ch.name)}" placeholder="名前"></section>
      <section class="sec" id="ce-color"><h3>吹き出しの色</h3>${colorFieldHTML(ch.bubbleColor, ch.bubbleAlpha)}</section>
      <section class="sec"><h3>表示する側(はじめの設定)</h3>
        <span class="seg" id="ce-side"><button data-side="left">左</button><button data-side="right">右</button></span>
        <p class="panel-note">吹き出しごとに入力時に左右を切り替えることもできます。</p>
        <h4>プレビュー</h4><div class="preview-box" id="ce-prev"></div></section>
      <section class="sec"><h3>詳細設定</h3>
        <div class="two"><label class="field"><span>身長</span><input class="inp" id="ce-height" value="${esc(ch.height)}" placeholder="例: 158cm"></label>
        <label class="field"><span>性別</span><input class="inp" id="ce-gender" value="${esc(ch.gender)}"></label></div>
        <label class="field"><span>誕生日</span><input class="inp" id="ce-bday" value="${esc(ch.birthday)}" placeholder="例: 4月1日"></label>
        <label class="field"><span>その他</span><textarea class="inp" id="ce-other" rows="4" placeholder="性格、好きなもの、関係性など自由に">${esc(ch.other)}</textarea></label></section>
      ${isNew ? '' : '<section class="sec"><button class="btn danger block" id="ce-del">このキャラクターを削除</button></section>'}
    </div>
    <div class="sheet-foot"><button class="btn primary" id="ce-save">${isNew ? '作成する' : '保存する'}</button></div>`, {full: true});

  let rawImage = null; // 調整し直し用に元画像を保持(この画面の間だけ)
  const refresh = () => {
    $('#ce-av', s).innerHTML = avatarHTML(ch);
    $('#ce-adjust', s).hidden = !rawImage;
    $('#ce-noicon', s).hidden = !ch.icon;
    $$('#ce-side button', s).forEach(b => b.classList.toggle('on', b.dataset.side === ch.side));
    const box = $('#ce-prev', s);
    box.style.background = n.bgColor;
    box.innerHTML = `<div style="--bsize:${n.bubbleSize}pt;color:${inkOn(hexRgb(n.bgColor))}">${itemHTML({characters: [ch], bgColor: n.bgColor}, {id: 'p', type: 'bubble', charId: ch.id, text: 'こんにちは！\nよろしくね。'})}</div>`;
  };
  bindColorField($('#ce-color', s), ch.bubbleColor, ch.bubbleAlpha, (h, a) => { ch.bubbleColor = h; ch.bubbleAlpha = a; refresh(); });
  $('#ce-name', s).oninput = e => { ch.name = e.target.value; refresh(); };
  $$('#ce-side button', s).forEach(b => b.onclick = () => { ch.side = b.dataset.side; refresh(); });
  $('#ce-file', s).onchange = async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    rawImage = f;
    const url = await openCropper(f);
    if (url) ch.icon = url;
    refresh();
  };
  $('#ce-adjust', s).onclick = async () => { const url = await openCropper(rawImage); if (url) { ch.icon = url; refresh(); } };
  $('#ce-noicon', s).onclick = () => { ch.icon = null; rawImage = null; refresh(); };
  refresh();

  $('#ce-save', s).onclick = () => {
    ch.name = $('#ce-name', s).value.trim();
    ch.height = $('#ce-height', s).value.trim();
    ch.gender = $('#ce-gender', s).value.trim();
    ch.birthday = $('#ce-bday', s).value.trim();
    ch.other = $('#ce-other', s).value;
    if (!ch.name) { toast('名前を入力してください'); $('#ce-name', s).focus(); return; }
    if (isNew) n.characters.push(ch); else Object.assign(existing, ch);
    touch(n); save(); s.close();
    // 変更はこれまでの吹き出しすべてに反映(吹き出しはキャラIDで参照しているため)
    if (C && C.novel === n) { renderItems(); renderChip(); renderPanel(); }
    toast(isNew ? 'キャラクターを作成しました' : '変更をすべての吹き出しに反映しました');
    onSaved && onSaved(isNew ? ch : existing);
  };
  const del = $('#ce-del', s);
  if (del) del.onclick = async () => {
    const used = n.items.filter(it => it.type === 'bubble' && it.charId === existing.id).length;
    if (!await confirmDialog(`「${existing.name || '名前なし'}」を削除しますか？` + (used ? `\nこのキャラクターの吹き出し ${used} 件も削除されます。` : ''))) return;
    n.characters = n.characters.filter(c => c !== existing);
    n.items = n.items.filter(it => !(it.type === 'bubble' && it.charId === existing.id));
    if (C && C.novel === n && C.charId === existing.id) { C.mode = null; C.editingId = null; }
    touch(n); save(); s.close();
    if (C && C.novel === n) { renderItems(); renderChip(); renderPanel(); }
    onSaved && onSaved(null);
  };
}

// ---- 写真のトリミング(丸枠に合わせて移動・拡大縮小) ----
function openCropper(file) {
  return new Promise(resolve => {
    const V = Math.min(280, innerWidth - 64), OUT = 320;
    const url = URL.createObjectURL(file);
    let done = false;
    const s = openSheet(`<div class="sheet-head"><h2>アイコンの調整</h2></div>
      <div class="crop" style="--v:${V}px">
        <div class="crop-stage" id="cr-stage"><img id="cr-img" alt=""><div class="crop-mask"></div></div>
        <label>縮小<input type="range" id="cr-zoom" min="1" max="5" step="0.01" value="1" aria-label="拡大率">拡大</label>
        <p class="hint">ドラッグで位置、2本指・スライダー・ホイールで大きさを調整できます</p>
      </div>
      <div class="sheet-foot"><button class="btn" data-cancel>キャンセル</button><button class="btn primary" data-ok>決定</button></div>`,
      {onClose: () => { URL.revokeObjectURL(url); if (!done) resolve(null); }});
    const img = $('#cr-img', s), stage = $('#cr-stage', s), zoomEl = $('#cr-zoom', s);
    let w = 0, h = 0, base = 1, zoom = 1, x = 0, y = 0;
    const dims = () => ({dw: w * base * zoom, dh: h * base * zoom});
    const clamp = () => {
      const {dw, dh} = dims();
      const mx = (dw - V) / 2, my = (dh - V) / 2;
      x = Math.max(-mx, Math.min(mx, x)); y = Math.max(-my, Math.min(my, y));
    };
    const draw = () => {
      clamp();
      const {dw, dh} = dims();
      img.style.width = dw + 'px'; img.style.height = dh + 'px';
      img.style.transform = `translate(${V / 2 - dw / 2 + x}px, ${V / 2 - dh / 2 + y}px)`;
    };
    const setZoom = z => { zoom = Math.max(1, Math.min(5, z)); zoomEl.value = zoom; draw(); };
    img.onload = () => { w = img.naturalWidth; h = img.naturalHeight; base = Math.max(V / w, V / h); draw(); };
    img.onerror = () => { toast('画像を読み込めませんでした'); s.close(); };
    img.src = url;
    zoomEl.oninput = () => setZoom(+zoomEl.value);
    stage.addEventListener('wheel', e => { e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08)); }, {passive: false});
    const pts = new Map(); let last = null, pinch = null;
    stage.addEventListener('pointerdown', e => { stage.setPointerCapture(e.pointerId); pts.set(e.pointerId, {x: e.clientX, y: e.clientY}); last = {x: e.clientX, y: e.clientY}; pinch = null; });
    stage.addEventListener('pointermove', e => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, {x: e.clientX, y: e.clientY});
      if (pts.size >= 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) setZoom(pinch.z * d / pinch.d); else pinch = {d, z: zoom};
      } else if (last) {
        x += e.clientX - last.x; y += e.clientY - last.y; last = {x: e.clientX, y: e.clientY}; draw();
      }
    });
    const up = e => { pts.delete(e.pointerId); pinch = null; const r = [...pts.values()][0]; last = r ? {...r} : null; };
    stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
    $('[data-cancel]', s).onclick = () => s.close();
    $('[data-ok]', s).onclick = () => {
      if (!w) return;
      const cv = document.createElement('canvas'); cv.width = cv.height = OUT;
      const ctx = cv.getContext('2d'), k = OUT / V, {dw, dh} = dims();
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, OUT, OUT);
      ctx.drawImage(img, (V / 2 - dw / 2 + x) * k, (V / 2 - dh / 2 + y) * k, dw * k, dh * k);
      done = true; resolve(cv.toDataURL('image/jpeg', 0.85)); s.close();
    };
  });
}

// ---- キャラクター設定の閲覧(読むモード) ----
function showProfile(n, ch) {
  if (!ch) return;
  const row = (k, v) => v ? `<dt>${k}</dt><dd>${esc(v)}</dd>` : '';
  openSheet(`<div class="sheet-head"><h2>キャラクター</h2><button class="btn ghost" data-close>閉じる</button></div>
    <div class="sheet-body"><div class="profile">${avatarHTML(ch)}<div class="pname">${esc(ch.name || '名前なし')}</div>
      <dl class="plist">
        <dt>吹き出し</dt><dd><span class="swatch" style="background:${rgba(ch.bubbleColor, ch.bubbleAlpha)}"></span>${ch.bubbleColor}</dd>
        ${row('身長', ch.height)}${row('性別', ch.gender)}${row('誕生日', ch.birthday)}${row('その他', ch.other)}
      </dl></div></div>`);
}

// ================= 起動 =================
function fitViewport() {
  const h = window.visualViewport ? visualViewport.height : innerHeight;
  document.documentElement.style.setProperty('--app-h', h + 'px');
  if (window.scrollY) window.scrollTo(0, 0);
}
if (window.visualViewport) visualViewport.addEventListener('resize', fitViewport);
addEventListener('resize', fitViewport);
fitViewport();
route();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
