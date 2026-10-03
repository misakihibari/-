"""要約。

- ANTHROPIC_API_KEY がある場合: Claude が全文を読んで 100〜200 文字に要約する。
- ない場合: 本文の抜粋(200文字以内)で代用し、summary_src="extract" として区別する。
"""
from __future__ import annotations

import os
import re
from concurrent.futures import ThreadPoolExecutor

MODEL = os.environ.get("SUMMARY_MODEL", "claude-haiku-4-5-20251001")
MIN_CHARS, MAX_CHARS = 100, 200

_HEADER = re.compile(r"^(報道関係各位|お客様各位|関係各位|各位|プレスリリース|ニュースリリース)")
_DATE = re.compile(r"^(19|20)\d{2}\s*[年./]\s*\d{1,2}\s*[月./]\s*\d{1,2}\s*日?$")


def has_ai() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


def _boilerplate(line: str, title: str) -> bool:
    t = re.sub(r"\s+", "", line)
    nt = re.sub(r"\s+", "", title)
    if not t or _HEADER.match(t) or _DATE.match(t):
        return True
    if t in nt or nt in t:  # タイトルの重複
        return True
    return len(t) <= 30 and bool(re.fullmatch(r"(株式会社)?[\w・&＆\-]+(株式会社|ホールディングス|\(.*\))?", t))


def clip(text: str, limit: int = MAX_CHARS) -> str:
    """limit 文字以内に、できるだけ文の区切りで切る。"""
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= limit:
        return text
    cut = text[:limit]
    i = max(cut.rfind("。"), cut.rfind("。 "))
    return cut[: i + 1] if i >= MIN_CHARS else cut[: limit - 1] + "…"


def extractive(text: str, title: str = "", limit: int = MAX_CHARS) -> str:
    """見出し・日付・宛名・社名・タイトル重複を除き、最初の本文を limit 文字以内で返す。"""
    lines = [l for l in text.split("\n") if not _boilerplate(l, title)]
    return clip(" ".join(lines), limit)


def _claude(prompt: str, max_tokens: int = 600) -> str:
    import anthropic
    r = anthropic.Anthropic(max_retries=5).messages.create(
        model=MODEL, max_tokens=max_tokens, messages=[{"role": "user", "content": prompt}])
    return r.content[0].text.strip()


def summarize_article(title: str, body: str) -> tuple[str, str]:
    """(要約, 方式) を返す。方式は 'ai' か 'extract'。"""
    if not has_ai():
        return extractive(body, title), "extract"
    prompt = (
        f"次のニュースリリースの全文を読み、内容を解釈して、日本語で{MIN_CHARS}〜{MAX_CHARS}文字に要約してください。\n"
        "・誰が/何を/どうした/なぜ重要か、を押さえる\n"
        "・タイトルの言い換えや本文の丸写しは避け、要点を自分の言葉でまとめる\n"
        "・要約の文章だけを出力(前置き・記号・改行なし)\n\n"
        f"# {title}\n{body[:12000]}")
    text = ""
    for _ in range(3):
        text = re.sub(r"\s+", " ", _claude(prompt)).strip()
        if MIN_CHARS <= len(text) <= MAX_CHARS:
            return text, "ai"
        prompt += f"\n\n(前回は{len(text)}文字でした。必ず{MIN_CHARS}〜{MAX_CHARS}文字にしてください)"
    return clip(text), "ai"  # 3回外れたら200字で丸める


def summarize_many(articles: list[dict], workers: int = 8) -> None:
    """記事に summary / summary_src を付与(並列)。失敗した記事は触らず、次回実行で再試行できる。"""
    def one(a: dict) -> None:
        try:
            a["summary"], a["summary_src"] = summarize_article(a["title"], a["body"])
        except Exception as e:  # noqa: BLE001 — 1件の失敗で全体を止めない
            print(f"  summarize failed {a['url']}: {e}")
    with ThreadPoolExecutor(workers) as ex:
        list(ex.map(one, articles))


def summarize_group(label: str, lines: list[str]) -> str:
    """月または年の要約。lines は各記事の要約(年の場合は各月の要約)。AIがなければ空文字。"""
    if not lines or not has_ai():
        return ""
    joined = "\n".join(f"- {l}" for l in lines)[:30000]
    return _claude(
        f"GMOTECHホールディングスの{label}のニュースの要約一覧です。この期間の主要な動きを、"
        "日本語の箇条書き(3〜7点、各1文、各行の先頭に「・」)で要約してください。箇条書きのみ出力。\n\n" + joined,
        max_tokens=900)
