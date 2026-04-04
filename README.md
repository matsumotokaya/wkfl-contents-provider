# WKFL 自律型AIメディアエンジン

**最終更新: 2026-04-04**

> このドキュメントは、本システムをゼロから引き継ぐLLMやエンジニアのための完全な仕様書です。

---

## 何をするシステムか

毎朝、RedditのAI関連サブレディットを自動収集し、日本語の解説記事（Markdown）を生成する自律型メディアエンジン。

**アウトプットイメージ**: `note/AI_Briefing_2026-04-04.md`

AIポッドキャストパーソナリティ「WKFL」のスタイルで、3つのコーナー形式の記事を毎日1本生成する。ターゲット媒体はnote（ブログ）。将来的にはXへの自動投稿も対象。

---

## 現在の状態（2026-04-04時点）

| ステップ | 状態 | 備考 |
|---|---|---|
| RSS収集 (`ingest_rss.py`) | ✅ 動作中 | 4サブレディット、24時間フィルタ |
| 記事生成 (`synthesize_note.py`) | ✅ 動作中 | **Anthropic API接続済み**（旧Mockから移行完了） |
| 全体実行 (`run_all.py`) | ✅ 動作中 | 上記2ステップを順に実行 |
| note投稿 | 🔲 手動 | 生成されたMDファイルをブラウザで貼り付け |
| X投稿 | 🔲 未実装 | 将来フェーズ |
| Web UI | 🔲 未実装 | 将来フェーズ |

---

## ディレクトリ構成

```
WKFL/
├── README.md              ← このファイル
├── .env                   ← APIキー（gitignore済み）
├── .env.example           ← キーのテンプレート
├── .gitignore
├── requirements.txt       ← Python依存パッケージ
├── note/                  ← 生成された記事の出力先
│   └── AI_Briefing_YYYY-MM-DD.md
└── X/
    ├── data/
    │   ├── db/
    │   │   └── user_config.json   ← RSSソース設定
    │   └── raw_feeds/
    │       └── YYYY-MM-DD_raw.json ← 当日の取得データ
    ├── drafts/            ← X投稿の下書き（将来用）
    ├── posted/            ← X投稿済みログ（将来用）
    └── scripts/
        ├── run_all.py          ← エントリーポイント
        ├── ingest_rss.py       ← Step 1: RSS取得
        └── synthesize_note.py  ← Step 2: AI記事生成
```

---

## セットアップ

### 必要なもの
- Python 3.11+
- Anthropic APIキー（`sk-ant-...`）

### インストール

```bash
cd /Users/kaya.matsumoto/projects/WKFL
pip3 install -r requirements.txt
```

`requirements.txt` の内容:
```
anthropic>=0.89.0
feedparser>=6.0.0
python-dotenv>=1.0.0
```

### 環境変数

`.env.example` をコピーして `.env` を作成:
```bash
cp .env.example .env
```

`.env` の内容:
```
ANTHROPIC_API_KEY=sk-ant-xxxxx
```

`.env` は `.gitignore` に含まれており、Gitにはコミットされない。

---

## 実行方法

### Web UI（推奨）

```bash
cd /Users/kaya.matsumoto/projects/WKFL
python3 -m uvicorn app.main:app --reload
```

ブラウザで `http://localhost:8000` を開く。「今日の記事を生成」ボタンを押すと記事生成が走り、完了後に一覧に表示される。

### CLIのみ

```bash
cd /Users/kaya.matsumoto/projects/WKFL
python3 X/scripts/run_all.py
```

これだけ。以下の2ステップが順に実行される:

1. **RSS収集**: 4つのサブレディットから過去24時間の投稿を取得 → `X/data/raw_feeds/YYYY-MM-DD_raw.json`
2. **記事生成**: Anthropic APIを呼び出して日本語記事を生成 → `note/AI_Briefing_YYYY-MM-DD.md`

既に当日のraw JSONがある場合（再生成したいとき）はStep 2だけ実行:

```bash
python3 X/scripts/synthesize_note.py
```

### モデル切り替え

デフォルトは `claude-sonnet-4-6`（安価・高速）。Opusに切り替えるには:

```bash
WKFL_MODEL=claude-opus-4-6 python3 X/scripts/synthesize_note.py
```

---

## RSSソース設定

`X/data/db/user_config.json` でソースを管理する。

```json
{
  "sources": [
    { "name": "Reddit: r/ArtificialInteligence", "url": "https://www.reddit.com/r/ArtificialInteligence/new/.rss", "active": true },
    { "name": "Reddit: r/MachineLearning",        "url": "https://www.reddit.com/r/MachineLearning/new/.rss",        "active": true },
    { "name": "Reddit: r/OpenAI",                 "url": "https://www.reddit.com/r/OpenAI/new/.rss",                 "active": true },
    { "name": "Reddit: r/LocalLLaMA",             "url": "https://www.reddit.com/r/LocalLLaMA/new/.rss",             "active": true }
  ]
}
```

`active: false` にすると収集対象から外れる。URLを追加すれば即対応。

---

## AIペルソナ・番組構成

### WKFLのパーソナリティ

- **名前**: WKFL（ウォッチフル）
- **スタイル**: AIプロダクト起業家・開発者の視点で批評する、軽妙なポッドキャストパーソナリティ
- **解説**: 客観的に300文字程度でニュース事実を伝える
- **レビュー（WKFL's Eye）**: 労働・市場・開発者への影響を鋭く300文字程度で論評する
- **導入・締め**: 肩の力を抜いたナチュラルな口語体

### 3コーナー構成（記事フォーマット）

| コーナー | 絵文字 | 内容 |
|---|---|---|
| Macro AI Trends | 📰 | AI業界全体のマクロ動向・大企業発表・モデル進化 |
| Reddit's Lab | 🔥 | 個人の実験・変わったビルド・コミュニティ内ハック |
| AI Coding | ⚙️ | バイブコーディング・AI駆動開発ツールの最前線 |

各コーナー1〜2件、合計3〜6件のトピックを選定して記事化する。

---

## 技術的ポイント

### SSL・UA対策（Reddit対策）

`ingest_rss.py` では以下を実施しないとブロックされる:

```python
context = ssl._create_unverified_context()  # SSL証明書検証を無効化
headers = {"User-Agent": "Mozilla/5.0 ...Chrome/120..."}  # ブラウザ偽装
```

### プレフィルタ（トークン削減）

`synthesize_note.py` の `prefilter_entries()` で以下を除去:
- HTMLタグを除去してテキストのみ抽出
- 本文80文字未満の投稿（リンクのみ投稿など）
- 「help」「how do I」など質問系タイトルの投稿
- サマリを500文字で切り詰め

実績: 81件 → 70件（13.5%削減）、入力トークン約15,000（プレフィルタなしの推定40,000〜から削減）

### ハルシネーション防止

プロンプトに「RAW DATAに含まれる情報のみ使用・ソースリンクは実データから取得」を明記。

---

## コスト分析（2026-04-04 実測値）

| 項目 | 実測値 |
|---|---|
| サブレディット数 | 4 |
| 取得投稿数（24時間フィルタ後） | 81件 |
| プレフィルタ後 | 70件 |
| 入力トークン | 15,354 |
| 出力トークン | 2,729 |

| モデル | 入力単価 | 出力単価 | 1回コスト | 月コスト（30日） |
|---|---|---|---|---|
| **claude-sonnet-4-6**（デフォルト） | $3 / 1M | $15 / 1M | **約$0.09（13円）** | 約$2.7（400円） |
| claude-opus-4-6 | $15 / 1M | $75 / 1M | **約$0.44（65円）** | 約$13（1,900円） |

---

## 将来のロードマップ

### フェーズ2: Web管理画面

- **目的**: ターミナル不要でブラウザから記事生成・確認できる
- **技術スタック**: Next.js（Vercel）+ FastAPI（バックエンド）
- **機能**: 生成記事のプレビュー、再生成ボタン、ソース管理UI

### フェーズ3: SaaS化・X自動投稿

- **X投稿**: 生成記事から自動でツイート切り出し → Tweepyで投稿
- **マルチユーザー**: Supabase/PostgreSQLでユーザーごとに設定保存
- **サブスクリプション**: 認証・課金機能

### 将来のDBスキーマ（SaaS時）

| テーブル | 主な役割 |
|---|---|
| `users` | 認証情報・暗号化APIキー |
| `sources` | ユーザーごとのRSSフィードリスト |
| `personas` | AIエディターのペルソナ・プロンプト定義 |
| `contents` | 生成記事・SNS投稿のライフサイクル管理（draft→approved→posted） |
| `logs` | 実行ログ・エラー記録 |
