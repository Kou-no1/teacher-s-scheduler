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
const api = vm.runInNewContext(source + '\n({STANDARD_HOURS,createInitialState,normalizePlan,calculateHourSummary,parseExcelDate,parseEventRows,parseCurriculumRows,mergeEvents,stableId,safeUrl,buildICS,calculateCurriculumProgress})', { Date, URL, TextEncoder, globalThis: {} });
const plain = value => JSON.parse(JSON.stringify(value));
const state = () => plain(api.createInitialState());
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
  const s = migrated.weeks['2026-04-06'].days['2026-04-06'].periods['1'];
  assert.equal(s.subjectId, 'gaikoku_katsudo');
  assert.equal(s.memo, '原本メモ');
  assert.equal(s.status, 'planned');
  assert.equal(migrated.weeks['2026-04-06'].grade, 3);
});

test('unsupported or invalid plans fail rather than being overwritten', () => {
  assert.throws(() => api.normalizePlan({ version: 9 }));
  assert.throws(() => api.normalizePlan({ ...state(), events: { '2026-02-30': [] } }));
  assert.throws(() => api.normalizePlan({ ...state(), tasks: {} }));
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
