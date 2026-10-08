# 配信先と投稿作業

制作した記事・音声・動画を投稿するときは、[配信プレイブック](../playbooks/publishing.md)から始める。
Xの文案作成・修正・公開前には毎回 [Xの文体指針](X/STYLE.md) も読む。
IDEで原稿を保存し、ChatGPTデスクトップアプリにパスを渡して、個人用Chrome経由で下書き作成・承認後の公開を依頼する。

| 媒体 | このディレクトリの用途 | 配信手順 |
|---|---|---|
| `X/` | `drafts/` は投稿原稿、`posted/` は投稿結果、`list/` は取得データ | [接続・アカウント照合・承認・結果確認](../playbooks/publishing.md) |
| `note/` | note向け素材。記事本文の正本は `articles/` | [記事の引き継ぎと下書き確認](../playbooks/publishing.md) |
| `podcast/` | 台本関連・BGM素材。生成手順は `tts-studio/README.md` | [完成音声の引き継ぎと配信確認](../playbooks/publishing.md) |

媒体ごとの実行可否・検証状況はプレイブックに集約する。

noteのサムネイルは [サムネイルの作り方](../playbooks/note-thumbnail.md)（サイズ・道具・プロンプト・作例）。
