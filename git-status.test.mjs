import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {Script,createContext} from 'node:vm';
import {createGitStatusReader,githubRepository,checkSummary} from './git-status.mjs';
import {normalize} from './build.mjs';

const sha='a'.repeat(40),merged='b'.repeat(40);
const pr={number:7,url:'https://github.com/example/board/pull/7',state:'OPEN',isDraft:false,
  isCrossRepository:false,headRefName:'codex/feature',headRefOid:sha,mergeCommit:null,
  reviewDecision:'APPROVED',statusCheckRollup:[{status:'COMPLETED',conclusion:'SUCCESS'}]};
const board={tasks:[{id:'one',hostId:'local',cwd:'/workspace'},{id:'two',hostId:'local',cwd:'/workspace'},
  {id:'remote',hostId:'remote',cwd:'/workspace'}]};
test('closing a cold reader aborts active Git commands and never starts queued work',async()=>{
  const started=[],signals=[];
  const reader=createGitStatusReader({run:async(name,args,{signal})=>{
    started.push({name,args});signals.push(signal);
    return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('Aborted')),{once:true}));
  }});
  const cold={tasks:Array.from({length:8},(_,i)=>({id:String(i),hostId:'local',cwd:'/workspace/'+i}))};
  await reader.enrich(cold,{waitForFresh:false});assert.equal(started.length,4);
  reader.close();await reader.settle();assert.equal(started.length,4);assert(signals.every(signal=>signal.aborted));
  await assert.rejects(reader.enrich(cold),/closed/);
});
function fixture(){
  const calls=[],state={branch:'codex/feature',sha,time:0,rows:[pr],fail:false};
  const reader=createGitStatusReader({clock:()=>state.time,run:async(name,args)=>{
    calls.push({name,args});
    if(name==='git'&&state.gitWait)await state.gitWait;
    if(name==='gh'){if(state.fail)throw Error('Private diagnostics');return JSON.stringify(state.rows);}
    if(args.includes('rev-parse'))return state.sha;
    if(args.includes('symbolic-ref')){if(!state.branch)throw Error('Detached');return state.branch;}
    if(args.includes('remote'))return 'git@github.com:example/board.git';
    throw Error('Unexpected command');
  }});
  const read=async()=>{await reader.enrich(board);await reader.settle();return reader.enrich(board);};
  return {reader,calls,state,read};
}
test('GitHub origins accept canonical SSH/HTTPS forms and reject credentials, other hosts and paths',()=>{
  for(const remote of ['https://github.com/example/board.git','git@github.com:example/board.git','ssh://git@github.com/example/board','https://github.com/example/board/'])assert.equal(githubRepository(remote),'example/board');
  for(const remote of ['https://token@github.com/example/board','https://github.com.evil/example/board','/local/board','https://github.com/example/board/extra','https://github.com/example/..',null])assert.equal(githubRepository(remote),null);
});
test('shared workspaces read once; remote tasks never use local Git and GitHub refresh is nonblocking',async()=>{
  const f=fixture();
  const first=await f.reader.enrich(board);
  assert.equal(first.tasks[0].git.pullRequests.status,'loading');
  await f.reader.settle();const next=await f.reader.enrich(board);
  assert.equal(next.tasks[0].git.branch,'codex/feature');assert.equal(next.tasks[2].git,null);
  assert.equal(next.tasks[0].git.pullRequests.items[0].state,'OPEN');
  assert.equal(f.calls.filter(c=>c.name==='git').length,3);assert.equal(f.calls.filter(c=>c.name==='gh').length,1);
  assert(f.calls.find(c=>c.name==='gh').args.includes('github.com/example/board'));
});
test('3-second board polls refresh Git at 30 seconds and PRs at 60 seconds',async()=>{
  const f=fixture();
  try{
    for(let time=0;time<=27000;time+=3000){f.state.time=time;await f.read();}
    assert.equal(f.calls.filter(c=>c.name==='git').length,3);
    assert.equal(f.calls.filter(c=>c.name==='gh').length,1);
    f.state.time=30000;await f.read();
    assert.equal(f.calls.filter(c=>c.name==='git').length,6);
    assert.equal(f.calls.filter(c=>c.name==='gh').length,1);
    f.state.time=60000;await f.read();
    assert.equal(f.calls.filter(c=>c.name==='git').length,9);
    assert.equal(f.calls.filter(c=>c.name==='gh').length,2);
  }finally{f.reader.close();}
});
test('manual refresh queries the actual new branch PR even when both branch caches are fresh',{timeout:1000},async()=>{
  const f=fixture();let release;
  try{
    await f.read();
    f.state.branch='codex/other';f.state.rows=[{...pr,headRefName:'codex/other'}];f.state.time=1000;
    await f.reader.enrich(board,{force:true});await f.reader.settle();
    f.state.branch='codex/feature';f.state.rows=[pr];f.state.time=2000;
    await f.reader.enrich(board,{force:true});await f.reader.settle();
    const previous=(await f.read()).tasks[0].git,calls=f.calls.length;
    f.state.branch='codex/other';f.state.rows=[{...pr,headRefName:'codex/other'}];f.state.time=3000;
    f.state.gitWait=new Promise(resolve=>release=resolve);
    const cached=await f.reader.enrich(board,{force:true,waitForFresh:false});
    assert.equal(cached.tasks[0].git.branch,'codex/feature');
    assert.equal(cached.tasks[0].git.checkedAt,previous.checkedAt);
    assert.equal(cached.tasks[0].git.pullRequests.checkedAt,previous.pullRequests.checkedAt);
    assert(cached.tasks[0].git.refreshing);
    assert.equal(f.calls.slice(calls).filter(c=>c.name==='gh').length,0);
    release();await f.reader.settle();
    const queries=f.calls.slice(calls).filter(c=>c.name==='gh');
    assert.equal(queries.length,1);assert.equal(queries[0].args[queries[0].args.indexOf('--head')+1],'codex/other');
    const fresh=(await f.read()).tasks[0].git;
    assert.equal(fresh.branch,'codex/other');assert.equal(fresh.checkedAt,new Date(3000).toISOString());
    assert.equal(fresh.pullRequests.checkedAt,new Date(3000).toISOString());
  }finally{release?.();f.reader.close();await f.reader.settle();}
});
test('cold and concurrent manual refreshes reuse pending Git and PR queries',{timeout:1000},async()=>{
  const f=fixture();let release;
  try{
    f.state.gitWait=new Promise(resolve=>release=resolve);
    const reads=await Promise.all(Array.from({length:5},()=>f.reader.enrich(board,{force:true,waitForFresh:false})));
    assert(reads.every(r=>r.tasks[0].git.status==='loading'));
    assert.equal(f.calls.filter(c=>c.name==='git').length,3);
    release();await f.reader.settle();
    assert.equal(f.calls.filter(c=>c.name==='gh').length,1);
    assert.equal((await f.read()).tasks[0].git.pullRequests.status,'ready');
  }finally{release?.();f.reader.close();await f.reader.settle();}
});
test('manual refresh joining an ordinary Git query preserves PR refresh intent',{timeout:1000},async()=>{
  const f=fixture();let release;
  try{
    await f.read();f.state.time=30000;
    f.state.gitWait=new Promise(resolve=>release=resolve);
    await f.reader.enrich(board,{waitForFresh:false});
    await f.reader.enrich(board,{force:true,waitForFresh:false});
    assert.equal(f.calls.filter(c=>c.name==='git').length,6);
    assert.equal(f.calls.filter(c=>c.name==='gh').length,1);
    release();await f.reader.settle();
    assert.equal(f.calls.filter(c=>c.name==='gh').length,2);
  }finally{release?.();f.reader.close();await f.reader.settle();}
});
test('branch matches reject other branches and cross-repository PRs; draft and historical states stay distinct',async()=>{
  const f=fixture();f.state.rows=[{...pr,headRefName:'wrong'}, {...pr,isCrossRepository:true}, {...pr,isDraft:true},
    {...pr,number:8,url:pr.url.replace('/7','/8'),state:'MERGED'}, {...pr,number:9,url:pr.url.replace('/7','/9'),state:'CLOSED'}];
  const result=(await f.read()).tasks[0].git.pullRequests;
  assert.deepEqual(result.items.map(p=>p.state),['DRAFT','MERGED','CLOSED']);assert.equal(result.match,'branch');
});
test('new detached worktrees never inherit PRs from their starting head or merge commit',async()=>{
  for(const startingSha of [sha,merged]){
    const f=fixture();f.state.branch=null;f.state.sha=startingSha;
    f.state.rows=[{...pr},{...pr,state:'MERGED',mergeCommit:{oid:merged}}];
    const result=(await f.read()).tasks[0].git;
    assert.equal(result.branch,null);assert.equal(result.pullRequests.status,'detached');
    assert.deepEqual(result.pullRequests.items,[]);
    assert.equal(f.calls.filter(c=>c.name==='gh').length,0);
  }
});
test('a reused branch does not inherit historical PRs from a merge base or old head',async()=>{
  const f=fixture();f.state.sha=merged;
  f.state.rows=[{...pr,state:'MERGED',mergeCommit:{oid:merged}}, {...pr,state:'CLOSED'}];
  assert.equal((await f.read()).tasks[0].git.pullRequests.status,'none');
  f.state.sha=sha;f.state.time=30001;
  assert.deepEqual((await f.read()).tasks[0].git.pullRequests.items.map(p=>p.state),['MERGED','CLOSED']);
});
test('switching from a PR branch to a detached worktree clears the previous association',async()=>{
  const f=fixture();await f.read();f.state.branch=null;f.state.time=30001;
  const result=(await f.read()).tasks[0].git.pullRequests;
  assert.equal(result.status,'detached');assert.deepEqual(result.items,[]);
  assert.equal(f.calls.filter(c=>c.name==='gh').length,1);
});
test('no match differs from unavailable, malformed, unsafe or incomplete responses',async()=>{
  const f=fixture();f.state.rows=[];assert.equal((await f.read()).tasks[0].git.pullRequests.status,'none');
  for(const rows of [[{...pr,url:'javascript:alert(1)'}],Array.from({length:100},()=>pr),{}]){
    const f=fixture();f.state.rows=rows;const status=(await f.read()).tasks[0].git.pullRequests;
    assert.equal(status.status,'unavailable');assert.equal(status.items.length,0);
  }
});
test('GitHub failures clear obsolete PR states and retry only at the cache interval',async()=>{
  const f=fixture();assert.equal((await f.read()).tasks[0].git.pullRequests.status,'ready');
  f.state.fail=true;f.state.time=60001;
  assert.equal((await f.read()).tasks[0].git.pullRequests.status,'unavailable');
  const count=f.calls.filter(c=>c.name==='gh').length;
  await f.read();assert.equal(f.calls.filter(c=>c.name==='gh').length,count);
  f.state.fail=false;f.state.time+=60001;
  assert.equal((await f.read()).tasks[0].git.pullRequests.status,'ready');
});
test('a branch switch cannot reuse the old branch PR result',async()=>{
  const f=fixture();await f.read();f.state.branch='codex/other';f.state.time=30001;
  const switched=(await f.read()).tasks[0].git;
  assert.equal(switched.branch,'codex/other');assert.equal(switched.pullRequests.status,'none');
  assert.equal(f.calls.filter(c=>c.name==='gh').length,2);
});
test('slow GitHub requests leave capacity for local Git refreshes',async()=>{
  let now=0,releasing=false,timer;const waiting=[];
  const reader=createGitStatusReader({clock:()=>now,run:async(name,args)=>{
    if(name==='gh'){if(releasing)return '[]';return new Promise(resolve=>waiting.push(resolve));}
    if(args.includes('rev-parse'))return sha;
    if(args.includes('symbolic-ref'))return 'codex/feature';
    if(args.includes('remote'))return 'https://github.com/example/'+args[1].split('/').at(-1);
    throw Error('Unexpected command');
  }});
  const workspaces={tasks:Array.from({length:4},(_,i)=>({id:String(i),hostId:'local',cwd:'/workspace/repo'+i}))};
  try{
    await reader.enrich(workspaces);now=30001;
    const result=await Promise.race([reader.enrich(workspaces),new Promise(resolve=>timer=setTimeout(()=>resolve(null),200))]);
    assert(result,'Git refresh waited for GitHub');assert.equal(waiting.length,2);
  }finally{clearTimeout(timer);releasing=true;waiting.forEach(resolve=>resolve('[]'));await reader.settle();}
});
test('CI failures dominate pending; missing or incomplete checks never imply success',()=>{
  assert.equal(checkSummary([]),'none');
  assert.equal(checkSummary([{status:'IN_PROGRESS'},{state:'FAILURE'}]),'failed');
  assert.equal(checkSummary([{status:'QUEUED'}]),'pending');
  assert.equal(checkSummary([{status:'COMPLETED',conclusion:null}]),'unknown');
  assert.equal(checkSummary([{state:'SUCCESS'},{status:'COMPLETED',conclusion:'SKIPPED'}]),'passed');
});
test('background Git enrichment never holds task status behind cold or slow workspace reads',{timeout:1000},async()=>{
  let release;const waiting=new Promise(resolve=>release=resolve);let calls=0,now=0,branch='feature';
  const reader=createGitStatusReader({clock:()=>now,run:async(name,args)=>{
    calls++;await waiting;
    if(name==='gh')return '[]';
    if(args.includes('rev-parse'))return sha;
    if(args.includes('symbolic-ref'))return branch;
    return 'https://github.com/example/board';
  }});
  try{
    const first=await reader.enrich(board,{waitForFresh:false});assert.equal(first.tasks[0].git.status,'loading');assert.equal(first.tasks[2].git,null);
    await reader.enrich(board,{waitForFresh:false});assert.equal(calls,3);
    release();await reader.settle();
    const fresh=await reader.enrich(board,{waitForFresh:false});assert.equal(fresh.tasks[0].git.branch,'feature');
    branch='other';now=30001;
    const cached=await reader.enrich(board,{waitForFresh:false});assert(cached.tasks[0].git.refreshing);assert.equal(cached.tasks[0].git.branch,'feature');
    await reader.settle();assert.equal((await reader.enrich(board,{waitForFresh:false})).tasks[0].git.branch,'other');
  }finally{release();await reader.settle();}
});
test('real Git reads track branch changes and detached HEAD without changing repository content',async()=>{
  const cwd=await mkdtemp(join(tmpdir(),'kanban-git-'));
  const git=args=>execFileSync('git',['-C',cwd,...args],{stdio:'pipe'}).toString().trim();
  let now=0;const reader=createGitStatusReader({clock:()=>now});
  const read=()=>reader.enrich({tasks:[{id:'fixture',hostId:'local',cwd}]}).then(b=>b.tasks[0].git);
  try{
    git(['init','--initial-branch=feature']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-m','fixture']);
    const first=await read();assert.equal(first.branch,'feature');assert.equal(first.pullRequests.status,'unsupported');
    git(['switch','--detach']);now=30001;
    const detached=await read();assert.equal(detached.branch,null);assert.equal(detached.sha,first.sha);
    assert.equal(detached.pullRequests.status,'detached');
    assert.equal(git(['status','--porcelain']),'');
    const missing=await reader.enrich({tasks:[{id:'missing',hostId:'local',cwd:join(cwd,'missing')}]});
    assert.equal(missing.tasks[0].git.status,'unavailable');
  }finally{await rm(cwd,{recursive:true,force:true});}
});

const html=readFileSync(new URL('./ui.html',import.meta.url),'utf8');
const helpers=html.match(/function gitDisplay\([\s\S]*?(?=function makeCard)/)[0];
function browser(){
  const meta={children:[],append(...children){this.children.push(...children);}};
  const data={tasks:[]};
  const api=new Script(helpers+'\n({gitDisplay,appendGitDetail,expireGitSnapshots})').runInContext(createContext({DATA:data,
    $:()=>meta,el:(tag,cls,text)=>({tag,className:cls,textContent:text,children:[],append(...children){this.children.push(...children);}})
  }));
  return {api,meta,data};
}
test('browser qualifies stale results, rejects unsafe links and omits detached branch names',async()=>{
  const f=fixture(),task=(await f.read()).tasks[0],{api}=browser();
  const display=api.gitDisplay(task,91000);assert(display.cached);assert(display.gitCached);
  task.git.branch=null;assert.equal(api.gitDisplay(task,0).branch,null);
  assert.equal(api.gitDisplay(task,0).items.length,0);
  assert.equal(api.gitDisplay(task,0).message,'PR not linked');
  task.git.branch='codex/feature';
  task.git.pullRequests.items[0].url='javascript:alert(1)';assert.equal(api.gitDisplay(task,0).items.length,0);
  assert.equal(api.gitDisplay({...task,hostId:'remote'},0),null);
});
test('details expose matching source, CI/review, timestamp and safe external PR link',async()=>{
  const task=(await fixture().read()).tasks[0],{api,meta}=browser();
  api.appendGitDetail(task);
  assert(meta.children.some(n=>n.textContent==='Repository + current branch'));
  assert(meta.children.some(n=>n.textContent==='Passed / Approved'));
  const link=meta.children.flatMap(n=>n.children).find(n=>n.tag==='a');
  assert.equal(link.href,pr.url);assert.equal(link.target,'_blank');assert.equal(link.rel,'noopener noreferrer');
  const snapshot={threads:[{...task,kind:'codex'}]};assert.deepEqual(normalize(snapshot).tasks[0].git,task.git);
});
test('static and disconnected pages trigger a cached redraw after expiry only once',async()=>{
  const task=(await fixture().read()).tasks[0],{api,data}=browser();data.tasks=[task];
  assert.equal(api.expireGitSnapshots(89000),false);
  assert.equal(api.expireGitSnapshots(91000),true);
  assert.equal(api.gitDisplay(task,91000).cached,true);
  assert.equal(api.expireGitSnapshots(92000),false);
});
