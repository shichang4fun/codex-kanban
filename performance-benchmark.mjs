// Read-only benchmark: real MCP UI, synthetic tasks, no native task writes.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {cpus,platform,arch} from 'node:os';
import {performance} from 'node:perf_hooks';
import {dirname} from 'node:path';
import {chromium} from '@playwright/test';
import {createLocalBoard} from './local-board.mjs';
import {createDesktopRuntime,readBoardRuntime} from './desktop-runtime.mjs';

const sizes=(process.env.KANBAN_BENCH_SIZES??'50,200,1000').split(',').map(Number);
const samples=Number(process.env.KANBAN_BENCH_SAMPLES??15);
assert(sizes.every(n=>Number.isInteger(n)&&n>0&&n<=5000));
assert(Number.isInteger(samples)&&samples>=5&&samples<=100);
const output=process.env.KANBAN_BENCH_OUTPUT??'performance-results/latest.json';
const uuid=index=>'22222222-2222-4222-8222-'+String(index).padStart(12,'0');
function stats(values){
  const sorted=[...values].sort((a,b)=>a-b);
  return {samples:values.length,p50Ms:sorted[Math.ceil(sorted.length*.5)-1],p95Ms:sorted[Math.ceil(sorted.length*.95)-1],maxMs:sorted.at(-1)};
}
async function measure(operation){
  for(let i=0;i<3;i++)await operation();
  const values=[];
  for(let i=0;i<samples;i++){const start=performance.now();await operation();values.push(performance.now()-start);}
  return stats(values);
}
async function backend(count){
  const sections=['For Later','In Progress','For Review','Pinned'].map((name,i)=>({id:'group-'+i,name}));
  const rows=Array.from({length:count},(_,i)=>({id:uuid(i),name:'Synthetic task '+i,preview:'Synthetic preview',cwd:'/fixture',
    ephemeral:false,parentThreadId:null,projectId:null,updatedAt:1700000000+i,section:sections[i%4]}));
  let calls=0;
  const reader={async request(method,params){
    calls++;
    if(method==='project/list')return {data:[]};
    if(method==='threadSection/list')return {data:sections};
    assert.equal(method,'thread/list');
    const all=params.sectionId?rows.filter(t=>t.section.id===params.sectionId):rows;
    const start=Number(params.cursor??0),data=all.slice(start,start+params.limit);
    return {data,nextCursor:params.sectionId&&start+data.length<all.length?String(start+data.length):null};
  }};
  const local=createLocalBoard(reader,{threads:[],sections:[],projects:[]});
  const normalize=await measure(async()=>{const value=await local.getBoard();assert.equal(value.tasks.length,count);});
  calls=0;const board=await local.getBoard();const metadataCalls=calls;
  const runtime=[];
  for(const rpcDelayMs of [0,5,20]){
    let threadReads=0,batches=0,active=0,maxConcurrent=0;
    const desktop=createDesktopRuntime({request:async(_method,{threadId})=>{
      threadReads++;active++;maxConcurrent=Math.max(maxConcurrent,active);
      if(rpcDelayMs)await new Promise(resolve=>setTimeout(resolve,rpcDelayMs));
      active--;return {thread:{id:threadId,ephemeral:false,parentThreadId:null,status:{type:'idle'}}};
    }});
    const start=performance.now();
    const value=await readBoardRuntime(board,'synthetic',{request:async(_socket,method,params)=>{
      assert.equal(method,'runtime');batches++;return desktop.read(params);
    }});
    assert.equal(value.tasks.filter(t=>t.runtimeStatusSource==='desktopRuntime').length,count);
    assert.equal(threadReads,count);assert.equal(batches,Math.ceil(count/100));assert(maxConcurrent<=4);
    runtime.push({rpcDelayMs,totalMs:performance.now()-start,threadReads,batches,maxConcurrent});
  }
  return {count,metadataAssembly:normalize,metadataCalls,runtime};
}
async function fixture(count){
  const child=spawn(process.execPath,['mcp-browser.integration.mjs'],{
    env:{...process.env,KANBAN_TEST_PORT:'0',KANBAN_TEST_TASK_COUNT:String(count)},stdio:['ignore','pipe','pipe']
  });
  const stopped=once(child,'exit');let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);
  try{
    const url=await new Promise((resolve,reject)=>{
      let text='';const timer=setTimeout(()=>reject(Error('Fixture startup timed out: '+stderr)),30000);
      child.once('error',error=>{clearTimeout(timer);reject(error);});
      child.once('exit',()=>{clearTimeout(timer);reject(Error('Fixture exited: '+stderr));});
      child.stdout.on('data',chunk=>{text+=chunk;const match=text.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});
    });
    return {url,async close(){child.kill('SIGTERM');await stopped;}};
  }catch(error){child.kill('SIGTERM');await stopped;throw error;}
}
async function frontend(browser,count,reducedMotion){
  const host=await fixture(count);
  const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.goto(host.url);
    const start=performance.now();
    await page.getByRole('button',{name:'Codex Kanban',exact:true}).click();
    const frame=page.frameLocator('iframe');
    await frame.locator('.card').last().waitFor();
    assert.equal(await frame.locator('.card').count(),count);
    const openToCardsMs=performance.now()-start;
    const measured=await frame.locator('body').evaluate(async(_body,{samples,count})=>{
      const stat=values=>{const s=[...values].sort((a,b)=>a-b);return {samples:s.length,p50Ms:s[Math.ceil(s.length*.5)-1],p95Ms:s[Math.ceil(s.length*.95)-1],maxMs:s.at(-1)};};
      const paint=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const run=async(operation,expectedCount=count)=>{
        const values=[];
        for(let i=0;i<samples+3;i++){
          const start=performance.now();operation();document.querySelector('#board').getBoundingClientRect();
          const duration=performance.now()-start;
          if(document.querySelectorAll('.card').length!==expectedCount)throw Error('Unexpected rendered task count');
          if(i>=3)values.push(duration);await paint();
        }
        return stat(values);
      };
      // Prevent timed polling from contaminating CPU measurements. Restore below.
      const originalRefresh=refreshNativeBoard;refreshNativeBoard=async()=>{};
      try{
        await paint();
        const board=structuredClone(DATA),results={};
        results.boardRender=await run(()=>render());
        results.domNodes=document.querySelectorAll('#board *').length;
        results.listRender=await run(()=>setView('list'));
        setView('board');
        projectViews.set(projectViewKey('group-0'),true);
        results.projectRender=await run(()=>render());
        projectViews.set(projectViewKey('group-0'),false);render();
        const node=document.querySelector('.card');
        results.unchangedRefresh=await run(()=>applyNativeBoard(structuredClone(board),{skipUnchanged:true}));
        results.unchangedPreservesNodes=node===document.querySelector('.card');
        if(!results.unchangedPreservesNodes)throw Error('Unchanged refresh rebuilt cards');
        let index=0;
        results.oneTaskChanged=await run(()=>{
          const next=structuredClone(board);next.tasks[0].title='Changed title '+(++index);applyNativeBoard(next,{skipUnchanged:true});
        });
        collapsed.add(groupingMode+':group-0');render();
        results.collapsedDomNodes=document.querySelectorAll('#board *').length;
        results.collapsedRender=await run(()=>render());
        collapsed.clear();render();
        results.searchAll=await run(()=>{
          document.querySelector('#search').value='Synthetic scrolling';document.querySelector('#search').dispatchEvent(new Event('input',{bubbles:true}));
        },count-1);
        results.searchNone=await run(()=>{
          document.querySelector('#search').value='no-such-task';document.querySelector('#search').dispatchEvent(new Event('input',{bubbles:true}));
        },0);
        document.querySelector('#search').value='';render();
        const options={timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false};
        const formatter=new Intl.DateTimeFormat('en-US',options),time=DATA.tasks[0].updatedAt;
        if(date(time)!==formatter.format(new Date(time*1000)))throw Error('Date formatting mismatch');
        const originalDate=date;
        const beforeTimeText=[...document.querySelectorAll('.time')].map(node=>[node.textContent,node.title,node.getAttribute('aria-label')]);
        try{
          date=ts=>ts?formatter.format(new Date(ts*1000)):'Unknown time';
          results.boardRenderWithReusedFormatter=await run(()=>render());
          const afterTimeText=[...document.querySelectorAll('.time')].map(node=>[node.textContent,node.title,node.getAttribute('aria-label')]);
          if(JSON.stringify(beforeTimeText)!==JSON.stringify(afterTimeText))throw Error('Reused formatter changed card text');
        }finally{date=originalDate;}
        const values={current:[],reuseFormatter:[]};
        for(let i=0;i<samples+3;i++)for(const name of ['current','reuseFormatter']){
          const start=performance.now();for(const task of DATA.tasks)for(let k=0;k<3;k++){
            if(name==='current')date(task.updatedAt);else formatter.format(new Date(task.updatedAt*1000));
          }
          if(i>=3)values[name].push(performance.now()-start);
          await paint();
        }
        results.dateFormatting={current:stat(values.current),reuseFormatter:stat(values.reuseFormatter)};
        results.navigation=performance.getEntriesByType('navigation')[0]?.toJSON();
        results.paint=performance.getEntriesByType('paint').map(e=>({name:e.name,startTime:e.startTime}));
        return results;
      }finally{refreshNativeBoard=originalRefresh;}
    },{samples,count});
    assert.deepEqual(errors,[]);
    const status=await(await fetch(host.url+'/status')).json();
    assert.equal(status.moves.length,0);assert.equal(status.archived,false);assert.deepEqual(status.navigationUrls,[]);
    return {count,reducedMotion,openToCardsMs,...measured,pageErrors:errors,nativeWrites:status.moves.length};
  }finally{await context.close();await host.close();}
}

const report={capturedAt:new Date().toISOString(),environment:{node:process.version,platform:platform(),arch:arch(),cpu:cpus()[0]?.model},
  samples,sizes,scope:'Synthetic MCP SDK host and production UI; metadata/runtime RPC timing is simulated, no native writes.',backend:[],frontend:[]};
const browser=await chromium.launch();report.environment.chromium=browser.version();
try{
  for(const count of sizes){
    report.backend.push(await backend(count));
    const result=await frontend(browser,count,'reduce');report.frontend.push(result);
    console.log(JSON.stringify({count,board:result.boardRender.p50Ms,changed:result.oneTaskChanged.p50Ms,unchanged:result.unchangedRefresh.p50Ms}));
  }
  report.frontend.push(await frontend(browser,sizes.at(-1),'no-preference'));
  const html=await readFile('dist/kanban-ui.html');report.uiBytes=html.length;
  await mkdir(dirname(output),{recursive:true});
  await writeFile(output,JSON.stringify(report,null,2)+'\n');
  console.log('Performance results: '+output);
}finally{await browser.close();}
