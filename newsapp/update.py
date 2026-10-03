"""data/news.json を更新し、web/data.json(記事+月別/年別要約)を生成する。

  python -m newsapp.update          # 差分更新(新着のみ取得)
  python -m newsapp.update --full   # 全件取得し直し
"""
from __future__ import annotations

import argparse
import hashlib
import json
import time
from collections import defaultdict
from pathlib import Path

import requests

from . import scrape, summarize

ROOT = Path(__file__).resolve().parent.parent
NEWS = ROOT / "data" / "news.json"
GROUPS = ROOT / "data" / "group_summaries.json"
OUT = ROOT / "docs" / "data.json"


def load(p: Path, default):
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else default


def save(p: Path, obj):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, ensure_ascii=False, indent=1), encoding="utf-8")


def sync_articles(full: bool) -> dict[str, dict]:
    arts = {} if full else {a["url"]: a for a in load(NEWS, [])}
    s = requests.Session()
    fresh: list[dict] = []
    metas = scrape.crawl_list(s, known=set(arts), stop_when_known=not full and bool(arts))
    for m in metas:
        if m["url"] in arts:
            continue
        try:
            a = scrape.fetch_article(m["url"], s)
        except requests.RequestException as e:
            print(f"  skip article {m['url']}: {e}")
            continue
        time.sleep(0.3)
        a["title"] = a["title"] or m["title"]
        a["date"] = m["date"] or a["date"]  # 一覧の日付を優先
        if not a["date"]:
            continue
        arts[a["url"]] = a
        fresh.append(a)
    summarize.summarize_many(fresh)
    return arts


def group_summaries(articles: list[dict]) -> dict[str, dict]:
    """月ごとに記事要約からまとめ、年ごとには月の要約をまとめる(キャッシュ: 記事構成が変わった期間のみ再生成)。"""
    cache = load(GROUPS, {})
    buckets = defaultdict(list)
    for a in articles:
        buckets[a["date"][:7]].append(a)
    out: dict[str, dict] = {}

    def make(key: str, label: str, urls: list[str], lines: list[str]):
        sig = hashlib.sha1(("|".join(sorted(urls)) + str(summarize.has_ai())).encode()).hexdigest()
        if cache.get(key, {}).get("sig") == sig and cache[key].get("summary"):
            out[key] = cache[key]
        else:
            out[key] = {"sig": sig, "summary": summarize.summarize_group(label, lines)}

    for key, items in sorted(buckets.items()):
        items.sort(key=lambda i: i["date"])
        make(key, f"{key[:4]}年{int(key[5:])}月", [i["url"] for i in items], [f"{i['date']} {i['summary']}" for i in items])
    for y in sorted({k[:4] for k in buckets}):
        months = [k for k in sorted(buckets) if k.startswith(y)]
        make(y, f"{y}年", [i["url"] for k in months for i in buckets[k]],
             [f"{int(k[5:])}月: {out[k]['summary']}" for k in months if out[k]["summary"]])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--full", action="store_true")
    ap.add_argument("--diagnose", action="store_true")
    ap.add_argument("--resummarize", action="store_true", help="保存済み本文から要約だけ作り直す(再取得なし)")
    args = ap.parse_args()
    if args.diagnose:
        return scrape.diagnose()
    if args.resummarize:
        arts = {a["url"]: a for a in load(NEWS, [])}
        # AI要約済みの記事は飛ばす(途中で止まっても再実行で続きから)
        todo = [a for a in arts.values() if summarize.has_ai() and a.get("summary_src") != "ai"
                or not summarize.has_ai() and a.get("summary_src") != "extract"]
        print(f"summarizing {len(todo)} / {len(arts)} articles (ai={summarize.has_ai()})")
        summarize.summarize_many(todo)
    else:
        arts = sync_articles(args.full)
    lst = sorted(arts.values(), key=lambda a: (a["date"], a["url"]), reverse=True)
    save(NEWS, lst)
    groups = group_summaries(lst)
    save(GROUPS, groups)
    save(OUT, {"articles": lst, "groups": {k: v["summary"] for k, v in groups.items()}})
    print(f"{len(lst)} articles, oldest={lst[-1]['date'] if lst else '-'}")


if __name__ == "__main__":
    main()
