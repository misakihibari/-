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
               max_pages: int = 200, stop_when_known: bool = False) -> list[dict]:
    """一覧を巡回して記事メタを返す。stop_when_known=True なら既知記事のみのページで打ち切る(差分更新)。"""
    s = session or requests.Session()
    seen_pages, queue, found = set(), [LIST_URL], {}
    while queue and len(seen_pages) < max_pages:
        url = queue.pop(0)
        if url in seen_pages:
            continue
        seen_pages.add(url)
        items, pages = parse_list(_get(s, url), url)
        new = [i for i in items if i["url"] not in known]
        for i in items:
            found.setdefault(i["url"], i)
        if stop_when_known and not new:
            break
        queue += [p for p in pages if p not in seen_pages and p not in queue]
        time.sleep(1)
    return list(found.values())


def fetch_article(url: str, session: requests.Session | None = None) -> dict:
    return parse_article(_get(session or requests.Session(), url), url)
