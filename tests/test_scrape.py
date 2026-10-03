from newsapp import scrape, update

LIST = """<ul><li><a href="/news/15175/"><time datetime="2026-09-30">2026.09.30</time> 新サービス開始</a></li>
<li><span>2025年3月1日</span><a href="/news/12890/">決算のお知らせ</a></li></ul>
<a href="/news/page/2/">2</a><a href="/news/">一覧</a>"""
ART = "<html><body><nav>menu</nav><article><h1>新サービス開始</h1><time datetime='2026-09-30'></time><p>本日開始しました。詳細は以下の通りです。</p></article></body></html>"


def test_list():
    items, pages = scrape.parse_list(LIST, "https://hd.gmotech.jp/news/")
    assert {i["date"] for i in items} == {"2026-09-30", "2025-03-01"}
    assert pages == ["https://hd.gmotech.jp/news/page/2/"]


def test_article():
    a = scrape.parse_article(ART, "u")
    assert a["date"] == "2026-09-30" and "menu" not in a["body"] and "本日開始" in a["body"]


def test_groups(tmp_path, monkeypatch):
    monkeypatch.setattr(update, "GROUPS", tmp_path / "g.json")
    g = update.group_summaries([{"url": "u", "title": "T", "date": "2026-09-30", "summary": "s"}])
    assert set(g) == {"2026", "2026-09"}


def test_crawl_probes_numbered_pages(monkeypatch):
    pages = {
        "https://hd.gmotech.jp/news/": '<a href="/news/1/">2025.01.01 A</a>',
        "https://hd.gmotech.jp/news/page/2/": '<a href="/news/2/">2014.01.09 B</a>',
    }
    import requests

    def fake(_s, url):
        if url not in pages:
            raise requests.HTTPError("404")
        return pages[url]
    monkeypatch.setattr(scrape, "_get", fake)
    monkeypatch.setattr(scrape.time, "sleep", lambda _: None)
    got = scrape.crawl_list()
    assert {g["date"] for g in got} == {"2025-01-01", "2014-01-09"}


def test_short_ids_and_external_links():
    html = """<nav><a href="/news/category/media/">メディア</a><a href="/news/date/2026/">2026</a></nav>
    <a href="https://hd.gmotech.jp/news/7462/">2025.08.29 プレスリリース 港区共催セミナー</a>
    <a href="https://gmoretech.com/news20250807/">2025.08.07 プレスリリース 東海エリア導入</a>
    <a href="https://x.com/gmotech_pr">公式X</a>
    <a href="https://www.facebook.com/sharer/sharer.php?u=https://hd.gmotech.jp/news/14683/">share</a>"""
    items, _ = scrape.parse_list(html, "https://hd.gmotech.jp/news/page/7/")
    assert sorted(i["date"] for i in items) == ["2025-08-07", "2025-08-29"]


def test_extractive_skips_header_and_title():
    from newsapp.summarize import extractive
    title = "GMO TECHとGMOトライハッチが合併 MEO事業を統合"
    body = "\n".join(["2026年10月1日", "報道関係各位", "GMO TECHホールディングス株式会社", title,
                      "GMO TECHとGMOトライハッチは本日、合併しました。両社の知見を結集します。"])
    out = extractive(body, title)
    assert out.startswith("GMO TECHとGMOトライハッチは本日") and "報道関係" not in out


def test_ai_summary_retries_until_length_ok(monkeypatch):
    from newsapp import summarize
    monkeypatch.setenv("ANTHROPIC_API_KEY", "x")
    replies = iter(["短い。", "あ" * 150])
    monkeypatch.setattr(summarize, "_claude", lambda *a, **k: next(replies))
    text, src = summarize.summarize_article("T", "本文" * 50)
    assert src == "ai" and len(text) == 150


def test_ai_summary_clips_when_always_too_long(monkeypatch):
    from newsapp import summarize
    monkeypatch.setenv("ANTHROPIC_API_KEY", "x")
    monkeypatch.setattr(summarize, "_claude", lambda *a, **k: "あ" * 300)
    text, _ = summarize.summarize_article("T", "本文")
    assert len(text) <= 200


def test_groups_year_built_from_months(monkeypatch, tmp_path):
    from newsapp import summarize, update
    monkeypatch.setattr(update, "GROUPS", tmp_path / "g.json")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "x")
    seen = []
    monkeypatch.setattr(summarize, "summarize_group", lambda label, lines: seen.append((label, lines)) or f"S{label}")
    arts = [{"url": "a", "title": "t", "date": "2026-09-30", "summary": "A要約"},
            {"url": "b", "title": "t", "date": "2026-08-01", "summary": "B要約"}]
    g = update.group_summaries(arts)
    assert g["2026"]["summary"] == "S2026年"
    assert seen[-1][1] == ["8月: S2026年8月", "9月: S2026年9月"]
