# GMOTECH ニュース要約

https://hd.gmotech.jp/news/ を巡回し、全文と要約を年・月タブで閲覧できる静的Webアプリ。

- `python -m newsapp.update --full` 全件取得+要約 / 引数なしは新着のみ(差分)
- `docs/` を開くだけで閲覧可(`python -m http.server -d docs`)。GitHub Pages 等で公開できます
- `.github/workflows/update.yml` が3時間ごとに更新しコミット(= 新着連動)。要約を Claude で行うには Secret `ANTHROPIC_API_KEY` を設定(未設定時は簡易抽出要約)
- 要約は Claude が全文を読んで100〜200文字にまとめます(`ANTHROPIC_API_KEY` 必須。未設定時は本文の抜粋を「本文の抜粋」と明示して表示)。月の要約は記事要約から、年の要約は月の要約から作ります
- 要約だけ作り直す: Actions の「要約だけ作り直す」(AI要約済みの記事は飛ばすので、途中で止まっても再実行で続きから)
- ⚠ 開発環境から対象サイトに接続できず、HTML解析は実サイトで未検証。初回は `--full` 実行後に件数・日付を確認し、必要なら `newsapp/scrape.py` を調整
