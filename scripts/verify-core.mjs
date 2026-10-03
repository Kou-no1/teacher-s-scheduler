import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { test } from 'node:test';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const section = (start, end) => html.slice(html.indexOf(start), html.indexOf(end));
const source = section('const DEFAULT_SUBJECTS=', 'function HourCounterPanel(') +
  section('function parseExcelDate(', 'function Modal(') +
  section('function buildICS(', 'function EventEditor(') +
  section('function calculateCurriculumProgress(', 'function ResourceEditor(');
const api = vm.runInNewContext(source + '\n({STANDARD_HOURS,createInitialState,createLegacyInitialState,normalizePlan,calculateHourSummary,parseExcelDate,parseEventRows,parseCurriculumRows,mergeEvents,stableId,safeUrl,buildICS,calculateCurriculumProgress,listLessons,getLesson,assignedLessons,teacherConflicts,rescheduleCandidates,rescheduleLesson,replaceLesson,copyClassWeek,preparationList,hourReportRows,encodeCSV})', { Date, URL, TextEncoder, globalThis: {} });
const plain = value => JSON.parse(JSON.stringify(value));
const state = () => plain(api.createLegacyInitialState());
const stateV3 = () => { const p = plain(api.createInitialState()); p.meta.schoolYear = 2026; p.classes[0].schoolYear = 2026; return p; };
const slot = (subjectId, status = 'planned', minutes = 45, curriculumUnitId = null) => ({ subjectId, status, minutes, curriculumUnitId, unit: '', sub: '', items: '', memo: '' });
const week = (key, days, grade = 5) => ({ weekStart: key, grade, days: Object.fromEntries(Object.entries(days).map(([date, periods]) => [date, { gyozen: { text: '' }, periods }])) });

test('all six standard totals include life and distinct foreign activities', () => {
  assert.deepEqual(Object.values(api.STANDARD_HOURS).map(g => Object.values(g).reduce((a, b) => a + b, 0)), [850, 910, 980, 1015, 1015, 1015]);
  assert.ok(api.createInitialState().subjects.some(s => s.id === 'seikatsu'));
  assert.equal(api.STANDARD_HOURS[3].gaikoku, undefined);
  assert.equal(api.STANDARD_HOURS[3].gaikoku_katsudo, 35);
});

test('v1 object subject map migrates without losing lessons or notes', () => {
  const old = { ...state(), version: 1, subjects: { kokugo: { name: '国語' } }, meta: { grade: 3, schoolYear: 2026 } };
  old.weeks = { '2026-04-06': week('2026-04-06', { '2026-04-06': { 1: { subjectId: 'gaikoku', memo: '原本メモ' } } }, undefined) };
  delete old.weeks['2026-04-06'].grade;
  const migrated = api.normalizePlan(old);
  const weeks = migrated.classPlans[migrated.activeClassId].weeks;
  const s = weeks['2026-04-06'].days['2026-04-06'].periods['1'];
  assert.equal(s.subjectId, 'gaikoku_katsudo');
  assert.equal(s.memo, '原本メモ');
  assert.equal(s.status, 'planned');
  assert.equal(weeks['2026-04-06'].grade, 3);
});

test('unsupported or invalid plans fail rather than being overwritten', () => {
  assert.throws(() => api.normalizePlan({ version: 9 }));
  assert.throws(() => api.normalizePlan({ ...state(), events: { '2026-02-30': [] } }));
  assert.throws(() => api.normalizePlan({ ...state(), tasks: {} }));
});
test('null, false, zero and empty storage are invalid, not a missing plan', () => {
  for (const raw of ['null', 'false', '0', '']) {
    const result = vm.runInNewContext(source + '\nloadPlan()', { Date, URL, TextEncoder, globalThis: {}, localStorage: { getItem: key => key === 'weeklyPlan_v3' ? raw : null } });
    assert.equal(result.blocked, true);
  }
});

test('year boundary, grade, cancelled, future and fractional lessons are accounted separately', () => {
  const p = state();
  p.weeks = {
    '2026-03-30': week('2026-03-30', { '2026-03-31': { 1: slot('sansu', 'done') }, '2026-04-01': { 1: slot('sansu', 'done', 30) } }),
    '2026-09-28': week('2026-09-28', { '2026-09-28': { 1: slot('sansu', 'done'), 2: slot('sansu', 'planned'), 3: slot('sansu', 'cancelled') } }),
    '2026-10-05': week('2026-10-05', { '2026-10-05': { 1: slot('sansu', 'done') } }),
    '2026-06-01': week('2026-06-01', { '2026-06-01': { 1: slot('sansu', 'done') } }, 4)
  };
  const result = api.calculateHourSummary({ ...p, grade: 5, schoolYear: 2026, asOf: '2026-10-03', todayKey: '2026-10-03' }).find(r => r.subject.id === 'sansu');
  assert.ok(Math.abs(result.actual - 5 / 3) < 1e-9);
  assert.ok(Math.abs(result.planned - 11 / 3) < 1e-9);
  const earlier = api.calculateHourSummary({ ...p, grade: 5, schoolYear: 2026, asOf: '2026-04-30', todayKey: '2026-10-03' }).find(r => r.subject.id === 'sansu');
  assert.ok(Math.abs(earlier.actual - 2 / 3) < 1e-9);
});

test('standard totals survive incomplete subject masters and unknown IDs remain visible', () => {
  const p = state();
  p.weeks = { '2026-09-28': week('2026-09-28', { '2026-09-28': { 1: slot('custom', 'done') } }, 1) };
  const summary = api.calculateHourSummary({ ...p, subjects: [], grade: 1, schoolYear: 2026, todayKey: '2026-10-03' });
  assert.equal(summary.reduce((n, r) => n + (r.standard || 0), 0), 850);
  assert.equal(summary.find(r => r.subject.id === 'custom').standard, null);
});

test('school-year date parsing is strict and never guesses an ambiguous year', () => {
  assert.equal(api.parseExcelDate('1/8', 2026), '2027-01-08');
  assert.equal(api.parseExcelDate('４月８日(水)', 2026), '2026-04-08');
  assert.equal(api.parseExcelDate('2026/2/30', 2026), null);
  assert.equal(api.parseExcelDate('2026-04-08 trailing', 2026), null);
  assert.equal(api.parseExcelDate('令和8年4月8日', 2026), null);
  assert.equal(api.parseExcelDate(60, 2026, false), null);
  let flag;
  const fake = { SSF: { parse_date_code: (value, options) => { flag = options.date1904; return { y: 2026, m: 4, d: 8 }; } } };
  assert.equal(api.parseExcelDate(45000, 2026, true, fake), '2026-04-08');
  assert.equal(flag, true);
});

test('event re-import deduplicates and replacing one year preserves other years', () => {
  const preview = api.parseEventRows({ rows: [['日付', '行事'], ['4/8', '始業式'], ['2/30', '不正'], ['2025-04-08', '過年度']], start: 1, end: 3, dateCol: 0, titleCol: 1, dateMode: 'date', year: 2026, type: 'school', source: 'test.xlsx' });
  assert.equal(preview.valid.length, 1);
  assert.equal(preview.rejected.length, 2);
  const initial = { '2025-04-08': [{ id: 'old', title: '旧行事', type: 'school' }] };
  const once = api.mergeEvents(initial, preview.valid, 'merge', 2026);
  const twice = api.mergeEvents(once, preview.valid, 'merge', 2026);
  assert.equal(twice['2026-04-08'].length, 1);
  assert.equal(api.mergeEvents(twice, [], 'replace', 2026)['2025-04-08'][0].title, '旧行事');
});

test('curriculum merged names and month are filled, but hours are never propagated', () => {
  const result = api.parseCurriculumRows({ rows: [['月', '単元', '時数'], [4, '小数', 3], [null, null, 2], [null, null, null], [4, '合計', 5]], merges: [{ s: { r: 1, c: 0 }, e: { r: 3, c: 0 } }, { s: { r: 1, c: 1 }, e: { r: 3, c: 1 } }], start: 1, end: 4, titleCol: 1, hoursCol: 2, monthCol: 0, planId: 'p' });
  assert.equal(result.valid.length, 2);
  assert.equal(result.valid[1].month, 4);
  assert.notEqual(result.valid[0].id, result.valid[1].id);
  assert.equal(result.rejected.length, 1);
});

test('unit progress uses IDs, exposes unlinked lessons and excludes undated units from pace', () => {
  const plan = { schoolYear: 2026, units: [{ id: 'u1', title: '小数', plannedHours: 4, month: 4 }, { id: 'u2', title: '小数', plannedHours: 3, month: 1 }, { id: 'u3', title: '予備', plannedHours: 2, month: null }] };
  const lessons = [{ ...slot('sansu', 'done', 45, 'u1'), date: '2026-04-08', hours: 1 }, { ...slot('sansu', 'done', 45, 'unknown'), date: '2026-04-09', hours: 1 }, { ...slot('sansu', 'done', 45, 'u3'), date: '2026-04-10', hours: 1 }];
  const result = api.calculateCurriculumProgress(plan, lessons, '2026-04-30', '2026-10-03');
  assert.equal(result.rows[0].actual, 1);
  assert.equal(result.rows[1].actual, 0);
  assert.equal(result.unlinked, 1);
  assert.equal(result.target, 4);
  assert.equal(result.datedActual, 1);
  assert.equal(result.undated, 1);
});

test('resource URLs reject executable schemes', () => {
  assert.equal(api.safeUrl('javascript:alert(1)'), null);
  assert.equal(api.safeUrl('data:text/html,bad'), null);
  assert.equal(api.safeUrl('https://example.org/material'), 'https://example.org/material');
});

test('additional subject IDs do not inherit object prototype standard hours', () => {
  const p = state();
  p.weeks = { '2026-09-28': week('2026-09-28', { '2026-09-28': { 1: slot('constructor', 'done') } }) };
  const row = api.calculateHourSummary({ ...p, grade: 5, schoolYear: 2026, asOf: '2026-10-03', todayKey: '2026-10-03' }).find(r => r.subject.id === 'constructor');
  assert.equal(row.standard, null);
  assert.equal(row.actual, 1);
});

test('ICS uses exclusive next day and UTF-8-safe folded lines', () => {
  const text = api.buildICS({ '2026-12-31': [{ id: 'e1', title: '長い行事名'.repeat(40) + ',;\n終わり' }] }, 2026, new Date('2026-10-03T00:00:00Z'));
  assert.match(text, /DTEND;VALUE=DATE:20270101/);
  assert.ok(text.split('\r\n').every(line => Buffer.byteLength(line) <= 75));
  assert.match(text.replace(/\r\n /g, ''), /\\,\\;\\n終わり/);
});

function specialistState() {
  const p = stateV3(), a = p.classes[0];
  p.meta.role = 'specialist'; a.subjectIds = ['ongaku'];
  const b = { ...a, id: 'class-b', grade: 6, className: '2' };
  p.classes.push(b); p.classPlans[b.id] = { weeks: {} };
  return p;
}
function put(p, classId, date, period, data) {
  p.classPlans = plain(api.replaceLesson(p, { classId, date, period }, data));
  return { classId, date, period, lessonId: api.getLesson(p.classPlans, { classId, date, period }).lessonId };
}
test('v2 migration splits fiscal boundaries and historic grades without dropping notes', () => {
  const old = state(); old.meta = { grade: 5, schoolYear: 2026, className: '1', teacherName: '' };
  old.weeks = {
    '2026-03-30': week('2026-03-30', { '2026-03-31': { 1: { ...slot('sansu', 'done'), memo: 'old' } }, '2026-04-01': { 1: slot('sansu', 'done') } }),
    '2026-05-04': week('2026-05-04', { '2026-05-04': { 1: slot('rika', 'done') } }, 4)
  };
  const p = plain(api.normalizePlan(old));
  assert.equal(p.version, 3); assert.equal(p.classes.length, 3);
  assert.equal(api.assignedLessons(p, 2026).length, 2);
  assert.equal(api.assignedLessons(p, 2025)[0].memo, 'old');
  assert.deepEqual(plain(api.normalizePlan(p)), p);
});
test('classes isolate actuals and specialist standards use assigned subjects only', () => {
  const p = specialistState(), [a, b] = p.classes;
  b.grade = 5; // Same grade and shared curriculum must still produce independent actuals.
  put(p, a.id, '2026-09-28', '1', slot('ongaku', 'done'));
  put(p, b.id, '2026-09-28', '1', slot('ongaku', 'planned'));
  put(p, a.id, '2026-09-28', '2', slot('sansu', 'done'));
  const summary = c => api.calculateHourSummary({ subjects: p.subjects, weeks: p.classPlans[c.id].weeks, grade: c.grade, schoolYear: 2026, subjectIds: c.subjectIds, asOf: '2026-10-03', todayKey: '2026-10-03' });
  assert.equal(summary(a).length, 1); assert.equal(summary(a)[0].standard, 50); assert.equal(summary(a)[0].actual, 1);
  assert.equal(summary(b)[0].actual, 0);
  assert.equal(api.assignedLessons(p).length, 2);
  assert.equal(api.teacherConflicts(p, '2026-09-28', '1').length, 2);
  assert.equal(api.normalizePlan(p).classes.length, 2);
});
test('v3 rejects duplicate classes, mismatched grade/year and damaged transfer references', () => {
  const p = specialistState(), a = p.classes[0];
  put(p, a.id, '2026-09-28', '1', slot('ongaku', 'done'));
  const bad = plain(p); bad.classes.push({ ...a, id: 'extra' }); assert.throws(() => api.normalizePlan(bad));
  const wrong = plain(p); wrong.classPlans[a.id].weeks['2026-09-28'].grade = 6; assert.throws(() => api.normalizePlan(wrong));
  const year = plain(p); year.classes[0].schoolYear = 2025; assert.throws(() => api.normalizePlan(year));
  const ref = plain(p); ref.classPlans[a.id].weeks['2026-09-28'].days['2026-09-28'].periods['1'].rescheduledFrom = { classId: a.id, date: '2026-09-29', period: '1', lessonId: 'missing' }; assert.throws(() => api.normalizePlan(ref));
});
test('reschedule candidates avoid holidays, scoped events, own cells and specialist clashes', () => {
  const p = specialistState(), [a, b] = p.classes;
  const origin = put(p, a.id, '2026-09-28', '1', slot('ongaku', 'cancelled'));
  put(p, b.id, '2026-10-05', '1', slot('ongaku'));
  put(p, a.id, '2026-10-05', '2', slot('ongaku', 'cancelled'));
  p.events = { '2026-10-05': [{ title: '集会', type: 'school', grade: 5, blockedPeriods: ['3'] }, { title: '他学年', type: 'gakunen', grade: 6, blockedPeriods: ['4'] }], '2026-10-06': [{ title: '休業', type: 'holiday' }] };
  const candidates = plain(api.rescheduleCandidates(p, origin, '2026-10-04', '2026-10-07', '2026-10-03'));
  assert.deepEqual(candidates.filter(c => c.date === '2026-10-05').map(c => c.period), ['4', '5', '6']);
  assert.equal(candidates.some(c => ['2026-10-04', '2026-10-06'].includes(c.date)), false);
  assert.equal(api.rescheduleCandidates(p, origin, '2026-10-03', '2026-10-07', '2026-10-03').length, 0);
  assert.equal(api.rescheduleCandidates(p, origin, '2026-10-04', '2026-11-04', '2026-10-03').length, 0);
  assert.equal(api.rescheduleCandidates(p, origin, '2027-03-30', '2027-04-02', '2026-10-03').length, 0);
});
test('reschedule keeps cancelled origin, resets actuals and prevents stale or duplicate commits', () => {
  const p = specialistState(), a = p.classes[0];
  const origin = put(p, a.id, '2026-09-28', '1', { ...slot('ongaku', 'cancelled', 30, 'unit-1'), unit: '歌', items: '楽譜', memo: 'keep', cancelReason: '集会' });
  const target = { classId: a.id, date: '2026-10-05', period: '2' };
  p.classPlans = plain(api.rescheduleLesson(p, origin, target, '2026-10-03'));
  const from = api.getLesson(p.classPlans, origin), to = api.getLesson(p.classPlans, target);
  assert.equal(from.status, 'cancelled'); assert.equal(to.status, 'planned'); assert.equal(to.memo, 'keep');
  assert.equal(to.curriculumUnitId, 'unit-1'); assert.notEqual(to.lessonId, from.lessonId);
  assert.equal(to.rescheduledFrom.lessonId, from.lessonId);
  assert.equal(api.normalizePlan(p).version, 3);
  assert.throws(() => api.rescheduleLesson(p, origin, { ...target, period: '3' }, '2026-10-03'));
  assert.throws(() => api.replaceLesson(p, origin, null));
  assert.throws(() => api.replaceLesson(p, origin, slot('ongaku', 'done')));
  const summary = api.calculateHourSummary({ subjects: p.subjects, weeks: p.classPlans[a.id].weeks, grade: 5, schoolYear: 2026, asOf: '2026-10-03', todayKey: '2026-10-03' }).find(r => r.subject.id === 'ongaku');
  assert.equal(summary.actual, 0); assert.ok(Math.abs(summary.planned - 2 / 3) < 1e-9);
  p.classPlans = plain(api.replaceLesson(p, target, null));
  assert.equal(api.getLesson(p.classPlans, origin).rescheduledTo, null);
  put(p, p.classes[1].id, target.date, target.period, slot('ongaku'));
  assert.throws(() => api.rescheduleLesson(p, origin, target, '2026-10-03'));
  assert.throws(() => api.rescheduleLesson(p, { ...origin, lessonId: 'stale' }, { ...target, period: '5' }, '2026-10-03'));
});
test('week copy resets IDs/status/reasons/links and refuses overwriting cancelled history', () => {
  const p = specialistState(), a = p.classes[0];
  const origin = put(p, a.id, '2026-09-28', '1', { ...slot('ongaku', 'cancelled'), cancelReason: '集会' });
  p.classPlans = plain(api.rescheduleLesson(p, origin, { classId: a.id, date: '2026-10-05', period: '2' }, '2026-10-03'));
  put(p, a.id, '2026-09-21', '1', slot('ongaku'));
  assert.throws(() => api.copyClassWeek(p, a.id, '2026-09-28'));
  p.classPlans = plain(api.copyClassWeek(p, a.id, '2026-10-12'));
  const copied = api.getLesson(p.classPlans, { classId: a.id, date: '2026-10-12', period: '2' });
  assert.equal(copied.status, 'planned'); assert.equal(copied.rescheduledFrom, null); assert.equal(copied.rescheduledTo, null); assert.equal(copied.cancelReason, '');
  assert.notEqual(copied.lessonId, api.getLesson(p.classPlans, { classId: a.id, date: '2026-10-05', period: '2' }).lessonId);
  // Overwrite a destination week safely unlinks the original.
  p.classPlans = plain(api.copyClassWeek(p, a.id, '2026-10-05'));
  assert.equal(api.getLesson(p.classPlans, origin).rescheduledTo, null);
  assert.equal(api.normalizePlan(p).version, 3);
});
test('preparation aggregates assigned classes and excludes cancelled lessons and private memos', () => {
  const p = specialistState(), [a, b] = p.classes;
  put(p, a.id, '2026-09-28', '1', { ...slot('ongaku'), items: '楽譜・ノート、楽譜', memo: '児童名を出さない' });
  put(p, b.id, '2026-09-29', '1', { ...slot('ongaku'), items: '楽譜' });
  put(p, a.id, '2026-09-30', '1', { ...slot('ongaku', 'cancelled'), items: '除外' });
  const rows = plain(api.preparationList(p, '2026-09-28', [a.id, b.id]));
  assert.equal(rows.length, 2); assert.equal(rows.find(r => r.item === '楽譜').uses.length, 2);
  assert.equal(JSON.stringify(rows).includes('児童名'), false);
  const key = rows.find(r => r.item === '楽譜').key;
  put(p, a.id, '2026-10-01', '1', { ...slot('ongaku'), items: '楽譜' });
  assert.notEqual(api.preparationList(p, '2026-09-28', [a.id, b.id]).find(r => r.item === '楽譜').key, key);
});
test('report uses class-specific annual standards and scoped period actuals with CSV formula defense', () => {
  const p = specialistState(), [a, b] = p.classes;
  a.className = '=HYPERLINK("bad")';
  put(p, a.id, '2026-09-28', '1', slot('ongaku', 'done', 30));
  put(p, a.id, '2026-10-01', '1', slot('ongaku', 'cancelled'));
  put(p, b.id, '2026-09-28', '1', slot('ongaku', 'done'));
  const options = { classIds: [a.id, b.id], startDate: '2026-10-01', endDate: '2026-10-31', asOf: '2026-10-03', todayKey: '2026-10-03' };
  const rows = plain(api.hourReportRows(p, options));
  assert.equal(rows.length, 2); assert.equal(rows[0][8], 50); assert.equal(rows[0][10], 0); assert.equal(rows[0][11], 1); assert.equal(rows[0][12], 0.67); assert.equal(rows[1][12], 1);
  const csv = api.encodeCSV(rows); assert.ok(csv.startsWith('\uFEFF')); assert.match(csv, /"'=HYPERLINK/); assert.match(csv, /\r\n/); assert.equal(csv.includes('memo'), false);
  assert.throws(() => api.hourReportRows(p, { ...options, endDate: '2026-09-30' }));
  assert.throws(() => api.hourReportRows(p, { ...options, asOf: '2026-10-04' }));
});
test('cancelled-only additional subjects are retained in reports without a standard', () => {
  const p = stateV3(), a = p.classes[0];
  p.subjects.push({ id: 'custom', name: '追加', color: '#123456', short: '追' });
  put(p, a.id, '2026-09-28', '1', slot('custom', 'cancelled'));
  const rows = api.hourReportRows(p, { classIds: [a.id], startDate: '2026-04-01', endDate: '2027-03-31', asOf: '2026-10-03', todayKey: '2026-10-03' });
  const row = rows.find(r => r[4] === '追加'); assert.equal(row[8], ''); assert.equal(row[11], 1);
});

const gas = await readFile(new URL('../gas/Code.gs', import.meta.url), 'utf8');
function gasHarness(failTagOnce = false) {
  const stored = [{ title: '他の予定', date: new Date('2026-04-08T00:00:00+09:00'), description: '', tags: {} }];
  let fail = failTagOnce;
  const wrap = row => ({
    getDescription: () => row.description, getTag: key => row.tags[key] || '',
    setTitle: title => { row.title = title; }, setAllDayDate: date => { row.date = date; },
    setTag: (key, value) => { if (fail) { fail = false; throw new Error('temporary tag error'); } row.tags[key] = value; }
  });
  const calendar = {
    getEvents: (start, end) => stored.filter(r => r.date >= start && r.date < end).map(wrap),
    createAllDayEvent: (title, date, options) => { const row = { title, date, description: options.description, tags: {} }; stored.push(row); return wrap(row); }
  };
  const context = {
    CalendarApp: { getCalendarById: () => calendar },
    LockService: { getUserLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (algorithm, text) => [...createHash(algorithm).update(text).digest()],
      formatDate: date => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
    }
  };
  const functions = vm.runInNewContext(gas + '\n({syncSchoolEvents,validateEventBatch_})', context);
  return { ...functions, stored };
}
const payload = { calendarId: 'test-calendar', events: [{ id: 'school-event', date: '2026-04-08', title: '始業式' }] };
test('GAS retry updates marked events and preserves unrelated events', () => {
  const h = gasHarness();
  assert.equal(h.syncSchoolEvents(payload).created, 1);
  assert.equal(h.syncSchoolEvents(payload).created, 0);
  assert.equal(h.stored.length, 2);
  assert.equal(h.stored[0].title, '他の予定');
});
test('GAS retry after partial tag failure finds the atomic description marker', () => {
  const h = gasHarness(true);
  assert.throws(() => h.syncSchoolEvents(payload), /temporary tag error/);
  assert.equal(h.syncSchoolEvents(payload).created, 0);
  assert.equal(h.stored.length, 2);
});
test('GAS rejects invalid dates and duplicate IDs before calendar writes', () => {
  const h = gasHarness();
  assert.throws(() => h.syncSchoolEvents({ ...payload, events: [{ ...payload.events[0], date: '2026-02-30' }] }));
  assert.throws(() => h.syncSchoolEvents({ ...payload, events: [payload.events[0], payload.events[0]] }));
  assert.equal(h.stored.length, 1);
});
