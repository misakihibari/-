(async () => {
  const $ = id => document.getElementById(id);
  const esc = s => (s || "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  let data;
  try { data = await (await fetch("data.json", {cache: "no-cache"})).json(); }
  catch { $("view").textContent = "データを読み込めません。"; return; }
  const arts = data.articles;
  if (!arts.length) { $("view").textContent = "ニュースがまだありません。"; return; }
  $("updated").textContent = `最新: ${arts[0].date} / 全${arts.length}件`;

  const src = a => a.summary_src === "ai" ? "" : "(本文の抜粋)";
  const link = a => `<a href="${esc(a.url)}" target="_blank" rel="noopener">元記事を開く ↗</a>`;
  // 要約を常に見せ、タップで全文を開く
  const item = (a, badge = "") => `<div class="card"><h3><span class="date">${a.date}</span>${badge}${esc(a.title)}</h3>
    <p class="summary"><b>要約${src(a)}:</b> ${esc(a.summary)}</p>
    <details><summary>全文を表示</summary><div class="body">${esc(a.body)}</div><p>${link(a)}</p></details></div>`;
  // 「すべて」用: 日付とタイトルを並べ、タップで要約と全文
  const row = a => `<details><summary><span class="date">${a.date}</span>${esc(a.title)}</summary>
    <p class="summary"><b>要約${src(a)}:</b> ${esc(a.summary)}</p>
    <div class="body">${esc(a.body)}</div><p>${link(a)}</p></details>`;
  const groupText = k => data.groups[k] || "(AIによる要約は未作成です)";

  // ① 新着(直近30日以内、なければ最新3件): 要約+全文
  const seen = (() => { try { return localStorage.getItem("seen") || ""; } catch { return ""; } })();
  const latest = arts.slice(0, 3);
  $("latest").innerHTML = "<h2 style='font-size:1rem'>新着ニュース</h2>" +
    latest.map(a => item(a, a.date > seen && seen ? '<span class="badge">NEW</span>' : "")).join("");
  try { localStorage.setItem("seen", arts[0].date); } catch {}

  // ② 年→月タブ
  const years = [...new Set(arts.map(a => a.date.slice(0, 4)))];
  let year = years[0], month = "all";
  const tab = (label, key, sel, attr) => `<button role="tab" aria-selected="${sel}" data-${attr}="${key}">${label}</button>`;
  function render() {
    $("years").innerHTML = years.map(y => tab(y + "年", y, y === year, "y")).join("");
    const months = [...new Set(arts.filter(a => a.date.startsWith(year)).map(a => a.date.slice(5, 7)))];
    $("months").innerHTML = tab("すべて", "all", month === "all", "m") +
      months.map(m => tab(+m + "月", m, m === month, "m")).join("");
    const key = month === "all" ? year : `${year}-${month}`;
    const list = arts.filter(a => a.date.startsWith(key));
    const label = month === "all" ? `${year}年` : `${year}年${+month}月`;
    $("view").innerHTML = `<div class="card"><h2>${label}の要約(${list.length}件)</h2>
      <div class="summary">${esc(groupText(key))}</div></div>` +
      (month === "all" ? "<h3>すべてのニュース</h3>" + list.map(row).join("") : list.map(a => item(a)).join(""));
  }
  document.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.y) { year = b.dataset.y; month = "all"; render(); }
    if (b.dataset.m) { month = b.dataset.m; render(); }
  });
  render();
})();
