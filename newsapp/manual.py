"""Claude(対話セッション)が手で書いた要約を取り込むための道具。APIキー不要。

  python -m newsapp.manual status                 # 進捗
  python -m newsapp.manual dump 30 [年]            # 未要約の記事を新しい順に30件、読む用に出力
  python -m newsapp.manual apply FILE.json        # {id: 要約} を検証して取り込み
  python -m newsapp.manual groups [年]            # 全記事の要約が揃った月の要約材料を出力
  python -m newsapp.manual apply-groups FILE.json # {"2026-09": "...", "2026": "..."} を取り込み
"""
from __future__ import annotations

import hashlib
import json
import re
import sys

from . import summarize, update

MIN, MAX = summarize.MIN_CHARS, summarize.MAX_CHARS


def aid(url: str) -> str:
    return hashlib.sha1(url.encode()).hexdigest()[:6]


def _load():
    return update.load(update.NEWS, [])


def _publish(arts: list[dict]):
    arts.sort(key=lambda a: (a["date"], a["url"]), reverse=True)
    update.save(update.NEWS, arts)
    groups = update.group_summaries(arts)
    update.save(update.GROUPS, groups)
    update.save(update.OUT, {"articles": arts, "groups": {k: v["summary"] for k, v in groups.items()}})


def _core(a: dict, limit: int) -> str:
    lines = [l.strip() for l in a["body"].split("\n") if not summarize._boilerplate(l, a["title"])]
    text = " ".join(lines)
    text = re.split(r"(会社名\s|【?会社概要|■?会社概要|お問い合わせ先|【本件に関するお問い合わせ|＜本件に関する)", text)[0]
    return text[:limit]


def status():
    arts = _load()
    done = [a for a in arts if a.get("summary_src") == "ai"]
    print(f"{len(done)}/{len(arts)} summarized")
    for y in sorted({a["date"][:4] for a in arts}, reverse=True):
        ys = [a for a in arts if a["date"][:4] == y]
        print(y, sum(a.get("summary_src") == "ai" for a in ys), "/", len(ys))


def dump(n: int, year: str | None):
    arts = [a for a in _load() if a.get("summary_src") != "ai" and (not year or a["date"].startswith(year))]
    for a in arts[:n]:
        print(f"[{aid(a['url'])}] {a['date']} {a['title']}\n{_core(a, 520)}\n")
    print(f"-- {min(n, len(arts))} shown, {len(arts)} remaining", file=sys.stderr)


def apply(path: str):
    data = json.load(open(path, encoding="utf-8"))
    arts = _load()
    by = {aid(a["url"]): a for a in arts}
    bad = []
    for k, text in data.items():
        text = re.sub(r"\s+", " ", text).strip()
        if k not in by:
            bad.append((k, "unknown id"))
        elif not MIN <= len(text) <= MAX:
            bad.append((k, f"{len(text)} chars"))
        else:
            by[k]["summary"], by[k]["summary_src"] = text, "ai"
    _publish(arts)
    print(f"applied {len(data) - len(bad)}, rejected {len(bad)}: {bad}")


def groups(year: str | None):
    arts = _load()
    cur = update.load(update.GROUPS, {})
    months = sorted({a["date"][:7] for a in arts if not year or a["date"].startswith(year)}, reverse=True)
    for m in months:
        items = [a for a in arts if a["date"][:7] == m]
        if all(a.get("summary_src") == "ai" for a in items) and not cur.get(m, {}).get("manual"):
            print(f"== {m} ({len(items)}件)")
            for a in sorted(items, key=lambda a: a["date"]):
                print(f"- {a['date'][5:]} {a['summary']}")
            print()


def apply_groups(path: str):
    data = json.load(open(path, encoding="utf-8"))
    cache = update.load(update.GROUPS, {})
    arts = _load()
    for k, text in data.items():
        urls = [a["url"] for a in arts if a["date"].startswith(k)] if len(k) == 7 else \
               [a["url"] for a in arts if a["date"].startswith(k)]
        sig = hashlib.sha1(("|".join(sorted(urls)) + str(summarize.has_ai())).encode()).hexdigest()
        cache[k] = {"sig": sig, "summary": text.strip(), "manual": True}
    update.save(update.GROUPS, cache)
    _publish(arts)
    print(f"applied {len(data)} group summaries")


if __name__ == "__main__":
    cmd, *a = sys.argv[1:]
    {"status": lambda: status(), "dump": lambda: dump(int(a[0]), a[1] if len(a) > 1 else None),
     "apply": lambda: apply(a[0]), "groups": lambda: groups(a[0] if a else None),
     "apply-groups": lambda: apply_groups(a[0])}[cmd]()
