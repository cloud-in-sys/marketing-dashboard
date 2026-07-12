# @dashboard/shared

frontend / backend で共有する型・定数・純粋ロジックの置き場 (将来用の箱)。

現時点では中身は空。TypeScript 化のタイミングで、両者に重複している定義
(例: `PERM_GROUPS` / メトリクス DSL の型 / API リクエスト・レスポンス型) を
ここへ寄せて一元管理する想定。

- 今はまだ既存ロジックを移していない (frontend/ と backend/ に残したまま)。
- TS 化・ビルド設定は未着手。
