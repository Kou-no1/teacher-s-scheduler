# 継続開発

- 正本は `index.html`。単一HTML・React 18・Babel standaloneの構成を維持する。
- 現行データ契約は `docs/architecture-v4.md`、`docs/architecture-v3.md`、`docs/architecture-v2.md` を先に読む。v1設計書は履歴。
- `weeklyPlan_v1` / `weeklyPlan_v2` / `weeklyPlan_v3` の原本を勝手に消さない。未対応版・破損データは保存を停止する。
- 学級の週案・時数は学級IDで分離する。専科の標準は学級ごとの担当教科のみ。
- 振替は中止記録を残し、最新状態で候補の占有を再検証する。コピーで振替参照を複製しない。
- 予定と実施を区別する。日付が過ぎた計画を実施済みにしない。
- 年度の境界は各コマの日付で判定する。コピーで実施状態を複製しない。
- 生活・外国語活動・外国語・学級活動を区別する。行事は学活に自動加算しない。
- 単元比較はIDで行う。出版社別のExcel変換は `parseCurriculumRows` の手前に追加する。
- GAS配信HTMLは `node scripts/build-gas.mjs` で生成する。生成物を手編集しない。
- 通常は端末内。Google行事同期はID・日付・名称のみ。任意Drive同期は明示的に有効化した利用者本人へ、私的項目除外を既定にする。Excel原本を送らない。競合revisionを照合する。
- 実データのJSON、児童情報、OAuthトークン、`.clasp.json` をコミットしない。
- 変更後は `node scripts/verify-core.mjs` と利用可能な環境で `node scripts/verify-browser.mjs` / `node scripts/verify-v4-browser.mjs` を実行する。
- GAS本番認可や採用出版社の実ファイルを検証していないときは、その限界を報告する。
