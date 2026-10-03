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
// TODO(第3層): Drive/Sheetsへの本人別保存。保存revisionを照合し、児童メモの同期は別設定にする。
