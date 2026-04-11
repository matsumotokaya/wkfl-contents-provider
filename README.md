# WKFL 自律型AIメディアエンジン

**最終更新: 2026-04-10**

---

## 記事生成のルート（実行方法）

### ルートA: チャット上でLLMに直接依頼する（最もシンプル）

アプリもターミナルも不要。以下の手順で記事を生成できる。

1. `X/data/raw_feeds/YYYY-MM-DD_raw.json` の中身をコピー
2. Claude（claude.ai）またはChatGPTのチャット画面に貼り付け
3. 以下のプロンプトを添える：

```
あなたはWKFLというAIポッドキャストパーソナリティです。
添付のReddit RAW DATAから3コーナー形式の日本語記事を生成してください。
フォーマットはREADMEのAIペルソナ・番組構成セクションに従ってください。
```

**メリット**: 環境構築不要、APIキー不要、コスト0  
**デメリット**: 毎回手動でJSONを貼り付ける必要がある

### ルートB: ターミナルから実行する

```bash
cd /Users/kaya.matsumoto/projects/WKFL
python3 X/scripts/run_all.py
```

Anthropic APIキーとクレジット残高が必要。生成記事は `articles/{date}/` にバンドル一式（記事 + podcast台本 + dossier）として保存される。

### ルートC: WebアプリのUIから実行する（開発中断中）

`https://wkfl-contents-provider.onrender.com` にアクセスして「今日の記事を生成」ボタンを押す方式だったが、現在は開発を中断している。  
再開する場合は、まず下記のRender側APIエラー解消が前提になる。

---

## 🚨 未解決の問題（引き継ぎ事項）

### Render上でAnthropicAPIが `credit balance too low` エラーになる

**症状**: Renderにデプロイしたアプリで記事生成を実行すると、以下のエラーが発生する。

```
anthropic.BadRequestError: Error code: 400
'message': 'Your credit balance is too low to access the Anthropic API.'
```

**確認済み事項**:
- Anthropicコンソールの残高: $9.91（十分にある）
- RenderのAPIキー (`ANTHROPIC_API_KEY`): 正しい値が設定されている（`sk-ant-api03-R3raGo5kN7iCLuK-...NweoLwAA`）
- ローカル実行: 正常に動作する（2026-04-04に実績あり、$0.09消費）
- RenderはPython 3.11環境

**未確認の仮説**:
- Anthropicのワークスペースが複数あり、APIキーと残高が別ワークスペースに属している可能性
- Anthropicコンソール → Settings → Workspaces で確認が必要

**Web UIの状態**:
- FastAPI + Jinja2で構築済み（`app/main.py`, `app/templates/`）
- ローカルでは正常動作（`python3 -m uvicorn app.main:app --reload`）
- Renderへのデプロイは完了しているが、上記APIエラーにより記事生成が失敗する
- 記事の永続化（Renderはディスクが再起動で消える）は未実装 → GitHubへの自動コミット方式で解決予定
- Web UIの開発自体は現在中断中で、当面の主経路ではない

---

> このドキュメントは、本システムをゼロから引き継ぐLLMやエンジニアのための完全な仕様書です。

---

## 何をするシステムか

毎朝、RedditのAI関連サブレディットを自動収集し、日本語の解説記事（Markdown）を生成する自律型メディアエンジン。

**アウトプットイメージ**: `articles/2026-04-04/reddit.md`

AIポッドキャストパーソナリティ「WKFL」のスタイルで、3つのコーナー形式の記事を毎日1本生成する。ターゲット媒体はnote（ブログ）。将来的にはXへの自動投稿も対象。

---

## 現在の状態（2026-04-04時点）

| ステップ | 状態 | 備考 |
|---|---|---|
| RSS収集 (`ingest_rss.py`) | ✅ 動作中 | 4サブレディット、24時間フィルタ |
| 記事生成 (`synthesize_note.py`) | ✅ 動作中 | **Anthropic API接続済み**（旧Mockから移行完了） |
| 全体実行 (`run_all.py`) | ✅ 動作中 | 上記2ステップを順に実行 |
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
| **Reddit回** | 直近24時間のReddit議論を自動収集 | `articles/{date}/reddit.md` |
| **セレクト記事回** | WKFLが指定した外部記事URL（3本程度） | `articles/{date}/articles.md` |
| **FreeTalk回** | WKFLが話したネタ・メモ・素材を口頭で渡す | `articles/{date}/freetalk.md` |

どのルートも最終的には「完成記事 + podcast台本 + dossier」の3点セットを出力し、`articles/{date}/` に集約される。

#### FreeTalk回について

RedditやURLを使わず、WKFLが直接「気になっていること・書きたいこと」を自由に話した内容を素材にして記事を生成するルート。

- 入力: WKFLが口頭またはメモで渡すランダムな素材・情報・参照
- 処理: 2段階（dossier → 記事化）は他のルートと同じ
- 特性: 他のルートと同じWKFLキャラクター・テンションを維持しながら、素材の深みを引き出す方向に仕上げる

### 序文の分岐

- **Reddit回**:
  `皆さんおはようございます。WKFLです。今日もAI、回してますか？`
  から入り、`何月何日のAIキャッチアップ` であること、そして `Redditの直近24時間の議論をベースにしている` ことを明示する。

- **セレクト記事回**:
  同じ定例挨拶から入りつつ、`今日はWKFLが気になっているトピックを3つ見ていく` という導入に分岐する。

- **FreeTalk回**:
  同じ定例挨拶から入りつつ、`今日はちょっと気になっていることを話してみたい` という自由度の高い導入に分岐する。

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
2. 記事をもとに、ポッドキャスト用の話し言葉スクリプトを作る
3. Google AI StudioでTTS音声を生成する
4. 必要に応じてBGMや編集を加えて、番組として仕上げる

### Google AI Studioで使っているTTS

現在は `gemini-2.5-flash-preview-tts` を使用している。

- Gemini 2.5 Flash をベースにした、TTS専用のプレビュー版モデル
- 非常に高速
- 自然なイントネーションで音声を生成しやすい

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
│       ├── reddit.md           ← Reddit回 記事
│       ├── reddit_podcast.md   ← Reddit回 podcast台本
│       ├── reddit_dossier.md   ← Reddit回 dossier
│       ├── articles.md         ← セレクト記事回 記事
│       ├── articles_podcast.md
│       ├── articles_dossier.md
│       ├── freetalk.md         ← FreeTalk回 記事
│       ├── freetalk_podcast.md
│       └── freetalk_dossier.md
├── podcast/               ← podcast台本のプライマリ出力先
│   └── scripts/
└── X/
    ├── data/
    │   ├── db/
    │   │   └── user_config.json   ← RSSソース設定
    │   └── raw_feeds/
    │       └── YYYY-MM-DD_raw.json ← 当日の取得データ
    ├── drafts/            ← X投稿の下書き（将来用）
    ├── posted/            ← X投稿済みログ（将来用）
    └── scripts/
        ├── run_all.py              ← エントリーポイント（Reddit回）
        ├── ingest_rss.py           ← Step 1: RSS取得
        ├── synthesize_note.py      ← Step 2: AI記事生成（Reddit回）
        └── synthesize_articles.py  ← AI記事生成（セレクト記事回）
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
2. **記事生成**: Anthropic APIを呼び出して日本語記事を生成 → `articles/YYYY-MM-DD/reddit.md`（併せて `reddit_podcast.md`, `reddit_dossier.md` も出力）

既に当日のraw JSONがある場合（再生成したいとき）はStep 2だけ実行:

```bash
python3 X/scripts/synthesize_note.py
```

### モデル切り替え

デフォルトは `claude-sonnet-4-6`（安価・高速）。Opusに切り替えるには:

```bash
WKFL_MODEL=claude-opus-4-6 python3 X/scripts/synthesize_note.py
```

### スポット記事モード（任意URLから生成）

Redditの定点観測とは別に、任意の記事URLを素材にしてスポット回を生成できる。

```bash
python3 X/scripts/synthesize_articles.py \
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

注意:
- URL先がログイン必須、強いペイウォール、JavaScript依存の本文表示だと抽出に失敗することがある
- その場合は記事本文を直接渡す形に切り替えるのが確実

### 定期実行（GitHub Actions）

現在はGitHub Actionsで毎朝自動実行できるようにしている。

- 実行場所: GitHub上のActionsランナー
- 実行時刻: 毎日 `22:00 UTC` = `07:00 JST`
- トリガー: `.github/workflows/daily_wkfl_briefing.yml`
- 必要なSecrets: `ANTHROPIC_API_KEY`
- 成果物の確認先: GitHubのActions画面
  - Run Summaryに記事冒頭を表示
  - Artifactに `articles/YYYY-MM-DD/reddit*.md` と `X/data/raw_feeds/YYYY-MM-DD_raw.json` を保存

補足:
- この定期実行はローカルPCには依存しない
- コードはリポジトリ上の最新状態が使われる
- workflowファイル自体がGitHubのデフォルトブランチにpushされていないと、スケジュール実行は始まらない
- `TZ=Asia/Tokyo` を設定して、日付はJST基準で扱っている
- `articles/` は成果物出力先で、Actions実行時に当日ディレクトリが自動生成される
- 現在のworkflowはリポジトリへ成果物をcommitしない。保存先はActions Artifactであり、GitHub上のファイル一覧には自動では現れない

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
