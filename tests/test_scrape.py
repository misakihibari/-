from newsapp import scrape, update

LIST = """<ul><li><a href="/news/2026/09/30/abc/"><time datetime="2026-09-30">2026.09.30</time> 新サービス開始</a></li>
<li><span>2025年3月1日</span><a href="/news/2025/03/01/x/">決算のお知らせ</a></li></ul>
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
