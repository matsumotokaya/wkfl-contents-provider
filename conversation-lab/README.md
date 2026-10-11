# WKFL Conversation Lab

自分用・ローカル専用の日本語音声研究。モデル一覧 → 会話／読み上げ → 選択モデルの履歴、の小さなWebサイトです。

## 起動

Node.js 22.14以上。WKFLの `tts-studio/node_modules/ws` があれば追加インストール不要です。独立した環境では `npm install --ignore-scripts` で固定バージョンの `ws` を導入してください。

```bash
cd /Users/kaya.matsumoto/projects/WKFL/conversation-lab
npm run mock
```

画面: http://127.0.0.1:8788 。モックは外部通信・資格情報読み取り・マイクを使いません。出力は合成テスト音で、実際の声・会話・遅延の評価対象ではありません。

実際のAPIを使う場合は、人間がモックを終了して `npm start`。起動・ページ表示・履歴再生だけではAPIを呼びません。「1回生成」または「会話を開始」の明示操作から課金対象になります。既存のキーを参照し、新しい `.env` は作りません。参照順と移行計画は [CREDENTIALS.md](CREDENTIALS.md)。

## 現在できること

- Gemini 3.8 Flash TTS / Flash-Lite TTS: 同じ日本語短文と声・読み方を指定し、1回ずつWAVと条件を保存。
- Gemini 3.8 Live: 自然会話を既定とし、サーバーVADで発話を検出。開始後マイクを送り、音声応答を再生。割り込み時は再生キューを破棄。
- 手動区切りモード: 「話し始める」→「発話を送る」で区切り、終了通知から最初の音声受信までを測定。
- Liveは既定60秒・最大180秒、明示停止、タブ切断／接続失敗時に切断。自動再接続・自動再試行はありません。
- 選択モデルごとの日時・声・条件・録音・文字起こし・API使用量の履歴。OpenAI Realtime / GPT Live / ElevenLabs / Cartesiaは無効な「追加予定」のみ。

**実API・マイクの動作、各モデルでの声の利用可否、日本語品質、自然会話の割り込みは未検証です。** 公式仕様に基づく接続実装とモック検証までを行っています。モデルのアクセス権や実利用可否を保証しません。

## 保存形式と限界

`data/experiments/<UUID>/` に `metadata.json` と `speech.wav`（TTS）、`input.wav` / `output.wav`（Live）を保存します。モックは別の `data/mock/`。どちらもGit対象外です。

Liveは入力16 kHz、出力24 kHz、16bit mono WAV。**2トラックは各PCMチャンクを連結したものです。無音の間を挿入しないため同期した会話の録音ではありません。** 発話・受信イベントの時刻、各トラックのバイト位置をJSONに保存します。出力は受信した生成音声で、停止・割り込みで耳に届かなかった部分も含みます。正確な会話の再現／Podcast編集には、ブラウザ再生時刻と無音を保持した同期録音が次の作業です。正常停止・通信切断では保存しますが、プロセス強制終了・PC終了ではメモリ上の音声を失う可能性があります。

TTSは `request_to_complete_wav_ms`（サーバー処理開始→全WAV受信）。Live手動モードは `server_activity_end_to_first_audio_ms`（ローカルサーバーの終了通知処理→最初の応答PCM受信）。**人間の実際の発話終了→スピーカー再生開始の遅延ではありません。** 自然会話の遅延は未計測。既存Studioの推定字幕時刻は利用しません。

使用量はGoogleの `usage` / `usageMetadata` を原形のまま記録し、Liveはイベント単位で残します。累積値／ターン値を勝手に合算しません。費用は `null`（未算出）で、0円と表示しません。モック測定は `simulated: true`。

## 人間による実API試験

実API試験は人間が行います。AIは無料枠でも外部API試験を行いません。初回の試験前に、選択モデルの現行料金・回数・時間上限・概算費用を別途確認してください。最小候補は **TTSの共通短文1回、Live 30秒1セッション**。これは試験実行の承認ではありません。

一括全声生成、ロード時の自動生成、生成ボタンの連打、自動retryはありません。同時実行はサーバー全体で1件です。TTSは90秒で中止しますが、中止前に実行された生成の課金取り消しを保証しません。Liveも料金上限を金額で保証する仕組みではなく、時間制限です。

## 無料のローカル検証

```bash
npm run lint
npm test
```

`lint` はJS構文検査です。テストはコード内で `fetch` とTLS接続を禁止し、127.0.0.1のHTTP/WebSocketと仮キーだけを使います。テスト前に内容を確認する運用を維持してください。既存WKFLの生成スクリプトはテストから呼びません。

## 接続の境界

サーバーは127.0.0.1にのみbind。Host・Origin・Fetch Metadata・メモリ上のリクエストトークンを検査し、WebSocketのupgradeでもOriginとトークンを検査します。Googleへの接続はサーバープロキシで、ブラウザに長期キーを渡しません。公開ホスティング・ユーザー認証・公開ストレージは未実装です。

`lib/google.mjs` がベンダー接続、`lib/catalog.mjs` がTTS/Live別のモデル・声カタログ、`lib/credentials.mjs` が用途別資格情報参照、`lib/store.mjs` が保存境界です。声リストは別々に保持し、名称の一致を音質の同一性とは扱いません。Grounding・ツール呼び出し・声の複製は無効／未実装です。

## 公式仕様（2026-10-11確認）

- [モデル一覧](https://ai.google.dev/gemini-api/docs/models): 通常推論 `gemini-3.8-flash` はこのアプリの音声モデル一覧に含めない。
- [TTS](https://ai.google.dev/gemini-api/docs/speech-generation): 3.8はREST Interactions API、本文と `speech_metadata.style` を分離。旧StudioのgenerateContent形式を流用しない。
- [Live WebSocket](https://ai.google.dev/gemini-api/docs/live-api/get-started-websocket) / [APIリファレンス](https://ai.google.dev/api/live): WSSはv1beta、音声は入力16 kHz／出力24 kHz。
- [Live capabilities](https://ai.google.dev/gemini-api/docs/live-api/capabilities): 声の対応と自動VAD。声候補Kore/Puck/Charon/AoedeをTTSとは別設定にする。

研究の次段: OpenAI RealtimeとGPT Liveは別方式として比較。ElevenLabsは少量、Cartesiaは候補。各社の価格やモデルIDは接続追加時に公式資料を再確認する。公開する場合は自作台本・AI生成・事前録音を明示し、承認済みファイルだけを書き出す。

## 今回の検証記録

JS構文検査と、外部fetch/TLSを禁止したモック10項目を確認。課金API・マイクは実行していません。ブラウザによる画面確認は、実行環境のChrome接続がlocalhostを `ERR_BLOCKED_BY_CLIENT` で拒否したため未完です。PC上の通常ブラウザでモック画面を開くことが次の確認になります。
