# WKFL ニュースソース管理 (Sources)

このファイルは、WKFL自律型AIメディアエンジンが収集・処理するニュースソースと、それぞれの特性や処理方式を管理するドキュメントです。

## ニュースソース分類と処理方式

WKFLは記事生成のルート（定点観測ルートA / 深掘りルートB）に応じて、ニュースソースを以下のように分類し、別々のパイプラインで処理します。

### 1. ルートA用ソース（Reddit 定点観測）
コミュニティ内の議論全体を定点観測するためのソースです。個々の記事を選ぶ形式ではなく、24時間以内の盛り上がり全体を自動でまとめて記事化（Route A）します。
- **対象ソース**:
  - Reddit (サブレディット: `r/LocalLLM`, `r/LocalLLaMA`, `r/Ollama` など)
- **運用フロー**:
  - `run_all.py` / `synthesize_note.py` による自動運転。
  - **重要**: ルートA専用の処理として完全に別枠で扱うため、個別記事選択用のレポート `news_feed.md` にはリストアップされません。

---

### 2. ルートB用ソース（個別ピックアップニュース）
WKFLが気になった特定のニュースを深掘りして考察（Route B）するためのWeb記事ソースです。
ユーザーが手動でURLを指定して執筆するほか、`list_today_news.py` コマンドで本日の候補記事を `news_feed.md` に一覧化して選別できます。

#### 【タイプB-1】 RSS収集 ＋ 全文取得可能
RSSフィードから自動で最新記事を検知し、かつ本文全文をクリーンにスクレイピング可能なソースです。
- **対象ソース**:
  - PR TIMES (全体新着フィードからキーワードフィルタリング)
  - Reuters Japan (GoogleニュースRSS経由: `site:jp.reuters.com` で自動巡回)
- **運用フロー**:
  - `list_today_news.py` 実行時に、指定キーワード（AI、LLMなど）を含む最新24時間以内のニュースが自動検知され、本文の冒頭サマリー付きで `news_feed.md` に掲載されます。

#### 【タイプB-2】 RSS収集 ＋ 本文制限（ペイウォールなど）あり
RSSから新着記事を自動検知できますが、有料会員限定などの理由で自動スクレイピングでは本文を最後まで取得できないソースです。
- **対象ソース**:
  - MIT Technology Review Japan (`https://www.technologyreview.jp/feed/`)
  - The Information (GoogleニュースRSS経由: `site:theinformation.com` で自動巡回)
- **運用フロー**:
  - 最新記事は自動検知されて `news_feed.md` に掲載されます。
  - 記事化に採用する場合は、ユーザーが会員ログイン後に取得した本文テキストをチャットに入力します。または、他メディアによる要約記事をAIのWeb検索機能を使って補完します。

#### 【タイプB-3】 非RSS ＋ 全文取得可能
公式のRSSフィードがないため、特定のカテゴリー・タグページを直接HTML解析（クローリング）して新着記事を検知し、本文全文をスクレイピングするソースです。
- **対象ソース**:
  - Forbes JAPAN (テクノロジーカテゴリ: `https://forbesjapan.com/category/technology`)
  - WIRED Japan (AIタグ: `https://wired.jp/tag/artificial-intelligence/`, 生成AIタグ: `https://wired.jp/tag/generative-ai/`)
- **運用フロー**:
  - `list_today_news.py` 実行時に、該当ページから直近の記事（キーワード一致するもの）が自動で抽出され、`news_feed.md` に掲載されます。

---

## 収集設定の管理ファイル

すべてのソースのURLや抽出用キーワードは、探索の「切り口」ごとに1ファイルで管理されています（`app/profiles/`）。
- [app/profiles/general.json](file:///Users/kaya.matsumoto/projects/WKFL/app/profiles/general.json)
- [app/profiles/localllm.json](file:///Users/kaya.matsumoto/projects/WKFL/app/profiles/localllm.json)
