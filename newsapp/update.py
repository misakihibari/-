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
        a["summary"] = summarize.summarize_article(a["title"], a["body"])
        arts[a["url"]] = a
    return arts


def group_summaries(articles: list[dict]) -> dict[str, dict]:
    cache = load(GROUPS, {})
    buckets = defaultdict(list)
    for a in articles:
        buckets[a["date"][:4]].append(a)
        buckets[a["date"][:7]].append(a)
    out = {}
    for key, items in sorted(buckets.items()):
        sig = hashlib.sha1("|".join(sorted(i["url"] for i in items)).encode()).hexdigest()
        if cache.get(key, {}).get("sig") == sig:  # 記事構成が変わった期間だけ再要約
            out[key] = cache[key]
        else:
            label = f"{key[:4]}年" + (f"{int(key[5:])}月" if len(key) > 4 else "")
            out[key] = {"sig": sig, "summary": summarize.summarize_group(label, sorted(items, key=lambda i: i["date"]))}
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--full", action="store_true")
    ap.add_argument("--diagnose", action="store_true")
    args = ap.parse_args()
    if args.diagnose:
        return scrape.diagnose()
    arts = sync_articles(args.full)
    lst = sorted(arts.values(), key=lambda a: (a["date"], a["url"]), reverse=True)
    save(NEWS, lst)
    groups = group_summaries(lst)
    save(GROUPS, groups)
    save(OUT, {"articles": lst, "groups": {k: v["summary"] for k, v in groups.items()}})
    print(f"{len(lst)} articles, oldest={lst[-1]['date'] if lst else '-'}")


if __name__ == "__main__":
    main()
