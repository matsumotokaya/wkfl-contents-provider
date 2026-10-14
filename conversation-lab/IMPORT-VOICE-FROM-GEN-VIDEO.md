# gen-video の VOICE を取り込む — 引き継ぎ

対象：`~/projects/gen-video` の 5 VOICE（MiniMax のクローンボイス TTS）を、このラボへ移す作業。記録日：2026-10-14。gen-video のセッションで調べた。
この文書が答える問い：何を持ってくるか、取り込む前に何を決めるか、取り込んだ後に gen-video で何を片付けるか。
**状態（2026-10-14）：ラボへの取り込みは完了。** 要点は [MINIMAX.md](MINIMAX.md)・CREDENTIALS.md・HANDOFF.md に移した。この文書に残っている役目は、下の「取り込んだ後に gen-video で片付けること」だけ。gen-video の片付けが済んだら、この文書は消す。

## ユーザーの意図

ユーザーは、映像制作の gen-video から音声（TTS）を外に出し、TTS を研究しているこのラボへ寄せたい（2026-10-14）。gen-video では歌詞・小説も前日に `~/projects/word-factory` へ分離しており、gen-video を映像・画像に絞る整理の一環。
gen-video の VOICE にはコードがない。手順書、試作音声、MiniMax 側にあるクローン済みの声だけ。どこまでこのラボに組み込むか（手順書の移管だけか、ベンダーとして画面に足すか）は、ユーザーはまだ言っていない。

## 持ってくるもの

| もの | 場所 | 中身 |
| --- | --- | --- |
| 手順と知見 | `/Users/kaya.matsumoto/projects/gen-video/docs/voice.md` | クローンの4手順、課金の仕組み（実測）、素材の要件、単価、表現の制御 |
| 試作音声 | `/Users/kaya.matsumoto/projects/gen-video/projects/2026-08-12_voice/` | README（git 管理）と mp3 9本（約14MB、git 対象外）。`keep/` に5本、`takes/` に4本 |
| 声 | MiniMax のアカウント側 | `nijiVoiceRefA01`。ファイルではなくアカウントの資産 |
| 記憶 | `~/.claude/projects/-Users-kaya-matsumoto-projects-gen-video/memory/minimax-voice-clone.md` | voice.md と同じ事実と、「新しくクローンせず、まずこの声を使う」という方針 |

`takes/` の4本は gen-video の期限（来てから14日）を過ぎている。gen-video の `npm run takes -- purge --yes` を実行すると消えるので、持ってくるなら先に移す。

## 声の要点

- **存在確認済み。** 2026-10-14 に `POST /v1/get_voice`（`voice_type: voice_cloning`、無料）で `nijiVoiceRefA01`（作成 2026-08-12）が返った。
- 合成は `POST https://api.minimax.io/v1/t2a_v2`、`voice_setting.voice_id = nijiVoiceRefA01`。モデルは `speech-2.8-hd`（100ドル／百万文字）か `speech-2.8-turbo`（60ドル／百万文字）。単価は 2026-08 時点なので、使う前に公式資料を再確認する。
- 実績は 591文字・1分45秒で 0.059ドル。
- 日本語は `language_boost: "Japanese"`。`emotion` は付けない方が元の口調が残る。`(breath)` `(chuckle)` などのタグは 2.8 系だけ。
- クローン費 1.5ドルは、声ごとに初回の合成時に1回だけかかる。この声は支払い済みで、以後は文字代だけ。新しくクローンすると、また 1.5ドルかかる。
- クローン元の wav（`~/Desktop/niji-voice/…`）はもう手元にない。声は MiniMax 側に残っているので、作り直さない限り要らない。

## 決まったこと（2026-10-14、ユーザーの判断）

1. **キー**：WKFL専用にはせず、ホームの `~/.secrets/minimax-token`（600）で gen-video などとも共用する。中身は gen-video の `.env` の従量課金キー `MINIMAX_API_KEY` をコピーしたもの。このキーで `get_voice` を呼び、クローンが見えることを確認済み。
2. **公開**：ユーザーは権利を「確認済み」と回答した。公開カタログに載せてよい。出所・条件の中身は MINIMAX.md に追記待ち。
3. **深さ**：TTS ベンダーとして画面に足した（`lib/minimax.mjs`、カタログ、料金、資格情報、テスト）。新しくクローンする機能は付けていない。
4. **試作音声**：9本とも `data/imports/gen-video-voice/` にコピー済み（チェックサム一致）。gen-video 側の元ファイルはまだ消していない。

## 取り込んだ後に gen-video で片付けること

gen-video の MENU は番号を変えない規則で、移管した 9・13 は欠番の節として残している。5 も同じ形にする。

- `MENU.md`
  - 「5. VOICE」の節を、9・13 と同じ移管の節（移管日と移管先、欠番のまま残す旨）に書き換える。
  - 節の中の「H3 の自動生成音声は制御できないので、セリフは TTS で別建てにして後乗せする。動画側は `Audio: no dialogue, only ambient room tone`」は映像側の規則なので、gen-video に残す。
  - 冒頭の表の 5 の行、冒頭の説明の「セリフの TTS だけはこちらの 5 VOICE」、9 の節の「セリフの TTS は 5 VOICE」、LEDGER 節の「VOICE の手動生成」、「使う経路が分からないとき」の「できたセリフを読み上げたい」を、移管先を指す形にする。
- `README.md` の「素材を作る」行、`projects` 表の voice の行、`docs` 表の voice.md の行。
- `AGENTS.md` の「2 ANIMATE / … / 5 VOICE / …」の行から 5 VOICE を外し、移管先を書く。
- `docs/voice.md` と `projects/2026-08-12_voice/` を削除する（mp3 を移した後）。`docs/archive/RESTRUCTURE-2026-09-07.md` は履歴なので触らない。
- `.env` の `MINIMAX_SUBSCRIPTION_KEY` は残す。`MINIMAX_API_KEY` は、動画生成（`src/config.ts`）が共用の `~/.secrets/minimax-token` を読むように変えてから `.env` から外す（変えるまでは残す）。
- gen-video の記憶から `minimax-voice-clone.md` を外して、このラボの記憶へ移す。`minimax-subscription.md` は動画の課金の話も含むので gen-video に残す。
- word-factory の3か所が「セリフの TTS は gen-video の 5 VOICE」を指している。`AGENTS.md`（gen-video との関係）、`README.md`（gen-video との関係）、`docs/SONGWORK.md`（作る）。移管先に付け替える。
- gen-video の MV でナレーションやセリフを使うときは、歌詞と同じく、できた音声ファイルを作品の `inputs/` に置く。

## 開始文

> （取り込み済み。gen-video のセッションでは次の文を使う）
> WKFL の conversation-lab/IMPORT-VOICE-FROM-GEN-VIDEO.md の「取り込んだ後に gen-video で片付けること」を進めたい。消す前に、移した先にあることを確かめて。
