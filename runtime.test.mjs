import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Script,createContext} from 'node:vm';

const html=readFileSync(new URL('./ui.html',import.meta.url),'utf8');
const helpers=html.match(/function expireRuntimeSnapshot[\s\S]*?(?=let draggedKey)/)[0];
function harness(runtimeLive=false){
  const task={column:'running',rawStatus:'active',runtimeStatusSource:'desktopSnapshot',nativeSectionId:'review'};
  const board={tasks:[task],sync:{runtimeLive},runtimeCapturedAt:'2026-10-03T00:00:00Z',runtimeSnapshotMaxAgeMs:15000};
  const api=new Script(helpers+'\n({expireRuntimeSnapshot,runtimeLabel})').runInContext(createContext({DATA:board,columns:[{id:'running',name:'Running'},{id:'unknown',name:'Unknown status'}]}));
  return {api,task,board};
}
test('browser expires cached running status even when polling is disconnected',()=>{
  const {api,task,board}=harness();
  assert.equal(api.expireRuntimeSnapshot(Date.parse('2026-10-03T00:00:15Z')),false);
  assert.equal(api.runtimeLabel(task),'Running (snapshot)');
  assert.equal(api.expireRuntimeSnapshot(Date.parse('2026-10-03T00:00:16Z')),true);
  assert.equal(task.column,'unknown');assert.equal(api.runtimeLabel(task),null);
  assert.equal(task.nativeSectionId,'review');assert.equal(task.lastObservedStatus,'active');
  assert.equal(task.lastObservedAt,board.runtimeCapturedAt);
  assert.equal(api.expireRuntimeSnapshot(Date.parse('2026-10-03T00:00:17Z')),false);
});
test('expiry never overrides a connected live execution source',()=>{
  const {api,task}=harness(true);
  assert.equal(api.expireRuntimeSnapshot(Date.parse('2026-10-03T01:00:00Z')),false);
  assert.equal(task.column,'running');assert.equal(api.runtimeLabel(task),'Running');
});
test('invalid timestamps and missing observations cannot claim current state',()=>{
  const {api,task,board}=harness();board.runtimeCapturedAt='invalid';
  assert.equal(api.expireRuntimeSnapshot(Date.now()),true);
  task.runtimeStatusSource='unavailable';assert.equal(api.runtimeLabel(task),null);
});
test('standalone build labels fresh Desktop observations as snapshots and expires old execution',()=>{
  const directory=mkdtempSync(join(tmpdir(),'kanban-runtime-build-'));
  try{
    const input=join(directory,'snapshot.json'),output=join(directory,'index.html');
    const capturedAt='2026-10-03T00:00:00Z';
    writeFileSync(input,JSON.stringify({capturedAt,threads:[{kind:'codex',hostId:'local',id:'example',title:'Example',status:'active'}]}));
    execFileSync(process.execPath,[fileURLToPath(new URL('./build.mjs',import.meta.url)),input,output]);
    const generated=readFileSync(output,'utf8');
    const board=JSON.parse(generated.match(/let DATA = (.*);/)[1]);
    const task=board.tasks[0];
    const api=new Script(helpers+'\n({expireRuntimeSnapshot,runtimeLabel})').runInContext(createContext({DATA:board,columns:[{id:'running',name:'Running'}]}));
    assert.equal(api.expireRuntimeSnapshot(Date.parse(capturedAt)+1000),false);
    assert.equal(api.runtimeLabel(task),'Running (snapshot)');
    assert.equal(api.expireRuntimeSnapshot(Date.parse(capturedAt)+86400000),true);
    assert.equal(task.column,'unknown');assert.equal(api.runtimeLabel(task),null);
    assert.equal(task.lastObservedStatus,'active');assert.equal(task.lastObservedAt,capturedAt);
  }finally{rmSync(directory,{recursive:true,force:true});}
});
