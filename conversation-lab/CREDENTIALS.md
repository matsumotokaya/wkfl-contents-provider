# 資格情報の管理と移行計画

この文書が答える問い: WKFLのAPIキーはどこから参照されるか／ホーム規約との違い／既存機能を壊さずどう移すか。

確認日: 2026-10-11。秘密値・マスク断片は取得表示せず、コードの参照・ファイルの存在・規約のみを確認した。以下の変数名はコードで要求される名前であり、実ファイル内の登録有無や有効性を意味しない。

## 正本

`/Users/kaya.matsumoto/AGENTS.md` の「API トークンの置き方」: `~/.secrets/<service>-token`、600、リポジトリ内には置かない、値をログに出さない、用途／権限を記録する。

Geminiの仕様は `/Users/kaya.matsumoto/playbooks/gemini-tts.md`。別プロジェクト専用キーの記載があるが、WKFLへ流用・参照先追加はしていない。ホーム規約は全キーを全プロジェクトへ注入する方式を求めていない。

## 現行の参照方式

| 用途 | 変数・保存方式 | 根拠・課題 |
|---|---|---|
| TTS Studio | `GEMINI_API_KEY`。`tts-studio/.env` → WKFL `.env` | `tts-studio/lib/pipeline.mjs`: dotenvでファイル全体をprocess.envへロード。リポジトリ内保存を推奨するREADMEがホーム規約と不一致 |
| 記事生成 | `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`。WKFL `.env` | `app/engine/synthesize_*.py`、`app/main.py`、`app/engine/wkfl_pipeline.py`。dotenvによる全体ロード |
| ニュース要約 | `ANTHROPIC_API_KEY`。WKFL `.env`を個別パース | `app/engine/list_today_news.py`: 既存環境変数をファイル値で上書きするため、他の読み込み順とも不統一 |
| 画像生成 | `FAL_KEY` または `~/.secrets/fal-token` | `tools/image_fal.py`: 用途別・ホーム参照で規約に近い |
| 定期実行 | GitHub Secretsの`OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | `.github/workflows/daily_wkfl_briefing.yml`: クラウドの別保管場所。今回変更しない |
| Render旧Web | `ANTHROPIC_API_KEY`、`sync:false` | `render.yaml`: 設定のみ確認。稼働・資格情報の有効性は未確認 |

## 新Labの方式（実装済み）

`lib/credentials.mjs` がGoogleの呼び出し時だけ解決する。ページ表示では参照方式だけ返し、ファイル内容は読まない。モックは資格情報を一切読まない。

1. 明示的な `GEMINI_API_KEY_FILE`（絶対パス）
2. プロセスの `GEMINI_API_KEY`（CIや一時的な実行環境の互換性）
3. `~/.secrets/gemini-token`（統一先候補。今回作成していない）
4. 移行前互換としてWKFLの `tts-studio/.env` → `.env` から **GEMINI_API_KEYだけ**を取り出す

明示パスが無効なら他のキーへ黙って切り替えず失敗する。既存ファイル内の他社キーをprocess.envへ注入せず、別プロジェクトのキーを探さない。新Lab内の `.env` はロードしない。`.env.example` は秘密なしの説明だけ。

画面の `legacy-env-candidate` はファイルが存在するという意味で、Googleキーの存在・有効性を保証しない。

## 別途確認が必要な変更（未実行）

1. **移行元と用途の確定**: WKFLで現在使うGoogle／OpenAI／Anthropicキーの所有プロジェクト・課金先を人間が確認。値はチャットに貼らない。
2. **保存先の選択**: WKFL専用キーなら `~/.secrets/wkfl/<service>-token` の用途別配置＋`*_API_KEY_FILE`指定が候補。全プロジェクト共用と確認されたキーだけ `~/.secrets/<service>-token`。別用途のキーを統合しない。
3. **承認後の資格情報移行**: 選ばれたキーだけを指定先へ安全に移動し権限600を設定。秘密値コピー、新しい永続設定、権限変更は今回は実行していない。
4. **既存ローダーの段階更新**: TTS StudioとPython記事生成にも同じ「明示パス→環境変数→ホーム→移行前fallback」を適用。必要なベンダーだけ参照する。変更後は仮キーの単体検証、実APIは人間による限定試験。
5. **切り替え確認後に旧保存を整理**: 旧 `.env` の該当キー削除・キーの失効／再発行・ホーム規約への台帳追記は対象と影響を確認して別途実施。GitHub Secrets／Renderは独立して扱う。

現時点では既存WKFLのローダーも秘密ファイルも変更していないので、旧機能の資格情報参照は維持される。新Labだけは用途別参照が使える状態。全体正規化の完了とは扱わない。
