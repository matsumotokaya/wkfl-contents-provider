# WKFL TTS Studio

podcast台本（`articles/{date}/*_podcast.md`）から、ナレーション音声＋字幕タイミングJSONを生成するパイプライン。
AI Studio上のWebアプリ（`gemini-tts-converter/`）のコアロジックをNode.jsに移植し、WKFLのワークフローに組み込んだもの。

- **CLI**: 台本→ `articles/{date}/episode.wav` + `episode.json` を一発生成（自動化用）
- **Web UI**: ナレーター・ペルソナ・BGMを選びながらチューニングする作業台

出力はそのまま `video/prepare.mjs` が読める形式（44.1kHz stereo WAV + `s{n}_{m}` 形式のフラットタイミングJSON）。

---

## セットアップ（初回のみ）

```bash
cd tts-studio
npm install
cp .env.example .env   # GEMINI_API_KEY を記入
```

前提: Node.js 18+、ffmpeg（BGMデコード用。`brew install ffmpeg`）

## CLI

```bash
# 日付指定（articles/{date}/*_podcast.md を自動検出。articles_podcast.md 優先）
node cli.mjs 2026-07-13

# ファイル直接指定・オプション上書き
node cli.mjs articles/2026-07-13/freetalk_podcast.md --voice Kore --persona critic --bgm none

# 分割結果だけ確認（API呼び出しなし）
node cli.mjs 2026-07-13 --dry-run
```

出力（`articles/{date}/` に保存）:

| ファイル | 内容 |
|---|---|
| `episode.wav` | BGMミックス済みナレーション（44.1kHz stereo） |
| `episode.json` | 文単位の字幕タイミング `[{id, start_ms, text}]` |
| `meta.json` | 無ければ雛形を自動生成（**topicsは手動記入**） |

その後はそのまま既存の動画工程へ:

```bash
cd ../video && node prepare.mjs 2026-07-13
```

## Web UI（チューニング用）

```bash
npm run ui   # → http://localhost:8787
```

1. **台本**: 日付を選んで読み込み（またはテキスト貼り付け）→ 自動分割
2. **セクション**: 分割結果を直接編集可。`[interval: 2s]` タグで無音挿入
3. **設定**: ナレーター / ペルソナ / BGM をプリセットから選択
4. **生成**: セクション単位の試聴 → 一括生成プレビュー → `articles/{date}/` へ保存

APIキーはサーバー側（.env）のみで使用し、ブラウザには渡らない。

## 設定（config.json）

- `defaults`: 通常運用のプリセット（voice: Charon / persona: news / bgm: acoustic）
- `voices` / `personas` / `bgm`: プリセット定義。BGMはパスを追加すれば増やせる
- `mix`: イントロ4秒→ダッキング10%→アウトロ5秒→フェード2秒（旧アプリと同一挙動）
- `split.maxSectionChars`: 1セクションの最大文字数（既定1100）
- `provider` / `model`: TTSプロバイダ抽象化。現状は Gemini のみ（`lib/tts.mjs` の `PROVIDERS` に追加で拡張）

## モックモード（APIキー不要のパイプライン検証）

```bash
WKFL_TTS_MOCK=1 node cli.mjs 2026-07-13
```

TTSを呼ばず、実話速相当のプレースホルダ音声で全工程（分割→ミックス→JSON→保存）を通す。

## 仕組みメモ

- タイミングJSONは**文字数重み推定**（文字×300 + 読点×300 + 文末×600）。実測タイムスタンプではない（旧アプリと同方式）
- Gemini TTSは 24kHz mono PCM を返す → 線形リサンプルで44.1kHzへ
- BGMはffmpegでデコードするので mp3/wav なんでも可。ループ再生・ダッキング・フェードはJSで合成
- `episode.json` のIDは `s{セクション番号}_{文番号}`。`video/prepare.mjs` がこの接頭辞でセグメントをグループ化する
