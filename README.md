# WKFL 自律型AIメディアエンジン

**最終更新: 2026-06-09**

---

## アカウント・配信先（基本情報）

| 媒体 | アカウント / URL |
|---|---|
| 番組名 | WKFLのAI TODAY |
| note | https://note.com/wkflstudio |
| X | https://x.com/wkflstudio |
| YouTube | https://www.youtube.com/@WKFL-m3p |
| Spotify | https://open.spotify.com/show/3ExVQrRg3eXrmAm6ajW3eq |

---

## 全体フロー

```
【第1段階：情報収集・調査フェーズ】
ニュース取得 (RSS / HTMLスクレイピング / Reddit)
  ├─ ジェネラル版 (AI全般) → news_feed.md
  └─ テーマ特化版 (ローカルLLM, TTS等) → news_feed_{theme}.md

        ↓

【第2段階：記事生成フェーズ】
キュレーションしたニュースを記事化
  ├─ ルートA: スクレイピング・プラン（Reddit自動収集）
  ├─ ルートB: ピックアップ・ニュース（URLベース）
  └─ ルートC: フリートーク（考察テーマベース）
```

---

## ニュース取得・調査フェーズ（第1段階）

テーマ別の最新ニュースを自動収集し、AIサマリー付きのキュレーション用フィードを生成します。

### 基本コマンド

```bash
# ジェネラル版（AI全般）
python3 app/engine/list_today_news.py

# テーマ特化版（例：ローカルLLM）
python3 app/engine/list_today_news.py --theme localllm
```

### 実行結果

出力ファイル: `articles/YYYY-MM-DD/news_feed.md` または `news_feed_{theme}.md`

**ファイルの内容**:
1. **記事一覧**: 日付・タイトル・説明付きで表示
2. **AIによる要約**: 重複テーマを統合し、業界への影響を分析（自動生成）

### 利用可能なテーマ（探索プロファイル）

収集の「切り口」は `app/profiles/` 配下に1ファイル1プロファイルで管理する。`general`/`localllm` はその一例に過ぎず、ファイルを追加するだけで新しい切り口を増やせる再利用可能な仕組みになっている。

- `general` — AI全般を幅広くキャッチアップ（`app/profiles/general.json`）
- `localllm` — ローカルLLM関連の深掘り情報（`app/profiles/localllm.json`）
- その他のテーマは `app/profiles/` に新規JSONファイルを追加するだけでカスタマイズ可能

### テーマのカスタマイズ（新しい切り口の追加）

新しいテーマを追加する場合（例：TTS関連のニュース）は、`app/profiles/tts.json` を新規作成する：

```json
{
  "name": "Text-to-Speech Specialist",
  "google_news_keywords": [
    "Text-to-Speech", "TTS", "音声合成", "音声生成", "ボイスクローニング"
  ],
  "google_news_limit": 20,
  "google_news_time_filter_hours": 168,
  "sources": []
}
```

既存の `app/profiles/general.json` や `app/profiles/localllm.json` を編集する必要は一切ない。ファイルを1つ追加するだけで切り口が増える。

その後、`python3 app/engine/list_today_news.py --theme tts` を実行。

> [!NOTE]
> **設定の正本（SSOT）について**
> - `google_news_keywords` に列挙した語は、そのまま各地域のGoogle Newsへの検索クエリとして発行され、取得後の絞り込みフィルタにも使われる。**検索範囲はこの配列が唯一の正本**（コード側にキーワードのハードコードは無い）。
> - `google_news_limit` / `google_news_time_filter_hours` を省略した場合の既定値は `app/engine/ingest_rss.py` の定数で一元管理。
> - 対象地域リストは同ファイルの `GOOGLE_NEWS_REGIONS` 定数が正本。現在は英語圏・日本語圏のエディションに限定（最大9エディションまで拡張可能で、追加分は定数直下にコメントで控えてある）。地域を増減すればログ表示にも自動反映される。

> [!WARNING]
> **Reddit RSSのレート制限（429）について（2026-07-16確認）**
> - `ingest_rss.py` は複数のReddit系サブレディットを同一実行内で連続取得するが、1回の実行で**最初の1サブレディット（25件程度）を取得した直後から、以降のサブレディットが軒並み `HTTP 429 Too Many Requests` で失敗する**事象を確認済み。
> - 現状のコードは各フィード取得後に `time.sleep(2)` を挟んでいるだけで、Reddit側の制限を回避できていない。Reddit側がスクレイピング対策を強化してきている可能性が高く、**「同一実行内で複数サブレディットを一気に取る」というこれまでのやり方は前提が崩れつつある**。
> - 対処が必要な場合は、取得間隔をさらに空ける・実行を複数回に分割する・取得するサブレディット数を減らすといった工夫が要る（現時点では未実装）。
> - 実行時に一部サブレディットが429で失敗しても、取得できたものだけでDossier以降のプロセスを進めて構わない（その場合は取得元が偏っている旨をユーザーに一言断ってから進める）。

---

## 記事生成のルート（第2段階：実行方法）

> **前提**: 第1段階でニュースフィード（`news_feed.md` または `news_feed_{theme}.md`）を取得済みの状態。  
> ニュース取得がまだの場合は、上の「ニュース取得・調査フェーズ」セクションから開始してください。

### ルートA: スクレイピング・プラン (Scraping Plan)
Redditから最新の議論を自動抽出し、API経由で一気にドラフトを生成する「定点観測」ルート。  
**第1段階**: RSS収集 → **第2段階**: 記事生成

```bash
cd /Users/kaya.matsumoto/projects/WKFL
python3 app/engine/run_all.py
```
- **実行場所**: ターミナル、またはGitHub Actions（毎朝自動実行）
- **メリット**: 手間ゼロでAI界隈の「空気感」をキャッチアップできる
- **注意**: Reddit RSSのレート制限（429）により、複数サブレディットのうち一部しか取得できないことがある。詳細は上の「ニュース取得・調査フェーズ」セクション内の警告を参照。

### ルートB: ピックアップ・ニュース (Pickup News)
WKFLが気になった特定のニュースURL（3本前後）を読み込ませ、対話を通じて深い考察を加える「深掘り」ルート。

1. **メイン：チャット上での対話生成**
   - URLをこのチャットに投げ、エージェント（私）に内容の抽出と、WKFLペルソナによるスタイリングを依頼する
2. **補助：CLIでの一括処理**
   - APIキーを使って機械的にファイル生成まで行いたい場合は以下を使用する
   ```bash
   python3 app/engine/synthesize_articles.py "URL1" "URL2" "URL3"
   ```

### ルートC: フリートーク (FreeTalk)
WKFLが語りたいテーマや考察を口頭・テキストで投げ、それをそのまま記事に仕立てる「持ち込み企画」ルート。外部記事もURLも不要。WKFLの頭の中にあるものが素材になる。

**現行シリーズ: AI業界用語ピックアップ**
今旬のAI業界キーワードを1回1ワード取り上げ、WKFLの視点で解説・考察していく連続企画。

| 回 | キーワード |
|---|---|
| #1 | コンテキストグラフ |

1. **メイン：チャット上での対話生成**
   - テーマ・考え方・考察をこのチャットに投げ、エージェント（私）がWKFLペルソナで記事に仕立てる
   - 対話で肉付けしながら進めるのが基本スタイル
2. **補助：CLIでの一括処理**
   - メモをテキストファイルにまとめてある場合は以下を使用する
   ```bash
   python3 app/engine/synthesize_freetalk.py myideas.txt
   ```
   - stdinで直打ちする場合（Ctrl+Dで終了）
   ```bash
   python3 app/engine/synthesize_freetalk.py
   ```

---

## 何をするシステムか

毎朝、RedditのAI関連サブレディットを自動収集し、日本語の解説記事（Markdown）を生成する自律型メディアエンジン。

**アウトプットイメージ**: `articles/2026-04-04/reddit.md`

AIポッドキャストパーソナリティ「WKFL」のスタイルで、3つのコーナー形式の記事を毎日1本生成する。ターゲット媒体はnote（ブログ）。将来的にはXへの自動投稿も対象。

---

## 現在の状態（2026-06-09時点）

### 第1段階：ニュース取得・調査フェーズ

| ステップ | 状態 | 備考 |
|---|---|---|
| RSS収集 (`ingest_rss.py`) | ✅ 動作中 | テーマ別・キーワードフィルター対応。Google News統合処理実装済み |
| ニュースフィード生成 (`list_today_news.py`) | ✅ 動作中 | ジェネラル版・テーマ特化版両対応 |
| テーマプロファイルシステム | ✅ 実装済み | `app/profiles/*.json` で1切り口1ファイル管理。`general`, `localllm` 稼働中 |
| **ローカルLLM テーマ（新）** | ✅ 稼働中 | Google News（英語圏・日本語圏）をテーマ定義のキーワードで横断検索。検索語・件数・収集期間の正本は `app/profiles/localllm.json` |
| **Google News 統合処理（新）** | ✅ 実装済み | 複数地域・複数キーワードの検索結果を統合。重複除去＋時系列ソート＋件数制限 |
| テーマ別0件表示 | ✅ 実装済み | マッチなしメディアも表示 |

### 第2段階：記事生成フェーズ

| ステップ | 状態 | 備考 |
|---|---|---|
| 記事生成 (`synthesize_note.py`) | ✅ 動作中 | デフォルトは `gpt-5.4` |
| 全体実行 (`run_all.py`) | ✅ 動作中 | RSS収集 → 記事生成を順実行 |
| スポット記事 (`synthesize_articles.py`) | ✅ 動作中 | 任意URL複数指定 |
| FreeTalk回 (`synthesize_freetalk.py`) | ✅ 動作中 | 考察テーマベース |

### その他のフェーズ

| ステップ | 状態 | 備考 |
|---|---|---|
| GitHub Actions 自動実行 | ✅ 設定済み | 毎日22:00 UTC = 07:00 JST |
| TTS音声生成（tts-studio） | ✅ 稼働中 | podcast台本→`episode.wav`+タイミングJSONを自動生成。CLI+チューニングUI。手順は [tts-studio/README.md](tts-studio/README.md) |
| 動画制作（Remotion） | ✅ 稼働中 | `articles/` の音声+JSONを素材にMP4生成。手順は [video/README.md](video/README.md) |
| 記事投稿（note等） | 🔲 手動 | `articles/` に保存したMDを配信先へ投稿 |
| X投稿 | 🔲 未実装 | 将来フェーズ |
| Web UI | ⏸ 中断中 | Render上のAPI問題と合わせて保留中 |

---

## 記事の生成構造

最終的に出力したいのは、**完成した1本の記事** であり、構造は次の通り。

1. タイトル
2. 序文
3. 各トピックの本文
4. 締め

各トピックの本文では、基本的に次のセットを書く。

- 要約 / 概要
- WKFLの感想 / コメント
- 必要に応じて、同じ内容をもとにポッドキャスト用台本へ展開する

文字量の目安:
- 従来は全体でおよそ `2,000〜2,500字`
- 今後は全体で **約3,000字** を標準ターゲットに寄せていく

### 3つのパイプライン

このプロジェクトには、次の3つのコンテンツ生成ルートがある。

| パイプライン | 素材 | 出力ファイル名 |
|---|---|---|
| **スクレイピング・プラン**（ルートA） | 直近24時間のReddit議論を自動収集 | `articles/{date}/reddit.md` |
| **ピックアップ・ニュース**（ルートB） | WKFLが指定した外部記事URL（3本程度） | `articles/{date}/articles.md` |
| **フリートーク**（ルートC） | WKFLが語るテーマ・考察・雑談 | `articles/{date}/freetalk.md` |

どのルートも最終的には「完成記事 + podcast台本 + dossier」の3点セットを出力し、`articles/{date}/` に集約される。



### 序文の分岐

- **Reddit回**:
  `皆さんおはようございます。WKFLです。今日もAI、回してますか？`
  から入り、`何月何日のAIキャッチアップ` であること、そして `Redditの直近24時間の議論をベースにしている` ことを明示する。

- **ピックアップ・ニュース**:
  同じ定例挨拶から入りつつ、`今日はWKFLが気になっているトピックを3つ見ていく` という導入に分岐する。



ただし番組上の定番フレーズとして、完成原稿やポッドキャスト台本の冒頭には
`皆さんおはようございます。今日もAI回してますか、ということで、...`
を含める。

### 内部の生成段階

品質安定のため、内部的には2段階で扱う前提にしている。

1. **第1段階: 事実整理**
   - 各トピックのファクト
   - ポイント整理
   - コメントの角度
   - その日の序文・締めの方向性

2. **第2段階: 記事化**
   - 第1段階の整理をもとに完成原稿へ整形
   - ユーモア、批評性、人間味、流れの良さをここで与える

3. **第3段階: ポッドキャスト台本化**
   - 完成記事をもとに、読み上げ向きの話し言葉へ変換
   - 記事をそのまま読むのではなく、紹介しながら話す口調へ寄せる
   - 締めは `それでは、また明日お会いしましょう。` で統一する

この分離によって、`事実の過不足を減らすこと` と `文体の質を上げること` を両立させる。

---

## 番組の全体フロー

このREADMEで扱っている自動化は、現状は「朝の情報収集から記事生成まで」が中心。  
番組としての最終的な制作・配信フローは、以下の流れになっている。

1. RedditのRSSを収集する
2. WKFL形式の記事をMarkdownで生成する
3. 生成した記事をNotebookLMに入れる
4. NotebookLMから2つの成果物を作る
   - 記事サムネイル用のインフォグラフィック画像
   - ポッドキャスト用のトークスクリプト
5. Google AI StudioのTTSにスクリプトを入れて音声を作る
6. PremiereでBGMと音声を合わせる
7. Spotifyポッドキャストにアップロードする
8. Xに投稿して配信完了にする

配信先の番組ページはこれ:

- [Spotify: WKFL番組ページ](https://open.spotify.com/show/3ExVQrRg3eXrmAm6ajW3eq?si=e641e84c517a4880)

補足:
- このリポジトリで自動化しているのは、主に 1 と 2
- 3 〜 8 は番組制作の後工程として運用している
- 将来的には、後工程もできるだけ自動化していく前提

---

## Podcast工程

記事を生成した後は、同じ内容をポッドキャスト番組向けに再構成して運用している。

現在の流れ:

1. 記事本編（Markdown）を生成する
2. 記事をもとに、ポッドキャスト用の話し言葉スクリプトを作る（`*_podcast.md`）
3. **`tts-studio/` でTTS音声＋タイミングJSONを生成する**（下記）
4. 必要に応じて動画化（Remotion）、番組として仕上げる

### TTS生成（tts-studio/ — 自動化済み）

旧来はGoogle AI Studio上のWebアプリで手動生成していたが、そのロジックをNode.jsに移植し、リポジトリ内で完結するようにした。**手順の正本は [tts-studio/README.md](tts-studio/README.md)。**

```bash
# 台本 → articles/{date}/episode.wav + episode.json を一発生成
cd tts-studio && node cli.mjs 2026-07-13

# ナレーター・BGM等をチューニングしたい時はWeb UI
npm run ui   # → http://localhost:8787
```

- モデル: `gemini-3.1-flash-tts-preview`（`tts-studio/config.json` で変更可）
- BGMミックス（ダッキング・フェード）込みで出力。BGMプリセットは `config.json` で管理
- 出力はそのまま `video/prepare.mjs` に渡せる
- 必要な環境変数: `GEMINI_API_KEY`（`tts-studio/.env`）
- 旧Webアプリ（`gemini-tts-converter/`）はtts-studioへの移植・統合が完了したため削除済み

### 使用できるプリセットボイス

| 声の名前 | 特徴・印象 |
|---|---|
| `Charon`（デフォルト） | 深みがあり、落ち着いた知的な印象の声 |
| `Kore` | 明快でプロフェッショナルな、聞き取りやすい声 |
| `Puck` | 温かみがあり、親しみやすいフレンドリーな声 |
| `Fenrir` | 冷静で安定感のある、フラットな印象の声 |
| `Zephyr` | 柔らかく、穏やかで優しい印象の声 |

補足:

- ポッドキャスト台本は、記事をそのまま読むのではなく、読み上げ向きの話し言葉へ変換して使う
- そのため、`記事本編` と `podcast用スクリプト` は別ファイルとして扱う

---

## 動画制作（Remotion）

**動画は任意の最終工程。** WKFLの成果物は「記事だけ」「記事＋Podcast」「記事＋Podcast＋動画」のいずれもありうる。必ず動画まで作るわけではなく、セットで配信するプランのときに動画化する。

動画化するときは `articles/{date}/` の音声＋タイムスタンプJSONを素材に、`video/`（Remotionプロジェクト）でニュース配信番組風のMP4を生成する。完成動画は YouTube（[@WKFL-m3p](https://www.youtube.com/@WKFL-m3p)）等へアップロードする。

### 最短手順

```bash
# 1) articles/{date}/ に素材を置く（音声wav / タイムスタンプjson / meta.json / assets/topicN.*）
# 2) 素材を video/public/ へ取り込む
cd video && node prepare.mjs 2026-06-05
# 3) プレビュー
npx remotion studio --port 3001
# 4) 書き出し（720p。1080pなら --scale を省略）
npx remotion render WKFL out/WKFL.mp4 --scale=0.6667
```

**詳細・再現手順・素材規約・コンポーネント構成は [video/README.md](video/README.md) が正本。**

> 補足: 実際のTTSアプリが出力するJSONは、トピックごとに1つの大きい `normal` セグメント（複数文を含む）。字幕は `video/src/captions.ts` が各セグメントを文単位に分割し、文字数比で時間配分して生成する。

---

## ディレクトリ構成

```
WKFL/
├── README.md              ← このファイル
├── .env                   ← APIキー（gitignore済み）
├── .env.example           ← キーのテンプレート
├── .gitignore
├── requirements.txt       ← Python依存パッケージ
├── articles/              ← 日付ディレクトリごとにバンドル一式を集約（唯一の出力先）
│   └── YYYY-MM-DD/
│       ├── reddit.md             ← Reddit回 記事
│       ├── reddit_podcast.md     ← Reddit回 podcast台本
│       ├── reddit_dossier.md     ← Reddit回 dossier
│       ├── articles.md           ← セレクト記事回 記事
│       ├── articles_podcast.md   ← セレクト記事回 podcast台本
│       ├── articles_dossier.md   ← セレクト記事回 dossier
│       ├── freetalk.md           ← FreeTalk回 記事
│       ├── freetalk_podcast.md
│       ├── freetalk_dossier.md
│       ├── episode.wav           ← tts-studio が生成するナレーション音声
│       └── episode.json          ← tts-studio が生成するタイムスタンプJSON
├── tts-studio/            ← TTSパイプライン（CLI + チューニングUI。手順は tts-studio/README.md）
├── video/                 ← Remotionプロジェクト（動画制作。手順は video/README.md）
├── app/                   ← プロジェクトのエンジン本体（収集・生成パイプライン + 停止中のWeb UI）
│   ├── main.py              ← Web UI（FastAPI、現在停止中）
│   ├── templates/            ← Web UI用テンプレート
│   ├── engine/                ← 収集・記事生成パイプライン本体
│   │   ├── run_all.py             ← エントリーポイント（Reddit回）
│   │   ├── ingest_rss.py          ← Step 1: RSS/Google News取得
│   │   ├── list_today_news.py     ← ニュースフィード生成（ルートB/C下調べ用）
│   │   ├── synthesize_note.py     ← Step 2: AI記事生成（Reddit回）
│   │   ├── synthesize_articles.py ← AI記事生成（セレクト記事回）
│   │   ├── synthesize_freetalk.py ← AI記事生成（FreeTalk回）
│   │   ├── wkfl_pipeline.py       ← プロンプトテンプレート・モデル呼び出し共通処理
│   │   └── wkfl_persona.py        ← WKFLペルソナ定義（正本）
│   ├── profiles/                ← 探索の「切り口」を1ファイル1プロファイルで管理
│   │   ├── general.json           ← AI全般（デフォルト）
│   │   └── localllm.json          ← ローカルLLM特化
│   └── data/                    ← エンジンが読み書きするデータ
│       ├── raw_feeds/             ← 日次の生データ（gitignore対象）
│       │   └── YYYY-MM-DD_raw.json
│       └── manual_articles/       ← 手動投入記事の保存例
└── media/                 ← 個別サービス・素材系をまとめた置き場（各ディレクトリの中身自体は非稼働の単純データ）
    ├── X/                   ← X（Twitter）投稿専用（将来用）
    │   ├── drafts/            ← X投稿の下書き
    │   ├── posted/            ← X投稿済みログ
    │   ├── list/               ← Xリスト取得結果
    │   └── requirements.txt     ← X投稿用の依存（tweepy等）
    ├── podcast/              ← podcast台本のプライマリ出力先＋BGM素材（tts-studio/config.jsonが参照）
    │   └── scripts/
    ├── brand/                ← ロゴ・ホスト画像等（video/prepare.mjsが参照）
    ├── note/                  ← note.com投稿用サムネイル等（停止中Web UIのみ参照）
    ├── Brain/                 ← 予備（現状空・未使用）
    └── book/                  ← 企画書等の下書き置き場
```

---

## セットアップ

### 必要なもの
- Python 3.11+
- OpenAI APIキー（`sk-proj-...`、**GitHub ActionsやCLI実行時に必要**）
- Anthropic APIキー（`sk-ant-...`、Anthropic系モデルに切り替える場合のみ）

補足:
- **ローカルでチャット上から進める通常運用では、毎回このAPIキー設定は前提にしない**
- APIキー前提の自動実行は、主に **GitHub Actions** や明示的なCLI実行のためのもの

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
OPENAI_API_KEY=sk-proj-xxxxx
ANTHROPIC_API_KEY=sk-ant-xxxxx
WKFL_MODEL=gpt-5.4
```

`.env` は `.gitignore` に含まれており、Gitにはコミットされない。

---

## 実行方法

### Web UI（停止中・無視してよい）

この経路は現在の運用対象ではない。  
README上に記述は残っているが、**毎回気にしなくてよい**。実際の作業は下のCLIルートを使う。

```bash
cd /Users/kaya.matsumoto/projects/WKFL
python3 -m uvicorn app.main:app --reload
```

ブラウザで `http://localhost:8000` を開く。「今日の記事を生成」ボタンを押すと記事生成が走り、完了後に一覧に表示される。

### CLI: Reddit回

```bash
cd /Users/kaya.matsumoto/projects/WKFL
python3 app/engine/run_all.py
```

これだけ。以下の2ステップが順に実行される:

1. **RSS収集**: 4つのサブレディットから過去24時間の投稿を取得 → `app/data/raw_feeds/YYYY-MM-DD_raw.json`
2. **記事生成**: LLM APIを呼び出して日本語記事を生成 → `articles/YYYY-MM-DD/reddit.md`（併せて `reddit_podcast.md`, `reddit_dossier.md` も出力）

既に当日のraw JSONがある場合（再生成したいとき）はStep 2だけ実行:

```bash
python3 app/engine/synthesize_note.py
```

### モデル切り替え

デフォルトは `gpt-5.4`。Anthropicへ切り替えるには:

```bash
WKFL_MODEL=claude-opus-4-6 python3 app/engine/synthesize_note.py
```

ステージごとにモデルを分ける場合:

```bash
WKFL_FACT_MODEL=gpt-5.4 WKFL_STYLE_MODEL=gpt-5.4 python3 app/engine/synthesize_note.py
```

### ローカル通常運用: セレクト記事回

ローカルでセレクト記事回をやるときは、**WKFLがURLを3本前後チャットに投げ、そのままCodex側で取得・整理して進める**。
今このセッションでやっているのが、その標準プロセス。

### CLI: セレクト記事回（補助用・API前提）

Redditの定点観測とは別に、**WKFLが指定した3本前後の記事URLを素材にして** スポット回を生成できる。

```bash
python3 app/engine/synthesize_articles.py \
  "https://forbesjapan.com/articles/detail/94270" \
  "https://qiita.com/kotauchisunsun/items/ab78bb338500b4c71103" \
  "https://dev.classmethod.jp/articles/cursor-3-0-multi-agent-features-guide/"
```

これを実行すると、指定したURLを順番に取得して以下を自動で行う:

1. 記事タイトル・媒体名・公開日・本文を抽出
2. 各記事について `ソース紹介 / 概要 / WKFLの感想` を生成
3. `articles/{date}/` に記事・podcast台本・dossierのセットを保存

用途:
- 気になる外部記事を3本だけまとめたいとき
- Redditではなく、Forbes JapanやQiita、技術ブログなどを素材にしたいとき
- 番組のスポット回や特集回を作りたいとき

位置づけ:
- これは補助的なCLIルート
- **普段のローカル運用はチャットで進める**
- APIキーを使った自動処理が必要なときだけ、このCLIやGitHub Actionsを使う

注意:
- URL先がログイン必須、強いペイウォール、JavaScript依存の本文表示だと抽出に失敗することがある
- その場合は記事本文を直接渡す形に切り替えるのが確実

### 定期実行（GitHub Actions）

現在はGitHub Actionsで毎朝自動実行できるようにしている。

ここでは **APIキーを使った自動実行** を前提にしている。

- 実行場所: GitHub上のActionsランナー
- 実行時刻: 毎日 `22:00 UTC` = `07:00 JST`
- トリガー: `.github/workflows/daily_wkfl_briefing.yml`
- 必要なSecrets: `OPENAI_API_KEY`（推奨）または `ANTHROPIC_API_KEY`（フォールバック用）
- 成果物の確認先: GitHubのActions画面
  - Run Summaryに記事冒頭を表示
  - Artifactに `articles/YYYY-MM-DD/reddit*.md` と `app/data/raw_feeds/YYYY-MM-DD_raw.json` を保存

補足:
- この定期実行はローカルPCには依存しない
- コードはリポジトリ上の最新状態が使われる
- workflowファイル自体がGitHubのデフォルトブランチにpushされていないと、スケジュール実行は始まらない
- `TZ=Asia/Tokyo` を設定して、日付はJST基準で扱っている
- `articles/` は成果物出力先で、Actions実行時に当日ディレクトリが自動生成される
- 現在のworkflowはリポジトリへ成果物をcommitしない。保存先はActions Artifactであり、GitHub上のファイル一覧には自動では現れない

---

## RSSソース設定

ソースは `app/profiles/*.json` で切り口（プロファイル）ごとに管理する。例えば `app/profiles/general.json` の `sources` は以下のような形:

```json
{
  "name": "General AI News",
  "description": "AI全般のニュースを幅広くキャッチアップ",
  "reddit_no_filter": true,
  "sources": [
    { "name": "Reddit: r/LocalLLaMA", "url": "https://www.reddit.com/r/LocalLLaMA/new/.rss?limit=25", "active": true },
    { "name": "PR TIMES", "url": "https://prtimes.jp/index.rdf", "active": true, "keywords": ["AI", "人工知能", "LLM"] }
  ]
}
```

`active: false` にすると収集対象から外れる。ソースを追加すれば即対応。新しい切り口（プロファイル）自体を追加したい場合は、上の「テーマのカスタマイズ」セクションを参照。

---

## AIペルソナ・番組構成

### WKFLのパーソナリティ

- **名前**: WKFL
- **立ち位置**: AIプロダクトを実際に作っている、スタートアップの企業家・開発者
- **スタイル**: 軽妙で観察眼は鋭いが、企業・研究者・開発者への敬意を失わないポッドキャストパーソナリティ
- **解説**: 客観的に300文字程度でニュース事実を伝える
- **レビュー（WKFL's Eye）**: 労働・市場・開発者への影響を、ユーモアと批評性を保ちつつ、上から目線にならず300文字程度で論評する
- **導入・締め**: 肩の力を抜いたナチュラルな口語体

### 口調のガードレール

- 批評はしてよいが、嘲笑しない
- 人ではなく、戦略・設計・実行・市場との噛み合い方を論じる
- 強い指摘をする時ほど、先に挑戦の難しさや良い点を認める
- ユーモアは「小馬鹿にする笑い」ではなく、「現場感のある気づき」から生む
- 「経営者目線」ではなく、あくまで**現場に近いスタートアップ企業家 / ビルダー目線**で語る

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

## コスト分析（2026-04-04 実測値 / Anthropic運用時の参考値）

| 項目 | 実測値 |
|---|---|
| サブレディット数 | 4 |
| 取得投稿数（24時間フィルタ後） | 81件 |
| プレフィルタ後 | 70件 |
| 入力トークン | 15,354 |
| 出力トークン | 2,729 |

| モデル | 入力単価 | 出力単価 | 1回コスト | 月コスト（30日） |
|---|---|---|---|---|
| claude-sonnet-4-6 | $3 / 1M | $15 / 1M | **約$0.09（13円）** | 約$2.7（400円） |
| claude-opus-4-6 | $15 / 1M | $75 / 1M | **約$0.44（65円）** | 約$13（1,900円） |

### 実口座残高ベースの実効コスト

ローカルでの手動実行では、Anthropicの残高が `9.91ドル → 9.74ドル` に減少したため、**1回あたり約$0.17** の実効コストだった。

これは上のトークン換算コストよりやや大きいので、実運用ではAPIの課金タイミングや丸め、別リクエストの影響も含めて見積もる前提にしている。

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
