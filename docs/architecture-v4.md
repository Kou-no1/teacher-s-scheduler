# v4 詳細設計: 日常操作・学校暦・年間計画・Excel・任意クラウド

正本は単一HTML `index.html`。v2/v3の時数、学級分離、振替参照を継承する。
今回の範囲は前回提示した全拡張。外部アカウントの認可・本番GAS配信、学校指定の実Excelの検証は環境依存として分ける。

## 保存と互換性

`weeklyPlan_v4` に保存。v4→v3→v2→v1の順に原本を読み、旧キーは消さない。破損した最上位キーを飛ばさない。

```ts
type PlanV4 = Omit<PlanV3, 'version'> & {
  version: 4;
  templates: Array<{ id:string; name:string; grade:number;
    days: Record<'0'|'1'|'2'|'3'|'4', {gyozen:{text:string};periods:Record<string,LessonV4|null>}> }>;
  schoolCalendar: {
    confirmed:boolean; weeklyPeriods:number[]; // 月〜金、0..6
    periodTimes:Array<{start:string;end:string}>; // 6限の校時
    closedRanges:Array<{id:string;title:string;startDate:string;endDate:string;grade:number|null}>;
    overrides:Array<{id:string;date:string;grade:number|null;periods:string[];minutes:number}>;
  };
  rooms:Array<{id:string;name:string;building:string;floor:string}>;
  travelRules:Array<{fromId:string;toId:string;minutes:number}>;
  exportProfiles:Array<{id:string;name:string;kind:'week'|'hours';sheetName:string;settings:object}>;
};
type ClassV4 = ClassV3 & {defaultRoomId:string|null;forecastTemplateId:string|null};
type LessonV4 = LessonV3 & {roomId:string|null;reflection:{achievement:'none'|'met'|'partial'|'retry';observations:string;nextSteps:string}};
type CurriculumUnitV4 = CurriculumUnitV3 & {researchNote:string};
```

既存のコマは教室未指定・振り返り未記録で移行する。テンプレートは実施状態・理由・授業ID・振替参照・振り返りをリセットし、日付を含まない。単元名や持ち物を残す/配置だけにするを保存時に選べる。

## 操作履歴・一括実施

全学級と関連データを一つのトランザクションとしてUndo/Redoする。履歴はメモリのみ、最大30操作/20MiB目安。業前などの連続文字入力は700ms以内をまとめる。画面・学級・表示年度の切替は履歴に数えない。JSON復元・クラウド取込は1操作。

振替の確定、テンプレ適用、週コピー、一括実施は全体を一度に戻す。新しい変更でRedoを消す。Ctrl/Cmd+Z、Shift+Z/Yは入力欄外だけアプリの履歴を操作する。入力欄内はブラウザの文字編集Undoを優先する。

一括実施は日付・学級範囲を選び、授業をチェックして確認後に更新する。未来・中止・実施済み・学校暦より長い分数の計画は対象外。授業IDと最新状態を確定時にも照合する。校時や行事による中止は勝手に実施にしない。短縮日の振替候補は元授業と受入校時の短い方の分数を示し、計画として登録する。

## テンプレート

週案から通常週/行事週/短縮週など任意名で保存。配置だけ/単元と持ち物も保存、空き枠だけ/週全体を置換を選ぶ。別学年に適用しない。振替済みの中止履歴を上書きしない。教室・教科参照を検証。短縮日は学校暦側で管理し、テンプレ適用自体では校時を変更しない。

## 学校暦と不足予測

曜日別の授業限数、長期休業の期間、日付・学年別の使用可能限と授業分数、校時を設定。休業期間/休業行事は0枠。短縮日と明示的な行事対象限を優先する。振替候補も同じ学校暦判定を利用する。

不足予測は確認済み学校暦と学級に指定した予測テンプレートが前提。今日までの実施＋明日以降の明示計画＋空き枠にテンプレを繰り返した見込みを教科ごとに比較。中止を補充しない。校時で塞がる予定・専科の同時刻重複は警告/除外し、確実な実施とは扱わない。1単位時間45分。学校暦が未確認なら予測は未確定表示。標準は年度全体の比較基準であり法的な適否を判定しない。

## 教室・移動

教室マスター、学級の既定教室、コマごとの教室、教室間の所要分数。担当時間割と別の教室/移動一覧で同時刻の教室重複を表示する。連続する限の移動は確認済み校時の休み時間と指定した所要分数を比較。所要未設定や校時未確認はその状態を示し、架空の距離を推定しない。他教員の予約は入力されていない限り検知できない。

## 年間進度・振り返り

同学年の単元を4〜3月のタイムラインで表示し、各担当学級の単元別実施/配当を比較。未紐付けコマは比較に加算しない。コマ編集に本時の達成・観察・次回の改善を追加。振り返り画面は過年度/教科/単元検索に対応。単元に紐づいた振り返りを教材研究メモへ明示的に追記し、翌年度の授業準備で過年度記録を参照できる。

## Excel

行事の既存縦型列マッピングを保持。横型年間行事表は月ごとに月/日列/行事列のブロックを指定し、行範囲を一括解析する。月は4〜12月が選択年度、1〜3月が翌年。結合セルは明示された結合範囲だけ補完。無効日付・空欄・対象外年度を除外理由つきで表示する。学校独自レイアウトの自動推定はしない。

週案と時数をxlsxに出力。学校のxlsx原本を端末内で読み、シート・開始セル・行列の間隔・メタデータセルを指定して新しいファイルへ差し込む。マッピング設定を保存して再利用。元ファイルは変更しない。既存の数式や結合セルを壊す差し込み位置は確定前に検証する。SheetJSで保持できない高度な装飾/図形/マクロは再現を保証しない。実様式の添付後に検証する。

## 任意GAS同期とバックアップ

通常は端末内。GAS版で利用者がクラウド保存を有効にした場合だけ、自分のDriveのアプリ作成ファイルへ送る。初期設定は個人メモ/振り返り/教材研究メモ/タスクを除外。送信範囲を画面で示し、含める設定を別確認する。別端末からの取込は同期前原本を端末に退避し、同じ授業IDの私的メモを保持する。

`getCloudStatus` / `loadCloudPlan` / `saveCloudPlan` / `listCloudBackups` / `loadCloudBackup` を `google.script.run` から呼ぶ。保存はユーザーロック内でrevisionを照合し、競合は拒否。初回の既存クラウド上書きは明示確認。利用者のUserPropertiesでファイルIDを管理し、クライアントから任意ファイルIDを受け取らない。古い内容のバックアップを更新前に保存する。バックアップ失敗時は更新しない。

自動バックアップはその端末で明示的に有効化したGAS画面を開いている間、変更後にまとめて保存。失敗/競合/保存不能時は停止して通知する。画面を閉じた間の未送信データをGASが読み出すことはできない。共有設定は変更しない。本番公開は利用者として実行する。

Drive advanced service v3と `drive.file` を使用する。JSONメディア取得はサーバーの固定Drive API URLへUrlFetchするため `script.external_request` も必要。校内アカウントの認可・API利用可否は管理設定に依存する。公式資料: [Advanced Drive](https://developers.google.com/apps-script/advanced/drive)、[ファイルの取得](https://developers.google.com/workspace/drive/api/guides/manage-downloads)、[LockService](https://developers.google.com/apps-script/reference/lock/lock-service)、[GAS Web Apps](https://developers.google.com/apps-script/guides/web)。

## 検証

v1〜v4原本保持、全体Undo、文字入力の集約、テンプレの履歴リセット/参照、未来一括実施拒否、休業/短縮/教科別不足、教室重複/移動分数、過年度振り返り、横型Excel/無効日付/1904日付、xlsx差込/結合セル/式、クラウド匿名化ではなく明示的な私的項目除外、利用者分離/revision競合/失敗後再送/バックアップ復元を検証。PC/スマホ/印刷/公開起動も確認する。
