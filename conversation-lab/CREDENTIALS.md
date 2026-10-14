# WKFL専用キーの中央管理

この文書が答える問い: TTS StudioとConversation Labはどのキーを使うか／何を中央化するか／実体をどう移行するか。

確認日: 2026-10-11。マシン全体の Gemini キーの対応表（AI Studio名・プロジェクト・有料/無料）は `~/playbooks/gemini-tts.md`「キーの使い分け」が正本。

**更新：具体承認に基づき、WKFL専用キーの中央保存を実施済み。ディレクトリ700・ファイル600。旧`.env`は両方保持。両アプリが同じ中央キーを参照することを値を表示せず確認した。**
ユーザー確認済み: 既存キーはWKFL専用として発行され、TTS StudioとConversation Labで同じキーを使う。中央管理は保存場所をホームへ統一する意味で、他プロジェクトとのキー共用ではない。

## 正本と実装

ホーム規約: `/Users/kaya.matsumoto/AGENTS.md` の「API トークンの置き方」。ホームの `.secrets` に保管し、リポジトリ内へ置かない。値をログへ出さない。用途と権限を明確にする。WKFL専用という用途を保持するため、保存先を `~/.secrets/wkfl/gemini-token` に分離する。

両アプリが `WKFL/tools/credentials.mjs` を参照する実装に統一済み。解決順:

1. 明示された `GEMINI_API_KEY_FILE`（絶対パス。無効なら黙ってfallbackしない）
2. プロセス環境の `GEMINI_API_KEY`（既存の明示設定との互換性）
3. **`/Users/kaya.matsumoto/.secrets/wkfl/gemini-token`**
4. 移行前互換: `WKFL/tts-studio/.env` の `GEMINI_API_KEY`
5. 移行前互換: `WKFL/.env` の `GEMINI_API_KEY`

一般共用の `~/.secrets/gemini-token` や他プロジェクト専用ファイルは自動探索しない。ベンダーごと・必要な呼び出し時だけ解決する。旧設定の `.env` からは `tools/credentials.mjs` 内の小さなパーサーで `GEMINI_API_KEY` だけを読み（dotenvには依存しない。2026-10-14）、他のキーや設定をprocess.envへ一括注入しない。モックはキーを読まない。新Lab内の `.env` は読み込まない。

画面の参照方式表示はファイル等の存在に基づく候補表示で、キーの有効性や課金権限を意味しない。`legacy-env-candidate` は旧ファイル候補。共有ローダーはNode 18以降でも利用でき、TTS Studioの最小ランタイムは変更していない。

## 移行元の確認結果（秘密値なし）

| ファイル | 存在 | 変数宣言 |
|---|---|---|
| `/Users/kaya.matsumoto/projects/WKFL/tts-studio/.env` | あり | `GEMINI_API_KEY`あり |
| `/Users/kaya.matsumoto/projects/WKFL/.env` | あり | `GEMINI_API_KEY`あり |

移行前の調査では存在と変数名だけを確認した。その後、具体承認でTTS Studio側のキーを中央保存した。旧ファイル2つの値の同一性は比較しておらず、値は表示していない。

**2026-10-11追記（値は表示せずハッシュで比較）**: 中央保存したキーは `tts-studio/.env` と同一で、`WKFL/.env` のキーとは**別物**。中央のキーで `gemini-3.8-flash-tts` を呼ぶと、Googleは「無料枠（Free Tier）で1日10リクエストまで」と応答した。AI Studioでユーザーが確認：`WKFL/.env` のキーは「news-tts」（Tier 1・前払い）、`tts-studio/.env` のキーは「wkfl-tts-001」（無料枠）。**同日、中央のキーを有料の news-tts に差し替えた**（権限600）。Conversation LabとTTS Studioは以後こちらを使う。無料キーは同日、ユーザー承認で `tts-studio/.env` から削除した（無料枠は今後使わない）。`WKFL/.env` には中央と同じ有料キーが残っているが、現行コードは読まない。従来のTTSの読み込み順は `tts-studio/.env` が先なので、**中央化する第一候補は `tts-studio/.env` の `GEMINI_API_KEY`**。起動時に明示された環境変数がある場合はそちらが優先されるため、実移行前に利用方法を確認する。

## 承認済み操作と実施状況

1. **元**: `/Users/kaya.matsumoto/projects/WKFL/tts-studio/.env` 内の `GEMINI_API_KEY` を移行元として採用する。
2. **先**: `/Users/kaya.matsumoto/.secrets/wkfl/gemini-token` に値だけを保存する。親ディレクトリの作成とアクセス権（ディレクトリ700、ファイル600）設定を伴う。保存先が既に存在する場合は上書きせず停止して確認する。
3. **参照切替**: 保存先は両アプリの既定パスなので、全プロジェクト向け環境変数注入やシェル設定への永続登録は不要。両アプリを次回起動すると中央ファイルを優先する。別の明示 `GEMINI_API_KEY` / `GEMINI_API_KEY_FILE` がある場合は優先順位に従う。
4. **旧ファイル**: 当初は両方の`.env`をそのまま残し、rollbackできるようにする。他社キーや非秘密設定を消さない。
5. **確認**: キーが読めるかの確認と、料金を伴うAPI試験を区別する。実API試験は人間が回数・概算費用を確認して行う。
6. **後片付けは別承認**: 切替確認後、`tts-studio/.env` とWKFL `.env` の `GEMINI_API_KEY` 宣言だけを削除する対象として提示する。ファイル全体は削除しない。キーのローテーション／失効は別作業。

承認対象は、上記の移行元・移行先への秘密値保存・ディレクトリ作成・権限設定。**中央保存・本人限定権限・両アプリの参照確認まで完了**。旧ファイルのキー宣言削除は未実施で、別承認待ち。

## 既存機能への影響

- TTS StudioのCLI、一括生成、セクション試聴は同じ共有ローダーを使う。中央ファイルを優先参照する状態。旧設定へのfallbackは残しているが、中央ファイルが存在すれば旧ファイルへ戻らない。
- TTS Studioは`.env`全体の自動注入をやめた。`WKFL_TTS_MOCK`や`PORT`等の非秘密設定は起動時のプロセス環境で指定する。APIキー以外を`.env`で運用していた場合はこの変更に注意する。
- TTS Studioの生成モデル・台本処理・BGM処理は変更しない。実APIによる回帰試験は行っていない。
- Conversation Labは同じWKFL専用キーを使い、APIキーをブラウザへ渡さない。

## 他サービスの扱い

| サービス・用途 | 現行コードでの参照 | 今回の扱い |
|---|---|---|
| OpenAIの記事生成 | `~/.secrets/wkfl/openai-token` を `app/engine/wkfl_credentials.py` が読む（GitHub Actions はシークレットの環境変数） | ローカルは未配置。Conversation Lab と同じWKFL用キーを使う |
| Anthropicの記事生成／要約 | `~/.secrets/wkfl/anthropic-token` を `app/engine/wkfl_credentials.py` が読む（環境変数があれば優先） | 2026-10-11 に `WKFL/.env` から移動。`WKFL/.env` にはキーが残っていない |
| GitHub Actions | GitHub SecretsのOpenAI／Anthropic | ローカル移行と別管理。変更しない |
| Render旧Web | `render.yaml`の`ANTHROPIC_API_KEY`、`sync:false` | 設定のみ確認済み。変更しない |
| fal画像生成 | `FAL_KEY` または `~/.secrets/fal-token` | ホーム参照を維持。新Labから読まない |
| MiniMax T2A（Conversation Lab） | `~/.secrets/minimax-token` または絶対パスの `MINIMAX_API_KEY_FILE` のみ（`tools/credentials.mjs` の `loadMinimaxKey`）。一般の `MINIMAX_API_KEY` は無視 | **WKFL専用の例外。** gen-video など他プロジェクトとも共用するキーとしてホームに置く（2026-10-14 ユーザー決定）。2026-10-14 に gen-video の従量課金キー `MINIMAX_API_KEY` を値を表示せずにコピーして配置（600）。無料の `get_voice` でクローンボイスが見えることを確認。詳細は [MINIMAX.md](MINIMAX.md) |
| OpenAI Realtime（Conversation Lab） | `~/.secrets/wkfl/openai-token` または絶対パスの `OPENAI_API_KEY_FILE` のみ（`tools/credentials.mjs` の `loadOpenAIKey`）。一般の `OPENAI_API_KEY` は無視 | 2026-10-11 にWKFL用キー（末尾 `…UxoA`）を新規発行して配置（600）。モデル一覧の取得で gpt-realtime-2.1 / mini / gpt-4o-mini-transcribe の利用可を確認。既存の wkfl-ai-news（`…gMoA`）はGitHub Actionsのシークレットにだけあり取り出せない。対応表は `~/playbooks/openai-api-keys.md` |
| ElevenLabs／Cartesia | 新Labには接続・資格情報実装なし | キー登録・保存先作成をしない |

コード上の出所: `tools/credentials.mjs`、`tts-studio/lib/pipeline.mjs`、`tts-studio/server.mjs`、`conversation-lab/lib/credentials.mjs`、`app/engine/synthesize_*.py`、`app/engine/wkfl_pipeline.py`、`.github/workflows/daily_wkfl_briefing.yml`、`tools/image_fal.py`。

## 限定実接続確認

ユーザーがこの1回を明示承認。Gemini 3.8 Live / Koreへ短いテキスト1件、マイクなし、再試行なし。WebSocket接続とsetupが成功し、最初の音声PCMチャンク（2バイト）を受信して即切断。完全な発声・聞き取り・ブラウザ再生・マイク会話は未検証。usage通知は未取得、費用は不明。非秘密の記録は `verification/live-2026-10-11.json`。
