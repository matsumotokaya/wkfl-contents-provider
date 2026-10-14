# MiniMax のクローンボイス

この文書が答える問い：ラボの MiniMax の声は何で、どう作られ、いくらかかり、キーと試作音声はどこにあるか。
2026-10-14 に gen-video（`~/projects/gen-video` の 5 VOICE）から取り込んだ。元は gen-video の `docs/voice.md`（2026-08-12 の実測）。

## 声

| voice_id | 作成 | 素材 | 状態 |
|---|---|---|---|
| **`nijiVoiceRefA01`** | 2026-08-12 | `niji-voice` フォルダの日本語朗読 wav（19.45秒） | 有効化済み・永続。2026-10-14 に無料の `POST /v1/get_voice`（`voice_type: voice_cloning`）で存在を確認 |

- **消さない。** 作り直すと $1.5 かかり、削除しても返金されない。
- 声質は wav 全体から、喋り方は同じ wav の冒頭5.0秒（`clone_prompt`、`prompt_text` = 「大災禍の以前。進化の終着点で。」）から学習させている。
- 素材の file_id（参考）：声質 `430010775634142`（16bit PCM 32kHz mono に変換済み）、喋り方 `430011940331717`（冒頭5.0秒）。
- 元の wav は手元にない。声は MiniMax 側に残っているので、作り直さない限り要らない。
- **権利**：2026-10-14 にユーザーが「確認済み」と回答し、公開カタログに載せてよいことになった。元の音声の出所と利用条件は追記待ち。
- クローンした声はアカウントの資産で、**同じ MiniMax アカウントのキーからしか使えない**。画面の発行コードもその前提で書いている。

## キー

`~/.secrets/minimax-token`（権限600）。**WKFL専用ではなく、gen-video など他のプロジェクトとも共用する**（2026-10-14 ユーザー決定。Google/OpenAI の「WKFL専用キー」規則の例外）。
読み込みは `tools/credentials.mjs` の `loadMinimaxKey`。絶対パスの `MINIMAX_API_KEY_FILE` があればそちらを優先する。一般の `MINIMAX_API_KEY` 環境変数は読まない（どこかの `.env` で課金先が変わらないように）。
残高は同じアカウントの前払い枠から減る。コンソールの使用量はキーごとに分かれて出る。

**配置済み（2026-10-14）**：gen-video の `.env` にある従量課金の `MINIMAX_API_KEY` を、ユーザー承認のうえ値を表示せずにコピーした（新規発行ではない）。同日、このキーで無料の `get_voice` を呼び、`nijiVoiceRefA01` が見えることを確認した。gen-video の `.env` には同じキーが残っていて、gen-video はまだそちらを読んでいる。サブスクキー `MINIMAX_SUBSCRIPTION_KEY` は gen-video に残したまま。

## ラボでの使い方

TTS のモデル一覧に `speech-2.8-hd` / `speech-2.8-turbo` があり、声カードに `nijiVoiceRefA01` が出る。1回生成は Gemini TTS と同じ画面・履歴・保存形式（`speech.wav`）。

- リクエストは `lib/snippets.mjs` の `minimaxTtsBody`：`language_boost: "Japanese"`、WAV 32kHz mono、`output_format: "hex"`、`emotion` なし。
- MiniMax には文章で読み方を指示する欄がないため、「読み方・比較条件」は MiniMax のモデルでは隠し、保存もしない。
- 使用量は `extra_info` の課金に関わる欄だけを `minimax-t2a` として残し、概算は `lib/cost.mjs` の `summarizeTts`。
- ラボからの実生成は未検証。

## 課金（実測で確定）

| 回 | `extra_info.usage_voice_count` | 課金 |
|---|---|---|
| クローン後の初回の合成 | `1` | $1.5 + 文字代 |
| 2回目以降 | 欄ごと無し | 文字代のみ |

`POST /v1/voice_clone` の時点では課金されない。**クローンだけして7日以内に合成しないと voice_id は失効する。**
2026-08-12 の作成と合成はサブスクキー（2026-09-04 まで）だったので、実際の請求は $0 だった。

| 項目 | 単価（2026-10-14 公式で確認） |
|---|---|
| `speech-2.8-hd` | $100 / 100万文字。実績：591文字・1分45秒で $0.059 |
| `speech-2.8-turbo` | $60 / 100万文字 |
| Rapid Voice Cloning | $1.5 / 声（初回の合成時） |
| Voice Design | $3 / 声（文章で声を設計） |

出典：[料金](https://platform.minimax.io/docs/guides/pricing)・[T2A](https://platform.minimax.io/docs/api-reference/speech-t2a-http)

## 新しくクローンするとき（画面には未実装）

```
① POST /v1/files/upload  purpose=voice_clone   → file_id   （無料）
② POST /v1/files/upload  purpose=prompt_audio  → file_id   （無料・喋り方の見本、8秒以内）
③ POST /v1/voice_clone   file_id + clone_prompt → voice_id  （まだ課金されない）
④ POST /v1/t2a_v2        voice_setting.voice_id = ③        （ここで $1.5）
```

| 対象 | 要件 |
|---|---|
| `file_id`（声質） | mp3 / m4a / wav・10秒〜5分・20MB 以内 |
| `prompt_audio`（喋り方） | 同形式・8秒以内。`prompt_text` は内容と一致し、句読点で終わる |
| `voice_id` | 8〜256文字・英字始まり・`[A-Za-z0-9_-]` |

IEEE Float の wav は `ffmpeg -acodec pcm_s16le -ar 32000 -ac 1` で変換する。文の切れ目は `ffmpeg -af silencedetect=noise=-35dB:d=0.25` で取れる。
新しい声が要るときは、作る前に $1.5 かかることを伝える。

## 表現の制御

| やりたいこと | 方法 |
|---|---|
| 速さ・音量・高さ | `voice_setting.speed`（0.5〜2）／`vol`／`pitch` |
| 感情 | `voice_setting.emotion`。クローンの声は付けない方が元の口調が残る |
| 笑い・息継ぎ | 本文に `(chuckle)` `(breath)` など（2.8 系のみ） |
| 間 | 本文に `<#1.5#>`（秒） |

## 試作音声

gen-video の `projects/2026-08-12_voice/` の README と mp3 9本（`keep/` 5本、`takes/` 4本）を `data/imports/gen-video-voice/` にコピーした（Git 対象外、2026-10-14、チェックサム一致）。gen-video 側の元ファイルはまだ消していない。
