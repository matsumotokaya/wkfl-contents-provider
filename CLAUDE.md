# WKFL プロジェクト — Claude向け補足

> **記事生成プロセスの必須ルールは `/Users/kaya.matsumoto/AGENTS.md` の「WKFL Project」セクションが正本。**  
> このファイルはその補足情報のみ記載する。

---

## 記事生成の3段階（概要）

詳細はAGENTS.mdを参照。要点のみ：

1. **Dossier** → ユーザー確認 → **Article** → ユーザー確認 → **Podcast台本** → ファイル保存
2. 各段階をスキップ・まとめて出力することは禁止
3. Dossierを出さずに記事を書き始めた時点でプロセス違反

## 参照すべきプロンプトテンプレート

`app/engine/wkfl_pipeline.py` に全テンプレートがある:

| 段階 | ルートB用テンプレート |
|---|---|
| 第1段階 | `SELECTED_DOSSIER_PROMPT_TEMPLATE` |
| 第2段階 | `SELECTED_ARTICLE_PROMPT_TEMPLATE` |
| 第3段階 | `PODCAST_SCRIPT_PROMPT_TEMPLATE` |

ルートA（Reddit）・ルートC（FreeTalk）も同様に対応するテンプレートが存在する。

## ペルソナ

`app/engine/wkfl_persona.py` の `WKFL_PERSONA_BLOCK` が正本。

- 一人称: 「僕」
- 最終行: 「それでは、また明日お会いしましょう。」
- 「概要」「WKFL's Eye」などのサブ見出しで区切らない（monologue形式）
- タイトル: 55〜70文字、具体的なニュースを前面に出す

## 出力先

`articles/YYYY-MM-DD/` に3ファイルセットで保存する。
