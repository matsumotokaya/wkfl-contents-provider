# WKFL Conversation Lab

自分用・ローカル専用の日本語音声研究。モデル一覧 → 会話／読み上げ → 選択モデルの履歴、の小さなWebサイトです。

仕様・構成・確認状態・残件は [HANDOFF.md](HANDOFF.md)、資格情報は [CREDENTIALS.md](CREDENTIALS.md) が正本です。

## 起動

Node.js 22.14以上。WKFLの `tts-studio/node_modules/ws` があれば追加インストール不要です。独立した環境では `npm install --ignore-scripts` で固定バージョンの `ws` を導入してください。

```bash
cd /Users/kaya.matsumoto/projects/WKFL/conversation-lab
npm run mock
```

画面: http://127.0.0.1:8788 。モックは外部API・資格情報読み取り・マイクを使いません（声カードの「英語デモ」を押したときだけ、ブラウザがGoogle Cloud資料の公開音声を読み込みます）。出力は合成テスト音で、実際の声・会話・遅延の評価対象ではありません。

実際のAPIを使う場合は、人間がモックを終了して `npm start`。起動・ページ表示・履歴再生だけではAPIを呼びません。「1回生成」または「会話を開始」の明示操作から課金対象になります。既存のキーを参照し、新しい `.env` は作りません。参照順と移行計画は [CREDENTIALS.md](CREDENTIALS.md)。

## 現在できること

- Gemini 3.8 Flash TTS / Flash-Lite TTS: 同じ日本語短文と声・読み方を指定し、1回ずつWAVと条件を保存。
- Gemini 3.8 Live: 自然会話を既定とし、サーバーVADで発話を検出。開始後マイクを送り、音声応答を再生。割り込み時は再生キューを破棄。
- 手動区切りモード: 「話し始める」→「発話を送る」で区切り、終了通知から最初の音声受信までを測定。
- Liveの上限は1分〜90分から選ぶ（既定5分）。使いすぎ防止のためで、会話は停止ボタンでいつでも終えられます。各モデルの公式セッション上限は画面に表示します（Realtime は60分、GPT-Live は非公開、Gemini は圧縮とセッション再開で接続を継ぎ直す）。
- 声カタログ: 公式プリセット30声をカードで一覧表示。日本語デモ（`npm run voice-demos`。既定は計画表示のみ、`--execute` で1声1回のTTS課金）と英語デモ（Google Cloud資料）を再生できる。各カードの「</> コード」から、AIへの指示・Live API setup・TTSリクエストのJSONをコピーできる。
- OpenAI Realtime（gpt-realtime-2.1 / mini）: Gemini Liveと同じ画面・録音・料金表示で会話できる。
- OpenAI GPT-Live（gpt-live-1）: 会話は gpt-live-1、深い推論は委任先（gpt-6-luna / gpt-6-sol）が担当。全二重のため自然会話のみ。料金は音声の秒数＋委任先のトークン。キーは `~/.secrets/wkfl/openai-token`。RealtimeとGPT-Liveの違いは画面の説明パネル。
- 選択モデルごとの日時・声・条件・録音・文字起こし・API使用量と概算料金（USD・円）の履歴。モデルごとに新しい5件だけ残し、古いものはmacOSのゴミ箱へ移す。ElevenLabs / Cartesiaは無効な「追加予定」のみ。

Gemini Live・OpenAI Realtime・GPT-Live は、2026-10-11〜12 にユーザーの実会話で動作を確認しました。全声の日本語品質や自然な割り込みの評価はまだです。確認状態の詳細は [HANDOFF.md](HANDOFF.md#確認状態と次の順序2026-10-12)。

## 保存形式と限界

`data/experiments/<UUID>/` に `metadata.json` と `speech.wav`（TTS）、`mix.wav` / `input.wav` / `output.wav`（Live）を保存します。モックは別の `data/mock/`。どちらもGit対象外です。Liveの録音は届いたそばからディスクへ書くので、会話の長さでメモリは増えません（16 kHz mono で1時間あたり3本合計約345 MB）。

Liveの会話録音は、ブラウザAudioWorkletの共通サンプルクロック（16 kHz、16bit mono）から作ります。

- `mix.wav`: 入力と再生音を同じ時間軸で合成（各0.5ゲイン）。
- `input.wav`: マイク入力。発話間の無音を含みます。
- `output.wav`: ブラウザWeb Audioグラフがスピーカー出力へ描画した音。割り込み・停止で未再生のまま破棄したチャンクは入りません。
- 送受信の原音（旧 `input-source.wav` / `generated.wav`）は保存しません。送受信量は `metadata.json` の `transport`（バイト数・チャンク数）にだけ残します。

会話用3ファイルは同じフレーム数・同じ開始点で、無音と相対時刻を保持します。JSONに開始フレーム、チャンクごとの開始オフセット、欠損区間、終了フラッシュ受信状況を保存します。ネットワーク受信時刻で音を配置しません。録音が届かなかった場合は原音を会話録音に見せかけず、`unavailable`とします。

**会話が最優先で、記録・計測は補助です。** 録音の帳簿の問題、AI側のデータ異常、ブラウザの受信遅れ、長時間化は、どれも `metadata.json` に記録するだけで会話を終了しません（2026-10-12）。会話が終わる理由は「停止ボタン」「設定した上限時間」「AI側の切断・エラー」「ブラウザの切断」だけで、画面の履歴にその理由を日本語で表示します。停止・時間上限では課金接続を即時切断し、最大1.2秒だけローカル録音の末尾を待ちます。タブ強制終了や回線断では末尾が欠ける場合があり、`recording.complete: false`を表示します。AudioContextが途中で停止・中断した場合もセッションを終了します。プロセス強制終了・PC終了ではメモリ上の録音を失う可能性があります。

**これは物理スピーカーのループバック録音ではありません。** OSの音量・ミュート・Bluetooth遅延・実際に耳に届いた音は測定しません。ブラウザ実機での再生録音は未検証です。モックでは既知の無音100ms、入力100ms、応答100ms、割り込み後の無音100msと、終了端のフラッシュ・欠損検出を検証します。

TTSは `request_to_complete_wav_ms`（サーバー処理開始→全WAV受信）。Live手動モードは `server_activity_end_to_first_audio_ms`（ローカルサーバーの終了通知処理→最初の応答PCM受信）。**人間の実際の発話終了→スピーカー再生開始の遅延ではありません。** 自然会話の遅延は未計測。既存Studioの推定字幕時刻は利用しません。

使用量はGoogleの `usage` / `usageMetadata` を原形のまま記録し、Liveはイベント単位で残します。累積値／ターン値を勝手に合算しません。Gemini 3.8 Liveは通知別の取得済みモダリティ内訳だけを公式単価で概算表示します。通知は合算せず、最終使用量と集計範囲が未確認のセッション総額は `null`（不明）のままです。新規Liveでは単価・確認日・公式URL付きの `costSummary` を保存します。詳細は [HANDOFF.md](HANDOFF.md#使用量と概算料金)。モック測定は `simulated: true`。

## 人間による実API試験

会話は人間が画面の「会話を開始」で行います。AIが課金を伴う生成（日本語デモなど）をするのは、ユーザーが依頼した範囲だけです。デモ生成は `npm run voice-demos` が既定で計画と概算だけを表示し、`--execute` を付けたときだけ実行します。料金の確認できない一覧取得（Geminiの声一覧、OpenAIのモデル一覧）は課金されません。

一括全声生成、ロード時の自動生成、生成ボタンの連打、自動retryはありません。同時実行はサーバー全体で1件です。TTSは90秒で中止しますが、中止前に実行された生成の課金取り消しを保証しません。Liveも料金上限を金額で保証する仕組みではなく、時間制限です。

## 無料のローカル検証

```bash
npm run lint
npm test
```

`lint` はJS構文検査です。テストはコード内で `fetch` とTLS接続を禁止し、127.0.0.1のHTTP/WebSocketと仮キーだけを使います。テスト前に内容を確認する運用を維持してください。既存WKFLの生成スクリプトはテストから呼びません。

## 接続の境界

サーバーは127.0.0.1にのみbind。Host・Origin・Fetch Metadata・メモリ上のリクエストトークンを検査し、WebSocketのupgradeでもOriginとトークンを検査します。ページ自体の表示（トップレベルのGETナビゲーション）だけは別サイト起点でも許可します（ブラウザ自動操作で画面を確認するため。2026-10-11ユーザー承認）。API読み取り・生成・会話開始の検査は変えていません。Googleへの接続はサーバープロキシで、ブラウザに長期キーを渡しません。公開ホスティング・ユーザー認証・公開ストレージは未実装です。

`lib/google.mjs` がベンダー接続、`lib/catalog.mjs` がTTS/Live別のモデル・声カタログ、`../tools/credentials.mjs` が旧TTS Studioと共通のWKFL専用資格情報参照（`lib/credentials.mjs`から再export）、`lib/store.mjs` が保存境界です。声リストは別々に保持し、名称の一致を音質の同一性とは扱いません。Grounding・ツール呼び出し・声の複製は無効／未実装です。

## 公式仕様（2026-10-11確認）

- [モデル一覧](https://ai.google.dev/gemini-api/docs/models): 通常推論 `gemini-3.8-flash` はこのアプリの音声モデル一覧に含めない。
- [TTS](https://ai.google.dev/gemini-api/docs/speech-generation): 3.8はREST Interactions API、本文と `speech_metadata.style` を分離。旧StudioのgenerateContent形式を流用しない。
- [Live WebSocket](https://ai.google.dev/gemini-api/docs/live-api/get-started-websocket) / [APIリファレンス](https://ai.google.dev/api/live): WSSはv1beta、音声は入力16 kHz／出力24 kHz。
- [Live capabilities](https://ai.google.dev/gemini-api/docs/live-api/capabilities): 声の対応と自動VAD。native audio出力モデルはTTSの全プリセット声（30種）に対応。声リストはTTSとは別設定にする。性別は[Google Cloud Gemini-TTS資料](https://docs.cloud.google.com/text-to-speech/docs/gemini-tts)の表による。

研究の次段: OpenAI RealtimeとGPT Liveは別方式として比較。ElevenLabsは少量、Cartesiaは候補。各社の価格やモデルIDは接続追加時に公式資料を再確認する。公開する場合は自作台本・AI生成・事前録音を明示し、承認済みファイルだけを書き出す。

## 今回の検証記録

`npm run lint` と `npm test`（51件）は、外部fetch/TLSを禁止し、課金APIやマイクを使いません。エージェントの自動ブラウザ（Claude in Chrome）からもページを読めます（トップレベルの表示だけ許可。API・生成・会話の検査は不変）。見た目の確認はユーザーが行い、エージェントはスクリーンショットを頼まれたときだけ撮ります。

現在の稼働モードは `/health` の `mock` で確認できます。実接続モードでは起動・ページ表示だけでは生成せず、「会話を開始」または単発生成の操作から課金対象です。上限は1分〜90分から選びます（既定5分）。
