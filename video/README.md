# WKFL 動画制作（Remotion）

このフォルダは、`articles/{date}/` の音声＋タイムスタンプJSONを素材に、ニュース配信番組風のMP4を生成する Remotion プロジェクト。

## 位置づけ（重要）

**動画は任意の最終工程。** WKFLの成果物は「記事だけ」「記事＋Podcast」「記事＋Podcast＋動画」のいずれもありうる。毎回動画を作るわけではなく、セットで配信するプランのときだけこのフォルダを使う。完成動画は YouTube（https://www.youtube.com/@WKFL-m3p ）等へアップする。

---

## 1. 素材を置く（`articles/{date}/`）

| ファイル | 必須 | 内容 |
|---|---|---|
| `radio-show-*.wav`（または任意の `.wav`） | ✅ | TTSが書き出した音声 |
| `radio-show-*.json`（`meta.json`以外の`.json`） | ✅ | タイムスタンプJSON（`total_duration_ms` と `segments[]`） |
| `meta.json` | ✅ | 番組名・タイトル・トピック見出し・リンク（手書き） |
| `assets/topic1.* topic2.* topic3.*` | 任意 | 各トピックの画像（jpg/jpeg/png/webp） |

### タイムスタンプJSONの実フォーマット

TTSアプリはトピックごとに **1つの大きい `normal` セグメント**（複数文を含む）で出力する。1文1セグメントではない。

```json
{
  "total_duration_ms": 281640,
  "segments": [
    { "id": "segment_1", "type": "normal", "text": "皆さん…(挨拶＋トピック1)…", "start_ms": 5000,  "end_ms": 93280 },
    { "id": "segment_2", "type": "normal", "text": "…(トピック2)…",            "start_ms": 94780, "end_ms": 161580 },
    { "id": "segment_3", "type": "normal", "text": "…(トピック3＋締め)…",       "start_ms": 163080,"end_ms": 276640 }
  ]
}
```

字幕は [src/captions.ts](src/captions.ts) が各セグメントを文単位（`。！？`）で分割し、文字数比で `start_ms`〜`end_ms` を配分して生成する。冒頭の無音区間（最初のセグメント `start_ms` まで）はタイトル表示に使う。

### meta.json の書き方

```json
{
  "program": "WKFLのAI TODAY",
  "title": "（動画タイトル＝YouTube向けの一文）",
  "date": "2026-06-04",
  "links": { "note": "note.com/wkflstudio", "x": "x.com/wkflstudio", "spotify": "WKFL" },
  "topics": [
    { "no": 1, "headline": "（トピック見出し）", "media": "媒体名", "image": "topic1.png", "start_ms": 35932 }
  ]
}
```

- `topics[].start_ms` = そのトピックの話が始まる時刻(ms)。トランジション・見出し・画像切替の同期に使う。
- `image` は prepare.mjs が `assets/` の実ファイルから自動解決するので、手書き値は無視される（無ければ null）。
- **トピックが大セグメントの途中から始まる場合**（例: トピック1が挨拶と同じ `segment_1` 内）、アンカー文の文字位置から時刻を算出する:

```bash
python3 - <<'PY'
import json
d = json.load(open('../articles/2026-06-05/radio-show-XXXX.json'))
seg = d['segments'][0]; text = seg['text']; anchor = 'まずOpenAI'
idx = text.find(anchor); span = seg['end_ms'] - seg['start_ms']
print(round(seg['start_ms'] + idx/len(text)*span))
PY
```

---

## 2. 素材を取り込む

```bash
cd video
npm i                      # 初回のみ
node prepare.mjs 2026-06-05
```

`prepare.mjs` が `public/` へ以下をコピーする:
- 音声 `.wav` → `public/episode.wav`（既存があればスキップ）
- タイムスタンプ `.json` → `public/episode.json`
- `articles/{date}/meta.json` → `public/meta.json`（`topics[].image` を実ファイル名で埋める）
- `assets/topicN.*` → `public/topicN.*`
- `brand/Japanese_man_wearing_*.jpeg` → `public/host.jpeg`
- `brand/logo_wkfl_white_001.png` → `public/logo.png`

---

## 3. プレビュー

```bash
npx remotion studio --port 3001
```

ブラウザで http://localhost:3001 。コンポジションID は `WKFL`。

> ⚠️ Studioを起動したまま `prepare.mjs` で画像のファイル名・有無を変えると、起動済みStudioが古い `meta.json` を参照して画像が空白になることがある。**prepare後はStudioを再起動**する。

---

## 4. 書き出し

```bash
# 720p（1段下げ。レイアウトは1920×1080設計のまま縮小出力）
npx remotion render WKFL out/WKFL.mp4 --scale=0.6667

# 1080p フル
npx remotion render WKFL out/WKFL.mp4
```

- 出力: `out/WKFL.mp4`（H.264 + 音声）
- レンダリング時間: 約4〜5分尺で数分（マシン依存）。**Claudeのトークン消費はゼロ**（ローカル処理）。
- 解像度を変えたいときは composition の縦横（1920×1080）を変えず、`--scale` で調整する。ピクセル指定のレイアウトが崩れないため。

---

## 構成（src/）

| ファイル | 役割 |
|---|---|
| `Root.tsx` | コンポジション定義。`calculateMetadata` で `episode.json`/`meta.json` を読み、`total_duration_ms` から尺を算出。1920×1080 / 30fps |
| `Episode.tsx` | 全体合成（背景・ビジュアライザ・ヘッダー・冒頭ホスト・トピック画像・字幕・ティッカー・トランジション・進捗・イントロ・アウトロ） |
| `captions.ts` | 型定義（Episode/Meta/Topic/Caption）＋セグメント→文字幕変換 |
| `TitleIntro.tsx` | 冒頭の無音区間に出すタイトルカード |
| `HostSpotlight.tsx` | 挨拶〜3本紹介の間、大きいアバター＋本日のラインナップ |
| `TopicScene.tsx` | トピック中ずっと画像を表示（ケンバーンズ）＋見出し |
| `TopicTransition.tsx` | トピック切替の大きめスティンガー |
| `CaptionTrack.tsx` | 文字幕＋暗幕スクリム（可読性確保） |
| `Ticker.tsx` | 下部ニュースティッカー |
| `Visualizer.tsx` | 音声反応イコライザ（`@remotion/media-utils`） |
| `Outro.tsx` | アバター＋ロゴ＋note/X/Spotify |
| `prepare.mjs` | 素材を `public/` へ取り込むスクリプト |

## 素材の差し替え

- 画像追加/差し替え: `articles/{date}/assets/topicN.{jpg,png,webp}` に置いて `node prepare.mjs {date}` を再実行 → Studio再起動。
- ロゴ: `brand/logo_wkfl_white_001.png`（白・透過）
- ホスト写真: `brand/Japanese_man_wearing_*.jpeg`
