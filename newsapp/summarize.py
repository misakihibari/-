"""要約。ANTHROPIC_API_KEY があれば Claude、なければ簡易の抽出要約にフォールバック。"""
from __future__ import annotations

import os
import re

MODEL = os.environ.get("SUMMARY_MODEL", "claude-haiku-4-5-20251001")


def extractive(text: str, n: int = 3, limit: int = 400) -> str:
    sents = [s.strip() for s in re.split(r"(?<=[。.!?！？])\s*|\n+", text) if len(s.strip()) > 8]
    out = " ".join(sents[:n])
    return out[:limit] + ("…" if len(out) > limit else "")


def _claude(prompt: str) -> str:
    import anthropic
    r = anthropic.Anthropic().messages.create(
        model=MODEL, max_tokens=1200,
        messages=[{"role": "user", "content": prompt}])
    return r.content[0].text.strip()


def summarize_article(title: str, body: str) -> str:
    if os.environ.get("ANTHROPIC_API_KEY"):
        return _claude(f"次のニュースリリースを日本語で2〜3文に要約してください。要約のみ出力。\n\n# {title}\n{body[:8000]}")
    return extractive(body)


def summarize_group(label: str, articles: list[dict]) -> str:
    """月または年の複数記事を、箇条書きの要点にまとめる。"""
    if not articles:
        return ""
    if os.environ.get("ANTHROPIC_API_KEY"):
        lines = "\n".join(f"- {a['date']} {a['title']}: {a.get('summary', '')}" for a in articles)
        return _claude(f"GMOTECHホールディングスの{label}のニュースです。主要な動きを日本語の箇条書き"
                       f"(3〜7点、各1文)で要点をまとめてください。箇条書きのみ出力。\n\n{lines[:12000]}")
    return "\n".join(f"・{a['title']}" for a in articles[:7])
