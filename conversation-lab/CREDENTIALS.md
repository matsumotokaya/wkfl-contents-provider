# WKFL専用キーの中央管理

この文書が答える問い: 旧TTS StudioとConversation Labはどのキーを使うか／何を中央化するか／実体をどう移行するか。

確認日: 2026-10-11。

**更新：具体承認に基づき、WKFL専用キーの中央保存を実施済み。ディレクトリ700・ファイル600。旧`.env`は両方保持。両アプリが同じ中央キーを参照することを値を表示せず確認した。**
ユーザー確認済み: 既存キーはWKFL専用として発行され、旧TTS Studioと新Conversation Labで同じキーを使う。中央管理は保存場所をホームへ統一する意味で、他プロジェクトとのキー共用ではない。

## 正本と実装

ホーム規約: `/Users/kaya.matsumoto/AGENTS.md` の「API トークンの置き方」。ホームの `.secrets` に保管し、リポジトリ内へ置かない。値をログへ出さない。用途と権限を明確にする。WKFL専用という用途を保持するため、保存先を `~/.secrets/wkfl/gemini-token` に分離する。

両アプリが `WKFL/tools/credentials.mjs` を参照する実装に統一済み。解決順:

1. 明示された `GEMINI_API_KEY_FILE`（絶対パス。無効なら黙ってfallbackしない）
2. プロセス環境の `GEMINI_API_KEY`（既存の明示設定との互換性）
3. **`/Users/kaya.matsumoto/.secrets/wkfl/gemini-token`**
4. 移行前互換: `WKFL/tts-studio/.env` の `GEMINI_API_KEY`
5. 移行前互換: `WKFL/.env` の `GEMINI_API_KEY`

一般共用の `~/.secrets/gemini-token` や他プロジェクト専用ファイルは自動探索しない。ベンダーごと・必要な呼び出し時だけ解決する。dotenvのparseは旧設定からGoogleキーだけを選ぶために使い、他のキーや設定をprocess.envへ一括注入しない。モックはキーを読まない。新Lab内の `.env` は読み込まない。

画面の参照方式表示はファイル等の存在に基づく候補表示で、キーの有効性や課金権限を意味しない。`legacy-env-candidate` は旧ファイル候補。共有ローダーはNode 18以降でも利用でき、旧TTSの最小ランタイムは変更していない。

## 移行元の確認結果（秘密値なし）

| ファイル | 存在 | 変数宣言 |
|---|---|---|
| `/Users/kaya.matsumoto/projects/WKFL/tts-studio/.env` | あり | `GEMINI_API_KEY`あり |
| `/Users/kaya.matsumoto/projects/WKFL/.env` | あり | `GEMINI_API_KEY`あり |

移行前の調査では存在と変数名だけを確認した。その後、具体承認で旧TTS側のキーを中央保存した。旧ファイル2つの値の同一性は比較しておらず、値は表示していない。従来のTTSの読み込み順は `tts-studio/.env` が先なので、**中央化する第一候補は `tts-studio/.env` の `GEMINI_API_KEY`**。起動時に明示された環境変数がある場合はそちらが優先されるため、実移行前に利用方法を確認する。

## 承認済み操作と実施状況

1. **元**: `/Users/kaya.matsumoto/projects/WKFL/tts-studio/.env` 内の `GEMINI_API_KEY` を移行元として採用する。
2. **先**: `/Users/kaya.matsumoto/.secrets/wkfl/gemini-token` に値だけを保存する。親ディレクトリの作成とアクセス権（ディレクトリ700、ファイル600）設定を伴う。保存先が既に存在する場合は上書きせず停止して確認する。
3. **参照切替**: 保存先は両アプリの既定パスなので、全プロジェクト向け環境変数注入やシェル設定への永続登録は不要。両アプリを次回起動すると中央ファイルを優先する。別の明示 `GEMINI_API_KEY` / `GEMINI_API_KEY_FILE` がある場合は優先順位に従う。
4. **旧ファイル**: 当初は両方の`.env`をそのまま残し、rollbackできるようにする。他社キーや非秘密設定を消さない。
5. **確認**: キーが読めるかの確認と、料金を伴うAPI試験を区別する。実API試験は人間が回数・概算費用を確認して行う。
6. **後片付けは別承認**: 切替確認後、`tts-studio/.env` とWKFL `.env` の `GEMINI_API_KEY` 宣言だけを削除する対象として提示する。ファイル全体は削除しない。キーのローテーション／失効は別作業。

承認対象は、上記の移行元・移行先への秘密値保存・ディレクトリ作成・権限設定。**中央保存・本人限定権限・両アプリの参照確認まで完了**。旧ファイルのキー宣言削除は未実施で、別承認待ち。

## 既存機能への影響

- 旧TTSのCLI、一括生成、セクション試聴は同じ共有ローダーを使う。中央ファイルを優先参照する状態。旧設定へのfallbackは残しているが、中央ファイルが存在すれば旧ファイルへ戻らない。
- 旧TTSは`.env`全体の自動注入をやめた。`WKFL_TTS_MOCK`や`PORT`等の非秘密設定は起動時のプロセス環境で指定する。APIキー以外を`.env`で運用していた場合はこの変更に注意する。
- 旧TTSの生成モデル・台本処理・BGM処理は変更しない。実APIによる回帰試験は行っていない。
- Conversation Labは同じWKFL専用キーを使い、APIキーをブラウザへ渡さない。

## 他サービスの扱い

| サービス・用途 | 現行コードでの参照 | 今回の扱い |
|---|---|---|
| OpenAIの記事生成 | `OPENAI_API_KEY`、WKFL `.env`のdotenv読み込み | 変更しない。将来WKFL専用保存へ移す場合は記事生成への影響も確認 |
| Anthropicの記事生成／要約 | `ANTHROPIC_API_KEY`。`app/engine/list_today_news.py`は独自パースと環境変数上書き | 変更しない。将来のローダー統一対象 |
| GitHub Actions | GitHub SecretsのOpenAI／Anthropic | ローカル移行と別管理。変更しない |
| Render旧Web | `render.yaml`の`ANTHROPIC_API_KEY`、`sync:false` | 設定のみ確認済み。変更しない |
| fal画像生成 | `FAL_KEY` または `~/.secrets/fal-token` | ホーム参照を維持。新Labから読まない |
| ElevenLabs／Cartesia | 新Labには接続・資格情報実装なし | キー登録・保存先作成をしない |

コード上の出所: `tools/credentials.mjs`、`tts-studio/lib/pipeline.mjs`、`tts-studio/server.mjs`、`conversation-lab/lib/credentials.mjs`、`app/engine/synthesize_*.py`、`app/engine/wkfl_pipeline.py`、`.github/workflows/daily_wkfl_briefing.yml`、`tools/image_fal.py`。

## 限定実接続確認

ユーザーがこの1回を明示承認。Gemini 3.8 Live / Koreへ短いテキスト1件、マイクなし、再試行なし。WebSocket接続とsetupが成功し、最初の音声PCMチャンク（2バイト）を受信して即切断。完全な発声・聞き取り・ブラウザ再生・マイク会話は未検証。usage通知は未取得、費用は不明。非秘密の記録は `verification/live-2026-10-11.json`。
