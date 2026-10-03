import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); }
catch { playwright = require(join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const out = new URL('../.verification/', import.meta.url);
await mkdir(out, { recursive: true });
const server = createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await playwright.chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
const errors = [];
let activePage;
async function newPage(seed = null) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') console.error('Browser console:', m.text()); });
  page.on('dialog', d => d.accept());
  await page.addInitScript(({ seed }) => {
    const OriginalDate = Date;
    window.Date = class extends OriginalDate {
      constructor(...args) { super(...(args.length ? args : ['2026-10-03T09:00:00+09:00'])); }
      static now() { return new OriginalDate('2026-10-03T09:00:00+09:00').getTime(); }
    };
    if (seed) localStorage.setItem(seed.key, seed.value);
  }, { seed });
  await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
  return page;
}
async function excelBuffer(page, sheets, date1904 = false) {
  return Buffer.from(await page.evaluate(({ sheets, date1904 }) => {
    const wb = XLSX.utils.book_new();
    for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
    wb.Workbook = { WBProps: { date1904 } };
    return Array.from(new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' })));
  }, { sheets, date1904 }));
}
const upload = async (page, name, buffer) => page.getByLabel('Excelファイル').setInputFiles({ name, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer });
try {
  const page = await newPage();
  activePage = page;
  console.log('Browser: weekly editing and copy');
  await page.getByRole('tab', { name: '週案', exact: true }).waitFor();
  assert.equal(await page.locator('.cell-drop').count(), 30);
  await page.getByRole('button', { name: '算数', exact: true }).dragTo(page.locator('.cell-drop').first());
  await page.locator('.cell-drop').first().click();
  let dialog = page.getByRole('dialog');
  await dialog.getByPlaceholder('例：整数と小数').fill('小数のしくみ');
  await dialog.getByPlaceholder('例：ものさし・ノート').fill('ものさし・ノート');
  await dialog.getByLabel('実施状態').selectOption('done');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await page.waitForFunction(() => { const p = JSON.parse(localStorage.getItem('weeklyPlan_v3') || '{}'); return p.classPlans?.[p.activeClassId]?.weeks?.['2026-09-28']?.days?.['2026-09-28']?.periods?.['1']?.status === 'done'; });
  await page.getByRole('button', { name: '次の週', exact: true }).click();
  await page.getByRole('button', { name: '前週コピー', exact: true }).click();
  assert.ok(!(await page.locator('.cell-drop').first().innerText()).includes('実施済'));
  await page.getByRole('tab', { name: '時数・指導計画', exact: true }).click();
  const maths = page.locator('.data-table').first().getByRole('row').filter({ hasText: '算数' });
  assert.equal((await maths.locator('td').allTextContents())[3], '1');
  assert.equal((await maths.locator('td').allTextContents())[2], '2');

  // Import a non-first sheet with a title row above its headers.
  const events = await excelBuffer(page, { '説明': [['説明文']], '年間行事': [['2026年度'], ['日付', '行事'], ['10/1', '避難訓練'], ['1/8', '始業式'], ['2/30', '無効日付']] });
  console.log('Browser: school event Excel import');
  await page.getByRole('tab', { name: '行事カレンダー', exact: true }).click();
  for (let repeat = 0; repeat < 2; repeat++) {
    await page.getByRole('button', { name: '行事Excel取込', exact: true }).click();
    await upload(page, 'school.xlsx', events);
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('シート', { exact: true }).selectOption('年間行事');
    await dialog.getByLabel('見出し行').fill('2');
    await dialog.getByLabel('日付の列').selectOption('0');
    await dialog.getByLabel('行事名の列').selectOption('1');
    assert.ok((await dialog.innerText()).includes('有効 2件 / 除外 1件'));
    await dialog.getByRole('button', { name: '取り込みを確定' }).click();
  }
  assert.equal(await page.getByRole('button', { name: '避難訓練', exact: true }).count(), 1);
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('weeklyPlan_v3') || '{}').events?.['2027-01-08']?.length === 1);
  const eventDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'ICS書き出し' }).click();
  assert.ok((await eventDownload).suggestedFilename().endsWith('.ics'));

  await page.getByRole('tab', { name: '時数・指導計画', exact: true }).click();
  const curriculum = await excelBuffer(page, { '算数': [['月', '単元', '配当'], [9, '小数のしくみ', 4], [10, '分数', 3]] });
  await page.getByRole('button', { name: '指導計画Excel取込' }).click();
  await upload(page, 'publisher.xlsx', curriculum);
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('単元名の列').selectOption('1');
  await dialog.getByLabel('配当時数の列').selectOption('2');
  await dialog.getByLabel('予定月の列（任意）').selectOption('0');
  await dialog.getByLabel('出版社', { exact: true }).fill('検証用出版社');
  await dialog.getByRole('button', { name: '取り込みを確定' }).click();
  await page.getByRole('button', { name: 'リンク編集', exact: true }).first().click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('リンク名').fill('教材研究');
  await dialog.getByLabel('教材研究URL').fill('javascript:alert(1)');
  await dialog.getByRole('button', { name: 'リンクを追加' }).click();
  assert.ok((await dialog.innerText()).includes('http または https'));
  await dialog.getByLabel('教材研究URL').fill('https://example.org/material');
  await dialog.getByRole('button', { name: 'リンクを追加' }).click();
  await dialog.getByRole('button', { name: '閉じる', exact: true }).click();
  await page.getByRole('tab', { name: '週案', exact: true }).click();
  await page.getByRole('button', { name: '前の週', exact: true }).click();
  await page.locator('.cell-drop').first().click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('年間指導計画の単元').selectOption({ label: '小数のしくみ（4時）' });
  assert.equal(await dialog.getByRole('link', { name: '教材研究', exact: true }).getAttribute('href'), 'https://example.org/material');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('tab', { name: '時数・指導計画', exact: true }).click();
  const unitRow = page.locator('.data-table').nth(1).getByRole('row').filter({ hasText: '小数のしくみ' });
  assert.equal((await unitRow.locator('td').allTextContents())[4], '1');
  await page.screenshot({ path: fileURLToPath(new URL('progress-desktop.png', out)), fullPage: true });

  // Real SheetJS serial-date interpretation for both Excel date systems.
  const serials = await page.evaluate(() => ({ standard: parseExcelDate(46120, 2026, false), alternate: parseExcelDate(44658, 2026, true), leap: parseExcelDate(60, 2026, false) }));
  assert.equal(serials.standard, serials.alternate);
  assert.equal(serials.standard, '2026-04-08');
  assert.equal(serials.leap, null);

  await page.getByRole('tab', { name: '週案', exact: true }).click();
  await page.screenshot({ path: fileURLToPath(new URL('weekly-desktop.png', out)), fullPage: true });
  await page.emulateMedia({ media: 'print' });
  await page.pdf({ path: fileURLToPath(new URL('weekly-print.pdf', out)), preferCSSPageSize: true, printBackground: true });
  assert.equal(await page.locator('.print-title').isVisible(), true);
  const gridHeight = await page.locator('.schedule-grid').evaluate(el => el.getBoundingClientRect().height);
  assert.ok(gridHeight > 600 && gridHeight < 700);
  await page.emulateMedia({ media: 'screen' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: fileURLToPath(new URL('weekly-mobile.png', out)), fullPage: true });
  const bounds = await page.locator('.schedule-grid').boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391 && bounds.y + bounds.height <= 845);
  await page.waitForFunction(() => !!JSON.parse(localStorage.getItem('weeklyPlan_v3') || '{}').curriculum?.[0]?.units?.[0]?.resources?.length);
  await page.reload({ waitUntil: 'networkidle' });
  assert.ok((await page.locator('.cell-drop').first().innerText()).includes('小数のしくみ'));
  await page.close();

  console.log('Browser: specialist classes, conflicts, preparation, rescheduling and CSV');
  const specialist = await newPage(); activePage = specialist;
  await specialist.getByRole('button', { name: '設定・バックアップ', exact: true }).click();
  dialog = specialist.getByRole('dialog');
  await dialog.getByLabel('担当区分').selectOption('specialist');
  await dialog.getByRole('button', { name: '学級設定', exact: true }).click();
  dialog = specialist.getByRole('dialog');
  await dialog.getByRole('button', { name: '選択を解除', exact: true }).click();
  await dialog.getByLabel('音楽', { exact: true }).check();
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  assert.equal(await specialist.locator('.subj-chip').count(), 1);
  const firstClass = await specialist.getByLabel('学級', { exact: true }).inputValue();
  await specialist.getByRole('button', { name: '学級を追加', exact: true }).click();
  dialog = specialist.getByRole('dialog');
  await dialog.getByLabel('学年', { exact: true }).selectOption('6');
  await dialog.getByLabel('組', { exact: true }).fill('2');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  const secondClass = await specialist.getByLabel('学級', { exact: true }).inputValue();
  assert.notEqual(firstClass, secondClass);
  async function music(status, unit) {
    await specialist.getByRole('button', { name: '音楽', exact: true }).click();
    await specialist.locator('.cell-drop').first().click();
    await specialist.locator('.cell-drop').first().click();
    const d = specialist.getByRole('dialog');
    await d.getByPlaceholder('例：整数と小数').fill(unit);
    await d.getByPlaceholder('例：ものさし・ノート').fill('楽譜・リコーダー');
    await d.getByLabel('実施状態').selectOption(status);
    await d.getByRole('button', { name: '保存', exact: true }).click();
  }
  await music('done', '6年の歌');
  await specialist.getByLabel('学級', { exact: true }).selectOption(firstClass);
  assert.ok(!(await specialist.locator('.cell-drop').first().innerText()).includes('6年の歌'));
  await music('planned', '5年の歌');
  await specialist.getByRole('tab', { name: '担当時間割', exact: true }).click();
  assert.equal(await specialist.locator('.teacher-cell.conflict').count(), 1);
  assert.ok((await specialist.locator('.teacher-cell.conflict').innerText()).includes('6年2組'));
  const cellHeights = await specialist.locator('.teacher-cell').evaluateAll(cells => cells.map(c => c.getBoundingClientRect().height));
  assert.ok(Math.max(...cellHeights) - Math.min(...cellHeights) < 1);
  await specialist.screenshot({ path: fileURLToPath(new URL('specialist-desktop.png', out)), fullPage: true });
  await specialist.getByRole('tab', { name: '時数・指導計画', exact: true }).click();
  assert.equal(await specialist.locator('.data-table').first().locator('tbody tr').count(), 1);
  assert.equal((await specialist.locator('.data-table').first().locator('tbody td').allTextContents())[3], '0');
  await specialist.getByLabel('学級', { exact: true }).selectOption(secondClass);
  assert.equal((await specialist.locator('.data-table').first().locator('tbody td').allTextContents())[3], '1');
  await specialist.getByRole('tab', { name: '準備・振替', exact: true }).click();
  const prepared = specialist.getByLabel('楽譜 の準備完了'); await prepared.check();
  assert.ok((await specialist.locator('.prep-row').filter({ hasText: '楽譜' }).innerText()).includes('5年1組'));
  await specialist.getByLabel('学級', { exact: true }).selectOption(firstClass);
  await specialist.getByRole('tab', { name: '週案', exact: true }).click();
  await specialist.locator('.cell-drop').first().click(); dialog = specialist.getByRole('dialog');
  await dialog.getByLabel('実施状態').selectOption('cancelled');
  await dialog.getByLabel('中止理由').fill('集会');
  await dialog.getByPlaceholder('例：整数と小数').fill('5年の歌（修正）');
  await dialog.getByRole('button', { name: '振替候補', exact: true }).click();
  dialog = specialist.getByRole('dialog');
  assert.ok((await dialog.innerText()).includes('5年の歌（修正）'));
  await dialog.getByRole('button', { name: '閉じる', exact: true }).click();
  await specialist.getByLabel('学級', { exact: true }).selectOption(secondClass);
  await specialist.getByRole('button', { name: '次の週', exact: true }).click();
  await music('planned', '振替不可の担当授業');
  await specialist.getByRole('tab', { name: '行事カレンダー', exact: true }).click();
  await specialist.getByRole('button', { name: '2026-10-05 の行事を編集', exact: true }).click();
  dialog = specialist.getByRole('dialog');
  await dialog.getByLabel('行事名', { exact: true }).fill('5年集会');
  await dialog.getByLabel('対象学年').selectOption('5');
  await dialog.getByLabel('2限', { exact: true }).check();
  await dialog.getByRole('button', { name: '追加', exact: true }).click();
  await dialog.getByRole('button', { name: '閉じる', exact: true }).click();
  await specialist.getByRole('button', { name: '2026-10-06 の行事を編集', exact: true }).click();
  dialog = specialist.getByRole('dialog');
  await dialog.getByLabel('行事名', { exact: true }).fill('休業');
  await dialog.getByLabel('行事種別').selectOption('holiday');
  await dialog.getByRole('button', { name: '追加', exact: true }).click();
  await dialog.getByRole('button', { name: '閉じる', exact: true }).click();
  await specialist.getByLabel('学級', { exact: true }).selectOption(firstClass);
  await specialist.getByRole('tab', { name: '準備・振替', exact: true }).click();
  await specialist.getByRole('button', { name: '前の週', exact: true }).click();
  await specialist.getByRole('button', { name: '振替候補', exact: true }).click();
  dialog = specialist.getByRole('dialog');
  assert.equal(await dialog.getByRole('button', { name: '2026-10-05（月）1限', exact: true }).count(), 0);
  assert.equal(await dialog.getByRole('button', { name: '2026-10-05（月）2限', exact: true }).count(), 0);
  assert.equal(await dialog.getByRole('button', { name: /2026-10-06/ }).count(), 0);
  await dialog.getByRole('button', { name: '2026-10-05（月）3限', exact: true }).click();
  await dialog.getByRole('button', { name: 'このコマに振り替える', exact: true }).click();
  assert.ok((await specialist.locator('.page-view').innerText()).includes('振替: 2026-10-05 3限'));
  await specialist.getByRole('button', { name: '次の週', exact: true }).click();
  await specialist.getByLabel('楽譜 の準備完了').check();
  await specialist.screenshot({ path: fileURLToPath(new URL('preparation-desktop.png', out)), fullPage: true });
  await specialist.getByRole('tab', { name: '時数・指導計画', exact: true }).click();
  await specialist.getByRole('button', { name: '時数報告CSV', exact: true }).click();
  dialog = specialist.getByRole('dialog');
  await dialog.getByLabel('報告する学級').selectOption('all');
  assert.equal(await dialog.locator('tbody tr').count(), 2);
  const reportDownload = specialist.waitForEvent('download');
  await dialog.getByRole('button', { name: 'CSVを書き出す', exact: true }).click();
  const reportFile = await reportDownload; const reportText = await readFile(await reportFile.path(), 'utf8');
  assert.ok(reportText.startsWith('\uFEFF')); assert.ok(reportText.includes('年度実施時数')); assert.ok(!reportText.includes('集会'));
  await dialog.getByRole('button', { name: '閉じる', exact: true }).click();
  await specialist.getByRole('tab', { name: '担当時間割', exact: true }).click();
  await specialist.setViewportSize({ width: 390, height: 844 });
  await specialist.screenshot({ path: fileURLToPath(new URL('specialist-mobile.png', out)), fullPage: true });
  assert.ok(await specialist.locator('.teacher-grid').evaluate(el => el.getBoundingClientRect().right <= innerWidth));
  await specialist.waitForFunction(() => { const p = JSON.parse(localStorage.getItem('weeklyPlan_v3') || '{}'); return p.classes?.length === 2 && Object.values(p.classPlans || {}).some(cp => Object.values(cp.weeks).some(w => Object.values(w.days).some(d => Object.values(d.periods).some(s => s?.rescheduledTo)))); });
  await specialist.reload({ waitUntil: 'networkidle' });
  assert.equal(await specialist.getByLabel('学級', { exact: true }).locator('option').count(), 2);
  await specialist.getByRole('tab', { name: '準備・振替', exact: true }).click();
  await specialist.getByRole('button', { name: '次の週', exact: true }).click();
  assert.equal(await specialist.getByLabel('楽譜 の準備完了').isChecked(), true);
  await specialist.close();

  const legacy = await newPage({ key: 'weeklyPlan_v1', value: JSON.stringify({ version: 1, subjects: { kokugo: { name: '国語' } }, events: {}, weeks: {}, tasks: [] }) });
  assert.equal(await legacy.locator('.cell-drop').count(), 30);
  assert.ok((await legacy.getByRole('status').innerText()).includes('移行'));
  await legacy.close();
  const oldV2 = { version: 2, meta: { grade: 3, className: '2', teacherName: '', schoolYear: 2026 }, weeks: { '2026-09-28': { weekStart: '2026-09-28', grade: 3, days: { '2026-09-28': { gyozen: { text: '朝読書' }, periods: { 1: { subjectId: 'ongaku', status: 'done', minutes: 45, unit: '旧データの歌', memo: '原本保持' } } } } } }, tasks: [], events: {}, curriculum: [] };
  const migratedV2 = await newPage({ key: 'weeklyPlan_v2', value: JSON.stringify(oldV2) }); activePage = migratedV2;
  assert.ok((await migratedV2.locator('.cell-drop').first().innerText()).includes('旧データの歌'));
  await migratedV2.waitForFunction(() => JSON.parse(localStorage.getItem('weeklyPlan_v3') || '{}').version === 3);
  assert.equal(await migratedV2.evaluate(() => localStorage.getItem('weeklyPlan_v2')), JSON.stringify(oldV2));
  await migratedV2.close();
  const invalid = await newPage({ key: 'weeklyPlan_v2', value: '{broken-json' });
  assert.equal(await invalid.locator('.cell-drop').count(), 30);
  assert.ok((await invalid.getByRole('alert').innerText()).includes('自動保存を停止'));
  assert.equal(await invalid.evaluate(() => localStorage.getItem('weeklyPlan_v2')), '{broken-json');
  await invalid.close();
  const nullPlan = await newPage({ key: 'weeklyPlan_v3', value: 'null' }); activePage = nullPlan;
  assert.ok((await nullPlan.getByRole('alert').innerText()).includes('自動保存を停止'));
  assert.equal(await nullPlan.evaluate(() => localStorage.getItem('weeklyPlan_v3')), 'null');
  await nullPlan.close();

  const unavailable = await browser.newPage();
  await unavailable.route(/react(?:-dom)?\.production\.min\.js|babel\.min\.js/, route => route.abort());
  await unavailable.goto(url, { waitUntil: 'networkidle' });
  assert.ok((await unavailable.locator('#root').innerText()).includes('再読み込み'));
  await unavailable.close();
  assert.deepEqual(errors, []);
  console.log('Browser checks passed: weekly/Excel/curriculum, specialist classes and conflicts, preparation persistence, rescheduling, CSV, migration/recovery, desktop/mobile, A4 print and CDN failure.');
} catch (e) {
  if (activePage && !activePage.isClosed()) {
    console.error((await activePage.locator('body').innerText()).slice(-2500));
    await activePage.screenshot({ path: fileURLToPath(new URL('failure.png', out)), fullPage: true });
  }
  console.error('Page errors:', errors);
  throw e;
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
