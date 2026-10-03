import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require=createRequire(import.meta.url);
let playwright;
try{playwright=require('playwright')}catch{playwright=require(join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'))}
const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('const DEFAULT_SUBJECTS='),html.indexOf('function HourCounterPanel('));
const api=vm.runInNewContext(source+'\n({createInitialState,normalizePlan})',{Date,URL,TextEncoder,globalThis:{}});
const seed=JSON.parse(JSON.stringify(api.createInitialState()));
seed.meta.schoolYear=2026;seed.meta.role='specialist';
const c=seed.classes[0];c.schoolYear=2026;c.subjectIds=['sansu','rika'];c.defaultRoomId='home';
seed.rooms=[{id:'home',name:'普通教室',building:'南',floor:'2'},{id:'science',name:'理科室',building:'北',floor:'3'}];
seed.travelRules=[{fromId:'home',toId:'science',minutes:20}];
seed.schoolCalendar.periodTimes[2].start='10:35';
const slot=(id,subjectId='sansu',extra={})=>({lessonId:id,subjectId,status:'planned',minutes:45,curriculumUnitId:subjectId==='sansu'?'unit':null,unit:subjectId==='sansu'?'小数':'天気',sub:'本時',items:'ノート',memo:'児童メモ',roomId:null,reflection:{achievement:'none',observations:'',nextSteps:''},cancelReason:'',rescheduledFrom:null,rescheduledTo:null,...extra});
const week=(date,periods,grade=5)=>({weekStart:date,grade,days:{[date]:{gyozen:{text:''},periods}}});
seed.classPlans[c.id]={weeks:{'2026-09-28':week('2026-09-28',{'1':slot('one'),'2':slot('two','rika',{roomId:'science'}),'3':slot('reflection','sansu',{status:'done',reflection:{achievement:'met',observations:'説明ができた',nextSteps:'図を使う'}})})}};
seed.classes.push({...c,id:'class-two',className:'2',subjectIds:['sansu']});
seed.classPlans['class-two']={weeks:{'2026-09-28':week('2026-09-28',{'1':slot('other')})}};
seed.classes.push({...c,id:'old-class',schoolYear:2025,className:'1'});
seed.classPlans['old-class']={weeks:{'2025-09-29':week('2025-09-29',{'1':slot('old-lesson','sansu',{status:'done',curriculumUnitId:null,reflection:{achievement:'partial',observations:'昨年度の記録',nextSteps:'導入を改善'}})})}};
seed.curriculum=[{id:'curr',schoolYear:2026,grade:5,subjectId:'sansu',publisher:'テスト会社',textbook:'算数5',source:'synthetic.xlsx',units:[{id:'unit',title:'小数',plannedHours:3,month:9,resources:[{title:'参考',url:'https://example.com/lesson'}],researchNote:''}]}];
seed.tasks=[{id:'task',text:'私的タスク',date:'2026-10-03',done:false,createdAt:1,classId:c.id}];
api.normalizePlan(seed);
const server=createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html)});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}/`;
const browser=await playwright.chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
const out=new URL('../.verification/',import.meta.url);await mkdir(out,{recursive:true});
const errors=[];let active;
async function newPage({gas=false,width=1280}={}){
  const page=await browser.newPage({viewport:{width,height:844}});active=page;
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')console.error(m.text())});page.on('dialog',d=>d.accept());
  await page.addInitScript(({seed,gas})=>{
    const OriginalDate=Date;
    window.Date=class extends OriginalDate{constructor(...args){super(...(args.length?args:['2026-10-03T09:00:00+09:00']))}static now(){return new OriginalDate('2026-10-03T09:00:00+09:00').getTime()}};
    localStorage.setItem('weeklyPlan_v4',JSON.stringify(seed));
    if(gas){
      window.__cloud={revision:0,plan:null,includePrivate:false,backups:[],calls:[],conflict:false};
      window.google={script:{run:new Proxy({}, {get(_,method){if(method==='withSuccessHandler'||method==='withFailureHandler')return handler=>runner(method,handler,null)}})}};
      function runner(kind,handler,other){let success=kind==='withSuccessHandler'?handler:other,failure=kind==='withFailureHandler'?handler:other;return new Proxy({}, {get(_,method){if(method==='withSuccessHandler')return h=>runner(method,h,failure);if(method==='withFailureHandler')return h=>runner(method,h,success);return payload=>setTimeout(()=>{const db=window.__cloud;db.calls.push(method);try{
        let result;if(method==='getCloudStatus')result={exists:!!db.plan,revision:db.revision};
        else if(method==='saveCloudPlan'){if(db.conflict||payload.baseRevision!==db.revision)throw new Error('保存競合');if(db.plan)db.backups.unshift({id:'b'+db.revision,revision:db.revision,plan:structuredClone(db.plan),includePrivate:db.includePrivate,updatedAt:'2026-10-03'});db.plan=JSON.parse(payload.planText);db.includePrivate=payload.includePrivate;result={revision:++db.revision,updatedAt:'2026-10-03'}}
        else if(method==='loadCloudPlan')result={exists:!!db.plan,revision:db.revision,headRevision:db.revision,plan:db.plan,includePrivate:db.includePrivate};
        else if(method==='listCloudBackups')result=db.backups.map(({plan,...b})=>b);
        else if(method==='loadCloudBackup')result={...db.backups.find(b=>b.id===payload.backupId),exists:true,headRevision:db.revision};
        success(result);
      }catch(e){failure(e)}},20)}})}
    }
  },{seed,gas});
  await page.goto(url,{waitUntil:'networkidle',timeout:45000});await page.getByRole('tab',{name:'週案',exact:true}).waitFor();return page;
}
const saved=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('weeklyPlan_v4')));
const settle=page=>page.waitForTimeout(650);
const tab=(page,name)=>page.getByRole('tab',{name,exact:true}).click();
const command=(page,value)=>page.getByLabel('週操作',{exact:true}).selectOption(value);
try{
  const page=await newPage();
  console.log('V4: atomic undo/redo, class navigation and templates');
  await page.getByLabel('2026-09-28 の業前').fill('朝読書');await settle(page);
  await page.getByLabel('学級',{exact:true}).selectOption('class-two');
  await page.getByRole('button',{name:'元に戻す',exact:true}).click();await settle(page);assert.equal((await saved(page)).classPlans[c.id].weeks['2026-09-28'].days['2026-09-28'].gyozen.text,'');assert.equal(await page.getByLabel('学級',{exact:true}).inputValue(),'class-two');
  await page.getByRole('button',{name:'やり直す',exact:true}).click();await settle(page);assert.equal((await saved(page)).classPlans[c.id].weeks['2026-09-28'].days['2026-09-28'].gyozen.text,'朝読書');
  await page.getByLabel('学級',{exact:true}).selectOption(c.id);
  await command(page,'templates');let dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'現在週をテンプレート保存'}).click();assert.equal(await dialog.getByText('通常週',{exact:true}).count(),1);await dialog.getByRole('button',{name:'閉じる',exact:true}).click();
  await page.getByRole('button',{name:'次の週',exact:true}).click();await command(page,'templates');dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'今週に適用'}).click();await dialog.getByRole('button',{name:'閉じる',exact:true}).click();await settle(page);
  let p=await saved(page),s=p.classPlans[c.id].weeks['2026-10-05'].days['2026-10-05'].periods['1'];assert.equal(s.unit,'');assert.equal(s.memo,'');assert.equal(s.status,'planned');assert.notEqual(s.lessonId,'one');
  await page.getByRole('button',{name:'元に戻す',exact:true}).click();assert.ok((await page.locator('.cell-drop').first().innerText()).includes('＋'));await page.getByRole('button',{name:'やり直す',exact:true}).click();
  await page.getByRole('button',{name:'前の週',exact:true}).click();await command(page,'bulk');dialog=page.getByRole('dialog');await dialog.getByLabel('実施日',{exact:true}).fill('2026-09-28');await dialog.getByRole('button',{name:'2コマを実施済みにする'}).click();await settle(page);assert.equal((await saved(page)).classPlans[c.id].weeks['2026-09-28'].days['2026-09-28'].periods['1'].status,'done');
  await page.getByRole('button',{name:'元に戻す',exact:true}).click();await settle(page);assert.equal((await saved(page)).classPlans[c.id].weeks['2026-09-28'].days['2026-09-28'].periods['1'].status,'planned');
  console.log('V4: calendar/forecast, rooms/travel, annual progress, historic research reuse');
  await tab(page,'学校暦・予測');assert.ok(await page.getByText('学校暦が未確認のため',{exact:false}).isVisible());await page.getByLabel('授業数・校時・休業・祝日行事を確認済み').check();await page.getByRole('button',{name:'学校暦を保存',exact:true}).click();await page.getByLabel('予測用の通常時間割',{exact:true}).selectOption({label:'通常週'});await settle(page);assert.equal((await saved(page)).schoolCalendar.confirmed,true);
  await tab(page,'教室・移動');assert.ok(await page.getByText('移動時間不足',{exact:true}).count());assert.ok(await page.getByText('教室利用が重複',{exact:false}).count());
  await tab(page,'年間比較');assert.equal(await page.locator('.data-table').count(),2);assert.ok((await page.locator('.data-table').nth(1).innerText()).includes('5年2組'));assert.ok((await page.locator('.data-table').nth(1).innerText()).includes('33.3%'));
  await tab(page,'振り返り');await page.getByLabel('振り返りの年度',{exact:true}).selectOption('2025');assert.ok(await page.getByText('昨年度の記録',{exact:true}).isVisible());await page.getByLabel('old-lesson の転記先単元').selectOption({label:'2026年度 小数'});await page.getByRole('button',{name:'ノートへ転記',exact:true}).click();await settle(page);assert.ok((await saved(page)).curriculum[0].units[0].researchNote.includes('昨年度の記録'));await page.getByRole('button',{name:'教材研究',exact:true}).click();dialog=page.getByRole('dialog');assert.ok((await dialog.getByLabel('教材研究ノート',{exact:true}).inputValue()).includes('導入を改善'));await dialog.getByRole('button',{name:'閉じる',exact:true}).click();
  console.log('V4: horizontal Excel and actual xlsx template export');
  await tab(page,'行事カレンダー');await page.getByRole('button',{name:'行事Excel取込',exact:true}).click();
  const buffer=Buffer.from(await page.evaluate(()=>{const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['日','10月行事','日','1月行事'],[5,'体育集会',8,'始業式'],[32,'無効',9,'']]),'年間');return Array.from(new Uint8Array(XLSX.write(wb,{type:'array',bookType:'xlsx'})))}));
  dialog=page.getByRole('dialog');await dialog.getByLabel('Excelファイル',{exact:true}).setInputFiles({name:'horizontal.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer});await dialog.getByLabel('日付形式',{exact:true}).selectOption('horizontal');await dialog.getByLabel('ブロック1 月').selectOption('10');await dialog.getByLabel('ブロック1 日列').selectOption('0');await dialog.getByLabel('ブロック1 行事列').selectOption('1');await dialog.getByRole('button',{name:'月ブロックを追加'}).click();await dialog.getByLabel('ブロック2 月').selectOption('1');await dialog.getByLabel('ブロック2 日列').selectOption('2');await dialog.getByLabel('ブロック2 行事列').selectOption('3');
  await dialog.getByRole('button',{name:'取り込みを確定'}).click();await settle(page);p=await saved(page);assert.equal(p.events['2027-01-08'][0].title,'始業式');assert.equal(p.events['2026-10-05'][0].title,'体育集会');
  await tab(page,'週案');await command(page,'export');dialog=page.getByRole('dialog');assert.ok((await dialog.innerText()).includes('49セル'));
  const schoolTemplate=Buffer.from(await page.evaluate(()=>{const wb=XLSX.utils.book_new(),ws=XLSX.utils.aoa_to_sheet([['元の様式']]);ws.L1={t:'n',f:'SUM(1,2)',v:3};ws['!ref']='A1:L20';ws['!cols']=Array.from({length:12},()=>({wch:14}));ws['!merges']=[{s:{r:2,c:1},e:{r:2,c:2}}];XLSX.utils.book_append_sheet(wb,ws,'学校週案');return Array.from(new Uint8Array(XLSX.write(wb,{type:'array',bookType:'xlsx'})))}));
  await dialog.getByLabel('学校様式のxlsx（任意）',{exact:true}).setInputFiles({name:'school-template.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:schoolTemplate});await dialog.getByText('C3 は結合セルの左上ではありません',{exact:true}).waitFor();await dialog.getByLabel('曜日の列間隔',{exact:true}).fill('2');await dialog.getByText('C3 は結合セルの左上ではありません',{exact:true}).waitFor({state:'hidden'});
  await dialog.getByRole('button',{name:'設定を保存',exact:true}).click();await settle(page);assert.equal((await saved(page)).exportProfiles.length,1);
  const download=page.waitForEvent('download');await dialog.getByRole('button',{name:'Excelを書き出す'}).click();const file=await download;await file.saveAs(fileURLToPath(new URL('v4-export.xlsx',out)));
  const downloaded=await readFile(await file.path());
  const result=await page.evaluate(data=>{const wb=XLSX.read(new Uint8Array(data),{type:'array'}),ws=wb.Sheets['学校週案'];return {subject:ws.B6.v,year:ws.A1.v,formula:ws.L1.f,merges:ws['!merges']}},Array.from(downloaded));assert.ok(result.subject.includes('算数'));assert.equal(result.subject.includes('児童メモ'),false);assert.equal(result.year,2026);assert.equal(result.formula,'SUM(1,2)');assert.equal(result.merges.length,1);
  await dialog.getByLabel('出力内容',{exact:true}).selectOption('hours');await dialog.getByLabel('集計開始日',{exact:true}).fill('');assert.ok(await dialog.getByRole('alert').isVisible());assert.equal(await page.getByText('アプリを表示できませんでした',{exact:true}).count(),0);await dialog.getByRole('button',{name:'閉じる',exact:true}).click();
  await tab(page,'同期・バックアップ');assert.ok(await page.getByText('現在は通常のWeb版です。',{exact:false}).isVisible());assert.equal(await page.getByRole('button',{name:'Driveへ保存'}).isDisabled(),true);
  console.log('V4: GAS client adapter, private exclusion, background auto save, conflict halt and recovery');
  const gas=await newPage({gas:true});await tab(gas,'同期・バックアップ');assert.equal(await gas.evaluate(()=>__cloud.calls.length),0);await gas.getByLabel('本人のDrive保存を有効にする').check();await gas.getByRole('button',{name:'Driveへ保存',exact:true}).click();await gas.getByText('Drive保存完了 revision 1',{exact:false}).waitFor();
  assert.equal(await gas.evaluate(()=>__cloud.plan.tasks.length),0);assert.equal(await gas.evaluate(id=>__cloud.plan.classPlans[id].weeks['2026-09-28'].days['2026-09-28'].periods['1'].memo,c.id),'');
  await gas.getByLabel('変更後に自動保存・世代バックアップ').check();await tab(gas,'週案');await gas.getByLabel('2026-09-28 の業前').fill('同期テスト');await gas.waitForFunction(()=>__cloud.revision===2,{},{timeout:15000});assert.equal(await gas.evaluate(id=>__cloud.plan.classPlans[id].weeks['2026-09-28'].days['2026-09-28'].gyozen.text,c.id),'同期テスト');
  await gas.evaluate(()=>{__cloud.conflict=true});await gas.getByLabel('2026-09-28 の業前').fill('競合テスト');await gas.waitForFunction(()=>JSON.parse(localStorage.getItem('weeklyPlannerCloud_v1')).auto===false,{},{timeout:15000});assert.equal(await gas.evaluate(()=>__cloud.revision),2);await tab(gas,'同期・バックアップ');assert.ok(await gas.getByText('保存競合',{exact:false}).isVisible());await gas.evaluate(()=>{__cloud.conflict=false});await gas.getByRole('button',{name:'Driveから復元',exact:true}).click();await gas.getByText('Driveから復元しました。',{exact:false}).waitFor();await settle(gas);assert.equal((await saved(gas)).classPlans[c.id].weeks['2026-09-28'].days['2026-09-28'].gyozen.text,'同期テスト');assert.equal((await saved(gas)).classPlans[c.id].weeks['2026-09-28'].days['2026-09-28'].periods['1'].memo,'児童メモ');assert.ok(await gas.evaluate(()=>localStorage.getItem('weeklyPlan_beforeCloud_v4')));
  await gas.getByRole('button',{name:'世代一覧を取得',exact:true}).click();await gas.getByRole('button',{name:'この世代を復元',exact:true}).waitFor();await gas.getByRole('button',{name:'この世代を復元',exact:true}).click();await gas.getByText('Driveから復元しました。',{exact:false}).waitFor();await settle(gas);assert.equal((await saved(gas)).classPlans[c.id].weeks['2026-09-28'].days['2026-09-28'].gyozen.text,'');
  await gas.getByLabel('個人情報を含む欄も保存').check();await gas.getByRole('button',{name:'Driveへ保存',exact:true}).click();await gas.getByText('Drive保存完了 revision 3',{exact:false}).waitFor();assert.equal(await gas.evaluate(()=>__cloud.plan.tasks.length),1);assert.equal(await gas.evaluate(id=>__cloud.plan.classPlans[id].weeks['2026-09-28'].days['2026-09-28'].periods['1'].memo,c.id),'児童メモ');
  console.log('V4: desktop/mobile screenshots and bounds');
  await tab(page,'週案');await page.screenshot({path:fileURLToPath(new URL('v4-desktop.png',out))});
  const mobile=await newPage({width:390});await mobile.screenshot({path:fileURLToPath(new URL('v4-mobile.png',out))});
  const bounds=await mobile.locator('.cell-drop').evaluateAll(cells=>cells.map(c=>{const r=c.getBoundingClientRect();return {top:r.top,bottom:r.bottom,width:r.width}}));assert.equal(bounds.length,30);assert.ok(bounds.every(r=>r.width>40&&r.top>0&&r.bottom<=844));assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  for(const name of ['学校暦・予測','教室・移動','年間比較','振り返り','同期・バックアップ']){await tab(mobile,name);assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)}
  assert.deepEqual(errors,[]);console.log('V4 browser checks passed. GAS transport is mocked; real Google authorization remains external.');
}catch(e){if(active)await active.screenshot({path:fileURLToPath(new URL('v4-failure.png',out))});throw e}
finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
