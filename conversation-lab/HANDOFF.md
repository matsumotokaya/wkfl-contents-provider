# Conversation Lab 仕様・引き継ぎ

対象：WKFL内の `conversation-lab/`。この文書が答える問い：何を研究するか、どこまで実装・確認したか、どこから開発を再開するか。記録日：2026-10-11、更新：2026-10-12。

## 目的と境界

**最終目的は、このカタログ自体を公開し、誰でも好きな声・モデル・設定を選ぶときの参考にできるインフォマティブなサイトにすること。** 本人の網羅的な比較はその土台。WKFLのコンテンツ制作に、リアルタイムAI対談の研究を加える。代表的な声・モデル、日本語会話例、反応速度・コストを比較するカタログを育て、録音と研究結果をpodcast/YouTubeへ再利用する。現在は本人だけが使う最短のローカル構成。記事・既存TTS Studioと同じリポジトリの独立サブディレクトリに置き、公開サイトへは接続していない。

将来は管理者だけが生成・リアルタイム会話・試験を実行し、公開閲覧者は承認済みの録音と結果だけを再生する。閲覧者の操作でベンダートークンを消費させない。公開、認証・権限、公開用ストレージ、濫用防止、音声の公開権利・同意・プライバシー審査は未実装。現在のlocalhost制限を認証の代用として公開してはいけない。

## 現在の画面

白基調・画面幅いっぱいの業務アプリ型レイアウト（ヘッダー「CONVERSATION LAB / VOICE RESEARCH / LOCAL WORKBENCH」、左にモデル一覧を固定）。モデル一覧からLive/TTSを選び、声と条件を指定する。Liveは自動発話検出または手動区切り、残り時間、停止、対話ログ、終了時の使用量・概算内訳を表示。TTSは短文を1回生成。モデル別履歴から録音・条件・文字起こし・JSONを確認する。

Geminiを優先し、登録IDは `lib/catalog.mjs` が正本。2026-10-11時点は `gemini-3.8-live`、`gemini-3.8-flash-tts`、`gemini-3.8-flash-lite-tts`。ElevenLabs / Cartesiaは無効なComing soon表示で、実装・接続・正式モデルIDの確認を意味しない。接続追加前に各社公式資料を再確認する。ElevenLabsは小規模の比較を想定。

Gemini 3.8 Liveのみ上部に公式料金とトークン例、下部に日本語・音声形式・VAD・割込み・コンテキスト・接続制限を掲載。他社への料金表の流用はしない。

## 声カタログ

- **声**: 公式プリセット30種（既定Kore）。Liveは公式に「native audio出力モデルはTTSの全プリセット声に対応」とあり、TTS/Liveとも同じ30種を別リストで保持する。数百種のExtended Voice Library（`GET /v1beta/voices`）は公式にTTS向けとだけ記載され、Liveで使えるか未記載のため未接続。アニメ調など個別ニーズが出たときに探索する。
- **プロフィール**: `voiceProfiles`（`lib/catalog.mjs`）。性別はGemini APIの声一覧（`GET /v1beta/voices` の gender、2026-10-11取得。原データは `catalog-sources/google-voices-prebuilt-30-2026-10-11.json`。女性13・男性16・ニュートラル1）。当初はGoogle Cloud Gemini-TTS資料の表を使っていたが、PulcherrimaをFemaleとしており、Gemini APIはneutral、日本語デモの実測の声の高さ（基本周波数の中央値）も148Hzで男性域だったため切り替えた。実測では男性130〜180Hz、女性195〜245Hzに分かれ、女性のGacruxは166Hzで低め。原データには声の高さ（low/medium/high）・ペルソナ・用途分野・推奨用途を含む説明文もあり、ユースケース表示の公式な根拠に使える（未表示）。特徴語はGemini API TTS資料の英語1語、日本語訳は当サイトによる。性格・話し方はプリセットではなく、Liveのsystem instruction（画面の「会話の条件」）やTTSの `speech_metadata.style` で指示する。全声の実利用・日本語の声質は未確認。
- **画面**: 30声すべてをカード一覧で表示（女性/男性/ニュートラルの見出し）。カードを選んで使う。各カードに日本語／英語のデモ再生と「</> コード」の開閉パネルがある。会話・生成中はカードとデモを無効にする（デモ音がマイクに入るのを防ぐ）。
- **コード発行**: 声ごとに「AIへの指示（Claude Code等に貼る文）」「Live APIのsetup JSON」「TTS APIのリクエストJSON」をコピーボタン付きで出す。`lib/snippets.mjs` が生成し、`lib/google.mjs` は実際のリクエストを同じ関数から作る（公開するコード＝実際に送る形。テストで一致を確認）。
- **英語デモ**: Google Cloud資料の音声を、再生ボタンを押したときにブラウザが直接読み込む（CSP `media-src` に `https://docs.cloud.google.com`）。ファイル名から Cloud TTS「Chirp 3: HD」の同名声で作られたもので（2025-06更新）、Gemini 3.8の出力ではない。掲載ページは「別段の記載がない限りCC BY 4.0」。公開時は利用条件を確認し、直接読み込みを続けるか判断する。
- **日本語デモ**: `npm run voice-demos`（既定は計画と概算の表示のみ、`--execute` で課金、`--interval <秒>` で呼び出し間隔）。`gemini-3.8-flash-tts`、全声に同じ文「こんにちは、カンバセーションラボです。…」と同じ指示。順次実行・再試行なし・最初の失敗で停止。文・モデル・指示が現行設定と一致するものだけを有効とし、一致しない旧版は再生成時に `superseded/` へ移す（削除しない）。保存先 `data/voice-demos/ja/<Voice>.wav/.json`（Git対象外）。失敗時は伏せ字済みのエラー本文を `last-error.json` に残す。
- **生成実績（2026-10-11）**: 1件あたり約12秒・出力約320 tokens・概算$0.003。HTTP 429で4回停止。保存したエラー本文で原因が判明：「gemini-3.8-flash-tts は無料枠で1日10リクエストまで」。このキーのプロジェクトは無料枠（Free Tier）で、ここまでのTTS生成の料金は$0。13声まで無料枠で生成したあと、中央のキーを有料プロジェクトのキー（AI Studio名 news-tts、Tier 1・前払い）に差し替え、残り17声を生成して30声そろった（2026-10-11）。無料枠では入出力がGoogleの製品改善に使われ、人が読む場合がある（[Gemini API利用規約](https://ai.google.dev/gemini-api/terms)、有料枠では使われない）。差し替え前のLive会話は無料枠のキー（wkfl-tts-001）で行われていた。

## OpenAI Realtime（2026-10-11 実装・実接続未検証）

- **対応モデル**: `gpt-realtime-2.1` / `gpt-realtime-2.1-mini`（Liveの一覧に追加。`catalog.live.providers` で提供元を判定）。接続は `lib/openai.mjs` がサーバー側WebSocket（`wss://api.openai.com/v1/realtime?model=…`、`Authorization: Bearer`）で行い、サーバーがGemini向けに使うLiveメッセージの形と相互変換する（録音・文字起こし・料金・診断は共通）。setupは `lib/snippets.mjs` の `realtimeSessionUpdate`（発行コードと同じ関数）。
- **音声**: 入出力とも `audio/pcm` 24kHz。ブラウザ取り込みは16kHzのままなので、サーバーで24kHzへ線形補間する（`upsample16kTo24k`）。区切りは `semantic_vad`（手動モードは `turn_detection: null` と commit + response.create）。入力の文字起こしは `gpt-4o-mini-transcribe`（日本語指定、別料金）。挨拶の合図は `response.create` の instructions で送る。
- **声**: 10種（marin・cedar推奨）。OpenAIは性別・特徴も声ごとの試聴ファイルも公開していない（公式の試聴サイトOpenAI.fmは読み上げ専用モデル gpt-4o-mini-tts の声で、公式に「Realtimeの声の一覧は少し違う」とある）。カードは名前・推奨の印・日本語デモ。声は一度話すとセッション中は変更不可。
- **日本語デモ**: `npm run voice-demos -- --provider openai`（`demoSets.openai`）。会話の声に近づけるため、TTSではなく gpt-realtime-2.1 自身に、Geminiと同じ文を「一字一句そのまま読む」指示で1回ずつ読ませる（`speakRealtime`）。文字起こしを保存し、句読点と空白を除いて原文と一致するかを `transcriptMatches` に記録（不一致はカードに※）。2026-10-11に10声を生成し全件一致、実費約$0.196（1声約$0.02、約12〜14秒）。保存先 `data/voice-demos/openai-ja/`。
- **料金の実測比較（2026-10-11）**: gpt-realtime-2.1 は47.8秒で$0.0571（$0.072/分）、gemini-3.8-live は60秒で$0.0163〜0.0185（$0.016〜0.019/分）で約4倍。出力音声の単価が約5.3倍（$64対$12）で、話した1秒あたりのトークン数は両者とも20〜26程度。入力音声の単価は約10.7倍だが、OpenAIはキャッシュが効き、入力音声のトークン数もGeminiより少なかった。reasoning_tokens はテキストの内数（output_tokens＝テキスト＋音声）で、別に加算しない。
- **料金**: `lib/cost.mjs` の `pricingByModel`。2.1：テキスト入力$4・キャッシュ$0.40・出力$24／音声入力$32・キャッシュ$0.40・出力$64。mini：テキスト$0.60・$0.06・$2.40／音声$10・$0.30・$20（100万tokens）。公式に「応答のたびに会話全体が入力として送られる」とあるため、`response.done` の usage を応答ごとに合計し、キャッシュ分はキャッシュ単価。文字起こしは `conversation.item.input_audio_transcription.completed` の usage を別行で計算（入力$1.25・出力$5）。
- **キー**: `~/.secrets/wkfl/openai-token`（または絶対パスの `OPENAI_API_KEY_FILE`）だけを読む。一般の `OPENAI_API_KEY` 環境変数は、他プロジェクトのキーを誤って使わないよう無視する。2026-10-11 にWKFL用キーを新規発行して配置済み（末尾 `…UxoA`）。モデル一覧で gpt-realtime-2.1 / mini の利用可を確認。実会話は未実施。
- **GPT-Live（gpt-live-1、2026-10-12 実装・実会話未検証）**: `lib/openai-live.mjs` がサーバー側WebSocket（`wss://api.openai.com/v1/live/sessions`）で接続し、Liveメッセージの形と相互変換する。開始は `session.start`（`lib/snippets.mjs` の `liveSessionStart`、発行コードと同じ関数）。全二重のため、ターン終了・割り込みのイベントはなく、「会話の区切り」は自然会話のみ（手動はサーバーで拒否）。音声は入出力とも24kHz PCM16、`session.input_audio.append` / `session.output_audio.delta`、文字起こしは `session.input_transcript.delta` / `session.output_transcript.delta`。AIから話し始める合図は `session.instructions.append`（`delegation_id: null`）。開始前のエラーは会話を終え、開始後のエラー（モデレーション等）は記録だけして続ける。終了時は `session.close` を送り、最大1.5秒 `session.closed`（確定秒数）を待つ。
  - **委任（考える役）**: Responses委任。委任先は画面で `gpt-6-luna`（既定、公式の推奨の出発点）か `gpt-6-sol`（複雑な課題向け）を選ぶ。推論は medium、ツールなし（web_search は未設定）。いつ委任するかは、公式のプロンプト指針（live-prompting）に沿って instructions に書いた。
  - **声**: 発表の12種（quartz、ripple、vesper、willow、stone、gleam、meridian、bossa、tempo、beacon、delta、cinder）と初期値の marin。公式に一覧ページがないため、2026-10-12 に各名前で `session.start` を試し、全件受け付けられることを確認した（存在しない名前は拒否、大文字小文字は区別しない、Realtimeの marin・cedar・alloy も可）。試験は音声を送らずすぐ閉じ、課金は全件0秒。
  - **料金**: 音声は1分$0.05（秒単位）。`session.usage.updated`（累計）と `session.closed`（確定）の秒数を使い、届かなければ経過時間で推定（内訳に明記）。委任先は `response.event` 内の `response.completed` の usage（出力に推論分を含む、キャッシュは入力の内数）を gpt-6-luna：入力$0.10・キャッシュ$0.01・出力$0.50、gpt-6-sol：$2・$0.20・$10（100万tokens）で計算。gpt-6-astra（$10・$50）は使わない。
  - **秒数の推定（2026-10-12修正）**: 途中経過の秒数（約15秒ごと）は遅れて届き、`session.closed` の確定値は保存後に届くことがある。確定値がなければ「途中経過と経過時間の大きいほう」を推定として使い、保存後に届いた使用量は記録を更新する（`afterSave: true`）。修正前は60秒の会話を46秒で計算していた。
  - **請求との照合（2026-10-12）**: このキー（`…UxoA`）の請求 $0.31 に対し、記録の合計は $0.3138（Realtime 2.1 の47.8秒 $0.0571、Realtime mini の44.9秒 $0.0104、GPT-Live の60秒 $0.0503、日本語デモ10件 $0.1960、声IDの確認17件は0秒）で一致。
  - **実測の1分あたり**: GPT-Live（委任先 gpt-6-luna）約8円（音声 $0.05/分が大半、委任1回の考える役は約0.04円）。Realtime 2.1 約11円、Realtime mini 約2円、Gemini 3.8 Live 約3円。GPT-Live の音声は会話の長さで課金され、黙っている時間も含む。
  - 違いは画面の「OpenAI の Realtime と GPT-Live の違い」パネルに、公式資料へのリンク付きでまとめた。

## ビジョンと将来要望（ユーザー提示・未着手）

当面は本人が最初のユーザーとして、ローカル・日本語だけで運用する。最終的には音声系コンテンツ制作の総合ライブラリ・リファレンスとして公開する。次は今後の要望で、根拠なく先回りして実装しない。

- 声ごとのユースケース（ニュース、ポッドキャスト、アニメ等）。勝手に割り当てられないため、根拠の取り方を決めてから。
- 多言語化：中国語・韓国語・スペイン語などで全声のデモを用意する。
- アバター：商用利用・再配布可能な画像生成（Nano Banana等）で、声に合う人物アバターを用意する。ストックフォトは使わない。言語ごとに人物を変え（日本語の声に欧米人は違和感）、イラスト版なども用意する。

## 公開を見据えた設計方針

公開先はVercelを検討中。公開する閲覧部分は静的ファイル（HTML・カタログJSON・圧縮音声・画像）だけで成り立つように作り、生成・Live会話はローカルの管理者機能に残す。静的であればVercel・GitHub Pages等のどこでも載せられ、閲覧者がベンダートークンを消費しない。公開時の作業：カタログを言語別のJSONとして書き出す、WAV（1件約600KB）を配信向けに圧縮する、閲覧用の静的ページを管理画面から分ける、英語デモと生成音声・画像の利用条件を確認する。Vercelの無料Hobbyプランは商用利用不可（広告・宣伝・寄付も含む）。WKFLのリポジトリは非公開なので、公開データは別の公開リポジトリに置く想定。

## 実装と配置

| 場所 | 役割 |
| --- | --- |
| `server.mjs` | Node HTTP/WebSocket、localhost制限、CSRF/Origin検査、同時実行1件、時間上限 |
| `public/` | ブラウザ画面、マイク、再生キュー、AudioWorklet録音 |
| `lib/google.mjs` | Gemini Live WSS / TTS Interactions接続、モック |
| `lib/catalog.mjs` | モデル・声（30種）・声プロフィール・入力の検証 |
| `lib/snippets.mjs` | 声ごとの発行コード。実リクエストもここから作る |
| `lib/voice-demos.mjs` / `scripts/voice-demos.mjs` | 日本語デモの生成・状態判定・一覧 |
| `lib/cost.mjs` | 2026-10-11確認の料金スナップショット、純粋な使用量概算関数。サーバーと画面で共用 |
| `lib/store.mjs` | JSON/WAV保存。新規Live終了時は料金スナップショットも保存 |
| `lib/timeline.mjs` | 共通サンプル時間軸から録音を組み立てる |
| `../tools/credentials.mjs` | WKFL専用キーの共通解決。旧TTS Studioも使用 |
| `test/` | 外部接続を禁止したモックと純粋関数テスト |
| `data/experiments/<UUID>/` | 実接続の録音・metadata.json。Git対象外 |
| `data/mock/<UUID>/` | 合成音の検証記録。Git対象外 |
| `verification/` | 許可された実接続の非秘密検証記録 |

`metadata.json`にはモデル・声・条件・日時・状態・イベント・使用量通知・計測・録音情報・ファイル名・送受信量（`transport`）を保持する。音声チャンクはイベントにしない（件数とバイト数のみ）。文字起こしは `lib/transcript.mjs` が話者ごとの行にまとめて保存する（`transcriptFormat: speaker-lines-v1`、2026-10-12）。全二重の GPT-Live では相手の相づちが話し手の断片の間に割り込んで届くため、届いた順につなぐと「け／ど」のように単語が切れていた。規則：句読点だけの断片はその話者の行につなぐ。それ以外は、前の断片から2.5秒以内で、その間に相手が相づち（記号を除き6文字以下）しか言っていなければつなぐ。時刻は GPT-Live なら公式の `start_ms`/`end_ms`（公式に「届いた順でなくこれでまとめる」とある。GPT-Live に文字起こしの設定項目はない）、Realtime の自分の発言は `speech_started` の時刻（文字起こしは返答が始まった後に届くため）、ほかは到着時刻。Gemini の turnComplete と Realtime の response.done でモデルの行を区切る。表示では、相手が話している最中の相づちを段落から外し（保存データには残す）、同じ話者の連続する行を1段落にする。旧形式の記録は表示時に同じ規則でまとめ直す。頻発しうるイベント種別は上限件数（`log-capped`）で打ち切る。1時間の会話でもJSONは数百KB程度。終了済みの従来データは書き換えず、画面で現行スナップショットによる概算を計算する。新規Liveは `costSummary` に単価・URL・確認日・通知別内訳を保存。既存の `cost: null` は確定請求額がないことを表す。TTSの料金算出は未実装。

## 録音の意味

ブラウザAudioWorkletの共通16 kHzサンプルクロックでマイクと描画済み再生音を記録する。`input.wav` / `output.wav` / `mix.wav` は同じ開始点・フレーム数。発話間の無音を詰めず、ミックスは各0.5ゲイン。割込みではキューを止め、未再生音をミックスに入れない。

録音は届いたチャンクをそのまま3本のWAVへ逐次書き込み（`lib/timeline.mjs`。ヘッダーは約10秒ごとに更新するので途中で落ちても再生できる）、メモリに溜めない。送受信の原音（旧 `input-source.wav` / `generated.wav`）は2026-10-12に廃止し、送受信量は `transport` に件数とバイト数だけ残す。スピーカーの物理録音ではなく、OSミュート・Bluetooth遅延・耳に届いた音は測定しない。録音なしの場合はunavailableとし、受信音で代用しない。

停止で課金接続を閉じ、最大1.2秒だけローカル録音の末尾を待つ。欠損や終了フラッシュ不足は `recording.complete: false`。録音位置は worklet が処理したフレーム数（`process()` は1区間に必ず1回）で、ブラウザの `currentFrame` は開始点とずれの報告（`recording-drift`）にだけ使う。すでに置いた音と重なるチャンクは捨てて `recording.anomalies` に記録し、サーバーは録音メッセージの失敗（`recording-error`）で会話を終了しない（2026-10-12）。プロセスやPCの強制終了ではメモリ上の録音が失われうる。

## 使用量と概算料金

正本は `lib/cost.mjs` と[Google公式料金](https://ai.google.dev/gemini-api/docs/pricing)、[UsageMetadata](https://ai.google.dev/api/live)。2026-10-11確認のStandard有料枠、USD/100万tokensを使用する。入力TEXT 0.75 / AUDIO 3 / IMAGE・VIDEO 1、出力TEXT 4.5 / AUDIO 12。算式はモダリティ別tokens × 単価 ÷ 1,000,000。

使用量通知（`usageMetadata`）は原形保存する。保存済みの会話で、通知はAIの1回の応答ごとに届き、出力はその回の分（累計ではない）、入力は毎回それまでの会話全体を含んで回ごとに増えることを確認した（例：入力572→754→1041→1822、出力80→94→162→210）。このためセッションの概算は**受信した通知の合計**（`lib/cost.mjs` の `summarizeLive`、schema `live-cost-estimate-v2`）。Googleは単価の区分を明記していないため、thinkingはテキスト出力、モダリティ内訳のない入力はテキスト入力の単価で計算する（計算前提として画面に明記）。停止・時間切れで途中になった最後の応答は通知が届かないため、AIの発話回数（文字起こしの連続区間）より通知が少ないときは「その分が含まれず、実際は少し多い」と表示する。請求額ではない。

円は `fxSnapshot`（1ドル＝158.25円、ECB参考レート 2026-10-09、frankfurter.dev経由）で換算し、レートと日付を画面に書く。公開前に料金とともに更新する。画面はセッション合計（USD・円・トークン）を上に出し、通知ごとの内訳は開閉式。例：2026-10-11 13:51のAoedeの60秒会話は通知4件で$0.0163（約2.58円）。

## 起動・終了とデータ保持

起動コマンドと前提バージョンは[README](README.md)。`npm run mock`は外部API・キー・マイクなし、合成テスト音のみ。実接続の `npm start` も起動・ページ閲覧・履歴再生だけでは課金APIを呼ばず、生成/開始の人間操作で接続する。モードは画面上部とGET `/health` の `mock` を確認する。上限は1分〜90分から選ぶ（既定5分。使いすぎ防止のためで、会話は停止ボタンでいつでも終えられる）、TTS90秒中止。同時1件、自動再接続・自動retryなし。時間制限は金額上限の保証ではない。

会話を画面で停止し保存完了を待ち、起動ターミナルでCtrl-Cを押してサーバーを終了する。過去にツールの実行セッション終了でサーバーも終了したため、開発中は手元ターミナルで起動し続ける。引き継ぎ時にエージェントが起動した切り離しプロセスが残っている場合、`lsof -nP -iTCP:8788 -sTCP:LISTEN` と `ps`、プロセスのcwdでこのアプリと確認してから、会話中でないことを確かめて終了する。無関係なプロセスをkillしない。OS常駐サービスは未設定。

履歴は研究用のテストデータで、バックアップや厳重な保全はしない（2026-10-12、ユーザー判断）。サーバー停止で `running` のまま残った記録は、次の起動時に `server-stopped` で閉じるだけにして、ほかの記録と同じく自動整理の対象にする（`Store.recoverStale`）。**エージェントがサーバーを再起動するのは、実行中の記録がなく、録音ファイルの更新が30秒以上ないことを確かめたときだけ**（2026-10-12、会話中に再起動して切った）。`data/` はGitではバックアップされない。履歴はユーザーの判断（2026-10-11）でモデルごとに新しい5件だけ残し、古いものは保存・起動のたびにmacOSのゴミ箱（`~/.Trash/conversation-lab-<id>`）へ移す（完全削除はしない。ゴミ箱の一覧はmacOSのプライバシー保護でエージェントから読めないが、移動はできる）。テストや埋め込み利用では `trashDir` を渡さないので移動しない。日本語デモ（`data/voice-demos/`）は対象外。外部アップロードはない。会話内容や声を含むため公開するファイルは別途選定・承認する。

## 資格情報と課金承認

[CREDENTIALS.md](CREDENTIALS.md)が参照順・移行の正本。WKFL専用キーを `~/.secrets/wkfl/gemini-token` に中央保存し、値を文書・ログ・ブラウザ・Gitへ出さない。旧 `.env` は互換性のため保持しており、呼出元移行と実動作の確認後に人間が整理する。他プロジェクトに流用しない。

課金操作は人間の確認が原則。2026-10-11に例外承認されたLive接続1回は消費済み。同日、ユーザーが日本語デモ30声×1回（`gemini-3.8-flash-tts`、概算上限$0.14）の生成を承認し、429で止まった分の再開も含めて実行した（最初の文「WKFLです」のKore 1件は、公開向けに文を変えたため旧版扱い）。これ以外の無断の追加試験・一括声生成・大量実行・自動リトライをしない。

## 確認状態と次の順序（2026-10-12）

- **原則（2026-10-12、ユーザー指示）**: 会話が最優先で、計測・ログ・録音はその補助。こちらの都合（自作の上限・帳簿の検査・データ検証）で会話を止めない。API側の上限は仕方ないので、モデルごとに公式の上限を画面に表示し、終了理由を日本語で見せる。10-12に入れた変更：録音の逐次書き出し（メモリ上限を撤廃）、チャンク単位のイベント廃止、文字起こしの連続区間まとめ、AI側データ異常・ブラウザ受信遅れを非致命に、上限を90分まで、Gemini の文脈圧縮＋セッション再開（GoAway・予期しない切断で同じセッションを新しい接続に継ぎ直す。最大12回）。長時間（10分超・60分）の実会話は未検証で、Gemini の継ぎ直しの実機確認が次の確認項目。
- **実装済み**: 白基調・全幅の画面、声カタログ（Gemini 30声＋OpenAI Realtime 10声＋GPT-Live 13声のカード、日本語／英語デモ、コード発行）、Gemini Live / OpenAI Realtime（2.1・mini）/ GPT-Live（gpt-live-1＋委任先 gpt-6-luna / gpt-6-sol）の会話、AIからの挨拶、話者ごとにつなげた会話ログ、時間軸を保った録音、セッション合計の概算（USD・円、内訳は開閉式）、履歴はモデルごとに5件（古いものはmacOSのゴミ箱へ）、切断の診断記録。
- **実会話で確認（ユーザー）**: Gemini 3.8 Live（声の自然さが最良、本命）、OpenAI Realtime 2.1（会話は成立、日本語に外国人のような訛り）、GPT-Live＋gpt-6-luna（受け答えが最も人間らしく速さも十分、議論相手として有力）。
- **料金の確認**: OpenAIキー（`…UxoA`）の請求 $0.31 と記録の合計 $0.3138 が一致（内訳は「OpenAI Realtime」節）。Geminiは60秒で約3円。
- **テスト**: `npm run lint` と `npm test`（51件、外部通信は禁止、課金なし）。
- **切断の原因と対策（2026-10-12）**: 10-11 の4件（Rasalgethi 2回・Realtime mini・Kore。5〜45秒で `invalid-request` 終了）は、どれも直前の録音チャンクが短く（1区間〜10区間）、次のチャンクの開始位置が巻き戻っていた。原因は、ブラウザの AudioWorklet が1区間（128フレーム）だけ前の `currentFrame` を返し、次の区間で追いつく現象。旧実装は `currentFrame` を録音位置にしていたため、巻き戻った位置のチャンクを送り、サーバーが「Invalid recording offset」で課金中の会話ごと終了していた。対策：録音位置を worklet 自身の処理フレーム数にし、`currentFrame` とのずれは `recording-drift` イベントに記録（前向きのずれが2区間続いたときだけ欠損として扱う）。サーバーは録音メッセージの失敗で会話を終了せず、置けないチャンクは捨てて `recording-anomaly` / `recording-error` に残す。`currentFrame` が止まる引き金（Chrome 側の要因）は未特定。次の会話で `recording-drift` の値（頻度と幅）を確認する。接続側の切断は `provider-close` / `provider-error` を見る。修正後の最初の5分会話（GPT-Live、10-12）では `recording-drift` が−128で8回起きて全て吸収されたが、今度は固定6 MBのマイク入力上限（180秒用の値）に196秒で当たり `invalid-request` 終了した。入出力の保存上限はセッション上限から算出（入力は実時間、出力は実時間の2倍）し、達した場合は `size-limit` として丁寧に終了する。
- **未確認**: Gemini Live での全声・自然な割込み、Flash-Lite TTS、GPT-Live の委任の質（いつ委任するかの指示の調整）、gpt-6-sol との比較。

次の候補（ユーザーと合意済みの方向）:
1. **題材の受け渡しとAI司会**: 会話の画面に「題材」欄（記事の本文またはURL）を足し、開始時の指示文に題材と「AIが司会として進める」指示を入れる。Gemini・Realtime・GPT-Live で共通に使う。URLの本文取得はWKFLの記事生成の取得処理（`app/engine/synthesize_articles.py`）を流用できる。GPT-Live の指示文は最大16,384トークン、会話中の追加は `session.thinking.append`（黙って渡す）/ `session.commentary.append`（言い換えて話させる）/ `session.instructions.append` で各500トークンまで。
2. **画像（Xの画面など）**: GPT-Live は画像・動画の入力に非対応。Gemini 3.8 Live は画像・動画入力に対応（料金表に単価あり）。GPT-Live では、委任先に画像を渡すか、画像を先に文章化して渡す方法が考えられる（未検証）。
3. GPT-Live の委任先に Web 検索を付けるか（1回約1.6円＋検索内容のトークン代）。
4. 声ごとのユースケース表示（`catalog-sources/` の Gemini API データの persona / context / 説明文を根拠に）。
5. 公開に向けた静的化（「公開を見据えた設計方針」）と、ビジョン（多言語・アバター）。

引き継ぎ開始文：

> WKFL/conversation-lab の README、HANDOFF.md、CREDENTIALS.md とプロジェクトの AGENTS.md を読んで続けてください。声カタログ、Gemini Live・OpenAI Realtime・GPT-Live の会話、料金の概算まで実装済みで、OpenAI の請求とも一致を確認しています。キーは ~/.secrets/wkfl/ にあります（対応表は ~/playbooks/gemini-tts.md と ~/playbooks/openai-api-keys.md）。次は「題材の受け渡しとAI司会」から始める予定です。課金を伴う生成は、ユーザーの依頼の範囲で行ってください。
