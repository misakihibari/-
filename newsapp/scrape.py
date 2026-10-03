"""GMOTECH ホールディングスのニュースを取得・解析する。

サイト構造は実物で未検証のため、特定のCSSクラスに依存せず、
「/news/ 配下のリンク + 近傍の日付表記」というヒューリスティックで解析する。
"""
from __future__ import annotations

import re
import time
from datetime import date
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

BASE = "https://hd.gmotech.jp"
LIST_URL = f"{BASE}/news/"
UA = {"User-Agent": "gmotech-news-summary/1.0 (personal reader)"}

DATE_RE = re.compile(r"(20\d{2})\s*[./\-年]\s*(\d{1,2})\s*[./\-月]\s*(\d{1,2})")


def parse_date(text: str) -> date | None:
    m = DATE_RE.search(text or "")
    if not m:
        return None
    try:
        return date(int(m[1]), int(m[2]), int(m[3]))
    except ValueError:
        return None


def _is_article_link(href: str) -> bool:
    p = urlparse(href)
    if p.netloc and p.netloc != urlparse(BASE).netloc:
        return False
    path = p.path.rstrip("/")
    if not path.startswith("/news/") or path == "/news":
        return False
    rest = path[len("/news/"):]
    # ページネーション・カテゴリ・年別アーカイブは記事ではない
    return not re.match(r"^(page|category|tag|archive|\d{4})(/|$)", rest) or bool(
        re.match(r"^\d{4}/\d{2}/\d{2}/", rest))


def parse_list(html: str, page_url: str) -> tuple[list[dict], list[str]]:
    """一覧ページ → (記事 [{url,title,date}], 他の一覧ページURL)"""
    soup = BeautifulSoup(html, "html.parser")
    items: dict[str, dict] = {}
    for a in soup.find_all("a", href=True):
        url = urljoin(page_url, a["href"]).split("#")[0]
        if not _is_article_link(url):
            continue
        d = None
        node = a
        for _ in range(4):  # リンク自身→親へ遡って日付を探す
            d = parse_date(node.get_text(" ", strip=True))
            if d or node.parent is None:
                break
            node = node.parent
        t = a.find("time")
        if t and t.get("datetime"):
            d = parse_date(t["datetime"]) or d
        title = a.get_text(" ", strip=True)
        title = DATE_RE.sub("", title).strip(" 　|｜-") if title else ""
        cur = items.get(url)
        if cur is None or len(title) > len(cur["title"]):
            items[url] = {"url": url, "title": title, "date": d.isoformat() if d else None}
    pages = set()
    for a in soup.find_all("a", href=True):
        url = urljoin(page_url, a["href"]).split("#")[0]
        u = urlparse(url)
        if u.netloc != urlparse(BASE).netloc or url == page_url:
            continue
        if re.fullmatch(r"/news/page/\d+/?", u.path) or (u.path.rstrip("/") == "/news" and "page=" in u.query):
            pages.add(url)
    nxt = soup.find("link", rel="next") or soup.find("a", rel="next")
    if nxt and nxt.get("href"):
        pages.add(urljoin(page_url, nxt["href"]))
    return list(items.values()), sorted(pages)


def parse_article(html: str, url: str) -> dict:
    soup = BeautifulSoup(html, "html.parser")
    for t in soup(["script", "style", "nav", "header", "footer", "aside", "form", "noscript"]):
        t.decompose()
    h1 = soup.find("h1")
    og = soup.find("meta", property="og:title")
    title = (h1.get_text(" ", strip=True) if h1 else "") or (og["content"] if og else "")
    d = None
    tm = soup.find("time")
    if tm:
        d = parse_date(tm.get("datetime") or tm.get_text())
    if not d:
        d = parse_date(soup.get_text(" ", strip=True)[:2000])
    body_el = (soup.find("article") or soup.select_one(".entry-content, .post-content, .news-detail, .article")
               or soup.find("main") or soup.body)
    paras = [p.get_text(" ", strip=True) for p in body_el.find_all(["p", "li", "h2", "h3", "td", "th"])] if body_el else []
    body = "\n".join(p for p in paras if p) or (body_el.get_text("\n", strip=True) if body_el else "")
    return {"url": url, "title": title, "date": d.isoformat() if d else None, "body": body}


def _get(session: requests.Session, url: str) -> str:
    for i in range(3):
        try:
            r = session.get(url, headers=UA, timeout=30)
            r.raise_for_status()
            r.encoding = r.apparent_encoding if r.encoding in (None, "ISO-8859-1") else r.encoding
            return r.text
        except requests.RequestException:
            if i == 2:
                raise
            time.sleep(2 ** (i + 1))
    raise AssertionError


def crawl_list(session: requests.Session | None = None, known: set[str] = frozenset(),
               max_pages: int = 500, stop_when_known: bool = False) -> list[dict]:
    """一覧を巡回して記事メタを返す。stop_when_known=True なら既知記事のみのページで打ち切る(差分更新)。

    リンクから辿れる一覧ページを先に巡回し、その後 /news/page/N/ を連番で試して取りこぼしを拾う。
    """
    s = session or requests.Session()
    seen_pages, queue, found = set(), [LIST_URL], {}

    def visit(url: str) -> list[str] | None:
        """一覧1ページを処理。取得失敗(404等)なら None、成功なら新規記事URLのリスト。"""
        seen_pages.add(url)
        try:
            items, pages = parse_list(_get(s, url), url)
        except requests.RequestException as e:
            print(f"  skip {url}: {e}")
            return None
        new = [i["url"] for i in items if i["url"] not in found]
        for i in items:
            found.setdefault(i["url"], i)
        queue.extend(p for p in pages if p not in seen_pages and p not in queue)
        dates = [i["date"] for i in items if i["date"]]
        print(f"  {url}: {len(items)} items, {len(new)} new, oldest={min(dates) if dates else '-'}")
        time.sleep(1)
        return new

    while queue and len(seen_pages) < max_pages:
        url = queue.pop(0)
        if url in seen_pages:
            continue
        new = visit(url)
        if stop_when_known and new is not None and not [u for u in new if u not in known]:
            return list(found.values())

    # 連番プローブ(リンク抽出で見つからないページ送りの救済)
    n, misses = 2, 0
    while len(seen_pages) < max_pages and misses < 2:
        url = f"{LIST_URL}page/{n}/"
        n += 1
        if url in seen_pages:
            continue
        new = visit(url)
        if new is None or not new:
            misses += 1 if new is None else 2
            continue
        misses = 0
        if stop_when_known and not [u for u in new if u not in known]:
            break
    return list(found.values())


def diagnose() -> None:
    """一覧ページの構造を出力(ページ送りの調査用)。"""
    html = _get(requests.Session(), LIST_URL)
    soup = BeautifulSoup(html, "html.parser")
    items, pages = parse_list(html, LIST_URL)
    print(f"articles on first page: {len(items)}; detected list pages: {pages}")
    print("--- non-article links under /news or containing page/paged ---")
    for a in soup.find_all("a", href=True):
        h = a["href"]
        if (("/news" in h) and not _is_article_link(urljoin(LIST_URL, h))) or "page" in h:
            print(h, "|", a.get_text(" ", strip=True)[:40])
    print("--- pagination-like elements ---")
    for el in soup.select("[class*=pag], [class*=more], [class*=load], nav"):
        print(str(el)[:400].replace("\n", " "))
    print("--- script hints ---")
    for sc in soup.find_all("script"):
        t = sc.string or ""
        if re.search(r"ajax|wp-json|load.?more|paged", t, re.I):
            print(t[:300].replace("\n", " "))
    for url in (f"{BASE}/wp-json/wp/v2/posts?per_page=1", f"{LIST_URL}page/2/", f"{LIST_URL}2014/"):
        try:
            r = requests.get(url, headers=UA, timeout=30)
            print(url, r.status_code, len(r.text))
        except requests.RequestException as e:
            print(url, "ERR", e)


def fetch_article(url: str, session: requests.Session | None = None) -> dict:
    return parse_article(_get(session or requests.Session(), url), url)
