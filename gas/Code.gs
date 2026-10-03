function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('週案エディタ')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}

// 利用者として実行する。クライアントから週案・児童メモは受け取らない。
function syncSchoolEvents(payload) {
  const events = validateEventBatch_(payload);
  const lock = LockService.getUserLock();
  if (!lock.tryLock(10000)) throw new Error('同期処理中です。少し待って再実行してください');
  try {
    const calendar = CalendarApp.getCalendarById(payload.calendarId.trim());
    if (!calendar) throw new Error('カレンダーが見つかりません。IDと編集権限を確認してください');
    const dates = events.map(e => e.date).sort();
    const end = dateInJapan_(dates[dates.length - 1]);
    end.setDate(end.getDate() + 1);
    const existing = new Map();
    calendar.getEvents(dateInJapan_(dates[0]), end).forEach(event => {
      const marker = event.getDescription().match(/^weekly-planner:v2:([a-f0-9]{64})$/m);
      const id = event.getTag('weeklyPlannerId') || (marker && marker[1]);
      if (id) existing.set(id, event);
    });
    let created = 0;
    let updated = 0;
    events.forEach(row => {
      const id = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, row.id, Utilities.Charset.UTF_8)
        .map(b => (b & 255).toString(16).padStart(2, '0')).join('');
      const date = dateInJapan_(row.date);
      let event = existing.get(id);
      if (event) {
        event.setTitle(row.title);
        event.setAllDayDate(date);
        updated++;
      } else {
        // 作成と同時に再送識別子を記録。setTag失敗後の再実行でも重複作成を避ける。
        event = calendar.createAllDayEvent(row.title, date, { description: 'weekly-planner:v2:' + id });
        existing.set(id, event);
        created++;
      }
      event.setTag('weeklyPlannerId', id);
    });
    return { created, updated };
  } finally {
    lock.releaseLock();
  }
}

function dateInJapan_(date) {
  return new Date(date + 'T00:00:00+09:00');
}

function validateEventBatch_(payload) {
  if (!payload || typeof payload.calendarId !== 'string' || !payload.calendarId.trim()) {
    throw new Error('同期先カレンダーIDが必要です');
  }
  if (!Array.isArray(payload.events) || payload.events.length < 1 || payload.events.length > 25) {
    throw new Error('1回の同期は1〜25件です');
  }
  const seen = new Set();
  return payload.events.map(row => {
    if (!row || typeof row.id !== 'string' || !row.id || row.id.length > 5000 ||
        typeof row.title !== 'string' || !row.title.trim() || row.title.length > 500 ||
        typeof row.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) {
      throw new Error('行事データの形式が不正です');
    }
    const date = dateInJapan_(row.date);
    const year = Number(row.date.slice(0, 4));
    if (year < 1900 || year > 2200 || !Number.isFinite(date.getTime()) ||
        Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy-MM-dd') !== row.date) {
      throw new Error('実在する行事日付を指定してください');
    }
    if (seen.has(row.id)) throw new Error('同じ行事IDが重複しています');
    seen.add(row.id);
    return { id: row.id, title: row.title.trim(), date: row.date };
  });
}

// TODO(第3層): 更新済み行事の移動・削除を含む双方向同期は、競合ルールと履歴を加えて実装する。
// DriveのファイルIDは利用者別のサーバー設定で管理し、クライアントの任意IDを受け取らない。
const CLOUD_FILE_KEY_ = 'weeklyPlannerFileV4';
const CLOUD_BACKUP_KEY_ = 'weeklyPlannerBackupsV4';
const CLOUD_LIMIT_ = 4 * 1024 * 1024;

function getCloudStatus() {
  return withCloudLock_(function () {
    const current = readCloudHead_();
    return { exists: !!current, revision: current ? current.revision : 0, updatedAt: current ? current.updatedAt : null };
  });
}
function loadCloudPlan() {
  return withCloudLock_(function () {
    const current = readCloudHead_();
    return current ? Object.assign({ exists: true, headRevision: current.revision }, current) : { exists: false, revision: 0 };
  });
}
function saveCloudPlan(payload) {
  if (!payload || !Number.isInteger(payload.baseRevision) || payload.baseRevision < 0 || typeof payload.includePrivate !== 'boolean' || typeof payload.planText !== 'string') throw new Error('保存リクエストの形式が不正です');
  if (Utilities.newBlob(payload.planText).getBytes().length > CLOUD_LIMIT_) throw new Error('Drive保存は4MB以内です。JSONを端末へバックアップしてください');
  const plan = validateCloudPlan_(payload.planText, payload.includePrivate);
  return withCloudLock_(function () {
    const properties = PropertiesService.getUserProperties();
    const current = readCloudHead_();
    const revision = current ? current.revision : 0;
    if (payload.baseRevision !== revision) throw new Error('保存競合: 別端末の変更があります。JSONをバックアップしてからDriveの最新内容を確認してください');
    let backups = readBackupRegistry_();
    const now = new Date().toISOString();
    if (current) {
      // バックアップに失敗したら本体更新を行わない。履歴はアプリが作ったIDだけを扱う。
      const backup = Drive.Files.create({ name: '週案バックアップ-r' + revision + '.json', mimeType: 'application/json' }, cloudBlob_(current), { fields: 'id' });
      backups.unshift({ id: backup.id, revision: revision, updatedAt: current.updatedAt, includePrivate: current.includePrivate });
      properties.setProperty(CLOUD_BACKUP_KEY_, JSON.stringify(backups));
    }
    const envelope = { revision: revision + 1, updatedAt: now, includePrivate: payload.includePrivate, plan: plan };
    const fileId = properties.getProperty(CLOUD_FILE_KEY_);
    if (fileId) Drive.Files.update({ name: '週案エディタ-v4.json' }, fileId, cloudBlob_(envelope), { fields: 'id' });
    else {
      const file = Drive.Files.create({ name: '週案エディタ-v4.json', mimeType: 'application/json' }, cloudBlob_(envelope), { fields: 'id' });
      properties.setProperty(CLOUD_FILE_KEY_, file.id);
    }
    // 世代削除は更新後。失敗した世代は登録を残し、次回再試行する。
    const retained = backups.slice(0, 10);
    backups.slice(10).forEach(function (entry) {
      try { Drive.Files.update({ trashed: true }, entry.id, null, { fields: 'id' }); }
      catch (error) { retained.push(entry); }
    });
    properties.setProperty(CLOUD_BACKUP_KEY_, JSON.stringify(retained));
    return { revision: envelope.revision, updatedAt: now };
  });
}
function listCloudBackups() {
  return withCloudLock_(function () { return readBackupRegistry_(); });
}
function loadCloudBackup(payload) {
  return withCloudLock_(function () {
    const entry = payload && readBackupRegistry_().find(function (row) { return row.id === payload.backupId; });
    if (!entry) throw new Error('この利用者のバックアップではありません');
    const current = readCloudHead_();
    if (!current) throw new Error('現在のDrive保存がありません');
    return Object.assign({ exists: true, headRevision: current.revision }, readCloudFile_(entry.id));
  });
}
function withCloudLock_(fn) {
  const lock = LockService.getUserLock();
  if (!lock.tryLock(10000)) throw new Error('保存処理中です。少し待ってください');
  try { return fn(); } finally { lock.releaseLock(); }
}
function cloudBlob_(data) { return Utilities.newBlob(JSON.stringify(data), 'application/json', 'weekly-plan.json'); }
function readBackupRegistry_() {
  const raw = PropertiesService.getUserProperties().getProperty(CLOUD_BACKUP_KEY_);
  const rows = raw ? parseCloudJson_(raw) : [];
  if (!Array.isArray(rows)) throw new Error('バックアップ管理情報が不正です');
  return rows;
}
function readCloudHead_() {
  const id = PropertiesService.getUserProperties().getProperty(CLOUD_FILE_KEY_);
  return id ? readCloudFile_(id) : null;
}
function readCloudFile_(id) {
  const response = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) + '?alt=media', {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) throw new Error('Driveファイルを読めません。削除・権限・API設定を確認してください');
  const raw = response.getContentText('UTF-8');
  if (Utilities.newBlob(raw).getBytes().length > CLOUD_LIMIT_ + 2048) throw new Error('Driveファイルが大きすぎます');
  const envelope = parseCloudJson_(raw);
  if (!envelope || !Number.isInteger(envelope.revision) || envelope.revision < 1 || typeof envelope.updatedAt !== 'string' || typeof envelope.includePrivate !== 'boolean') throw new Error('Drive保存の形式が不正です');
  validateCloudPlan_(JSON.stringify(envelope.plan), envelope.includePrivate);
  return envelope;
}
function validateCloudPlan_(text, includePrivate) {
  const plan = parseCloudJson_(text);
  const record = function (v) { return v && typeof v === 'object' && !Array.isArray(v); };
  if (!record(plan) || plan.version !== 4 || !record(plan.meta) || !record(plan.classPlans) || !record(plan.events) || !record(plan.schoolCalendar) || !record(plan.preparations) || !['classes','subjects','tasks','curriculum','rooms','templates','travelRules','exportProfiles'].every(function (key) { return Array.isArray(plan[key]); })) throw new Error('v4週案の形式が不正です');
  const clearSlot = function (slot) { if (slot) { slot.memo = ''; slot.reflection = { achievement: 'none', observations: '', nextSteps: '' }; } };
  Object.values(plan.classPlans).forEach(function (cp) {
    if (!record(cp) || !record(cp.weeks)) throw new Error('学級週案の形式が不正です');
    Object.values(cp.weeks).forEach(function (week) {
      if (!record(week) || !record(week.days)) throw new Error('週案の形式が不正です');
      Object.values(week.days).forEach(function (day) {
        if (!record(day) || !record(day.periods)) throw new Error('コマの形式が不正です');
        if (!includePrivate) Object.values(day.periods).forEach(clearSlot);
      });
    });
  });
  if (!includePrivate) {
    plan.tasks = [];
    plan.curriculum.forEach(function (p) { if (!Array.isArray(p.units)) throw new Error('指導計画の形式が不正です');p.units.forEach(function (u) { u.researchNote = ''; }); });
    plan.templates.forEach(function (t) { if (!record(t.days)) throw new Error('テンプレートの形式が不正です');Object.values(t.days).forEach(function (d) { if (!record(d.periods)) throw new Error('テンプレートの形式が不正です');Object.values(d.periods).forEach(clearSlot); }); });
  }
  return plan;
}
function parseCloudJson_(text) {
  try { return JSON.parse(text); }
  catch (error) { throw new Error('保存JSONの形式が不正です'); }
}
