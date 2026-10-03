# 継続開発

- 正本は `index.html`。単一HTML・React 18・Babel standaloneの構成を維持する。
- 現行データ契約と実装済み範囲は `docs/architecture-v2.md` を先に読む。v1設計書は履歴。
- `weeklyPlan_v1` の原本を勝手に消さない。未対応版・破損データは保存を停止する。
- 予定と実施を区別する。日付が過ぎた計画を実施済みにしない。
- 年度の境界は各コマの日付で判定する。コピーで実施状態を複製しない。
- 生活・外国語活動・外国語・学級活動を区別する。行事は学活に自動加算しない。
- 単元比較はIDで行う。出版社別のExcel変換は `parseCurriculumRows` の手前に追加する。
- GAS配信HTMLは `node scripts/build-gas.mjs` で生成する。生成物を手編集しない。
- Googleへ送信するのは、利用者が明示した行事同期のID・日付・名称のみ。メモやExcel原本を送信しない。
- 実データのJSON、児童情報、OAuthトークン、`.clasp.json` をコミットしない。
- 変更後は `node scripts/verify-core.mjs` と利用可能な環境で `node scripts/verify-browser.mjs` を実行する。
- GAS本番認可や採用出版社の実ファイルを検証していないときは、その限界を報告する。
