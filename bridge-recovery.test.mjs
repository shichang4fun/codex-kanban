import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,lstat,writeFile,symlink,readlink,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createConnection} from 'node:net';
import {startLocalBridge,desktopBridgeRequest} from './bridge-transport.mjs';
import {maintainDesktopBridge} from './desktop-proxy.mjs';
import {installFlowSettings} from './flow-config.mjs';

const module=fileURLToPath(new URL('./bridge-transport.mjs',import.meta.url));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function fixture(t){
  const root=await mkdtemp('/tmp/kb-recovery-');t.after(()=>rm(root,{recursive:true,force:true}));
  return {root,socketPath:join(root,'d.sock')};
}
async function until(check){
  const deadline=Date.now()+10000;
  while(Date.now()<deadline){if(await check())return;await delay(20);}
  assert.fail('Recovery condition timed out');
}
async function owner(t,socketPath){
  const code=`import {startLocalBridge} from ${JSON.stringify(module)};await startLocalBridge({socketPath:process.argv[1],dispatch:()=>({owner:process.pid})});console.log('ready');`;
  const child=spawn(process.execPath,['--input-type=module','-e',code,socketPath],{stdio:['ignore','pipe','pipe']});
  let ready=false,error='';child.stdout.on('data',()=>ready=true);child.stderr.on('data',data=>error+=data);
  t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill('SIGKILL');await exited;}});
  await until(()=>{assert.equal(child.exitCode,null,error);return ready;});return child;
}
async function kill(child){const exited=once(child,'exit');child.kill('SIGKILL');await exited;}

test('a killed owner leaves a stale socket that the next bridge safely recovers',async t=>{
  const {socketPath}=await fixture(t),child=await owner(t,socketPath);await kill(child);
  assert((await lstat(socketPath)).isSocket());
  const stop=await startLocalBridge({socketPath,dispatch:()=>({connected:true})});t.after(stop);
  assert.equal((await desktopBridgeRequest(socketPath,'status')).connected,true);
  assert.equal((await lstat(socketPath)).mode&0o777,0o600);
});

test('simultaneous reconnects recover one socket and preserve the live winner',async t=>{
  const {socketPath}=await fixture(t),child=await owner(t,socketPath);await kill(child);
  const results=await Promise.allSettled(Array.from({length:8},(_,owner)=>startLocalBridge({socketPath,dispatch:()=>({owner})})));
  const winners=results.filter(result=>result.status==='fulfilled');assert.equal(winners.length,1);t.after(winners[0].value);
  const first=await desktopBridgeRequest(socketPath,'status'),inode=(await lstat(socketPath)).ino;
  await assert.rejects(startLocalBridge({socketPath,dispatch:()=>({owner:'replacement'})}),{code:'EADDRINUSE'});
  assert.equal((await lstat(socketPath)).ino,inode);assert.deepEqual(await desktopBridgeRequest(socketPath,'status'),first);
});

test('independent proxies contend for an abandoned startup lock and automatically take over after a crash',async t=>{
  const {socketPath}=await fixture(t),previous=await owner(t,socketPath);await kill(previous);
  await symlink(previous.pid+':11111111-1111-4111-8111-111111111111',socketPath+'.lock');
  const proxyModule=fileURLToPath(new URL('./desktop-proxy.mjs',import.meta.url)),children=[];
  const code=`import {startLocalBridge} from ${JSON.stringify(module)};import {maintainDesktopBridge} from ${JSON.stringify(proxyModule)};
setInterval(()=>{},10000);maintainDesktopBridge({ready:()=>true,retryMs:20,start:()=>startLocalBridge({socketPath:process.argv[1],dispatch:()=>({owner:process.pid})})}).ensure();`;
  t.after(async()=>{await Promise.all(children.map(child=>child.exitCode===null&&child.signalCode===null?kill(child):null));});
  for(let n=0;n<6;n++){
    const child=spawn(process.execPath,['--input-type=module','-e',code,socketPath],{stdio:'ignore'});children.push(child);
  }
  let first;
  await until(async()=>{try{first=(await desktopBridgeRequest(socketPath,'status')).owner;return true;}catch{return false;}});
  const inode=(await lstat(socketPath)).ino;await delay(200);
  assert.equal((await desktopBridgeRequest(socketPath,'status')).owner,first);assert.equal((await lstat(socketPath)).ino,inode);
  await kill(children.find(child=>child.pid===first));
  await until(async()=>{try{return (await desktopBridgeRequest(socketPath,'status')).owner!==first;}catch{return false;}});
});

test('unsafe paths and foreign startup locks are preserved',async t=>{
  const {socketPath}=await fixture(t);await writeFile(socketPath,'keep',{mode:0o600});
  await assert.rejects(startLocalBridge({socketPath,dispatch(){}}),/unsafe/);assert.equal((await lstat(socketPath)).isFile(),true);
  await rm(socketPath);await symlink('/tmp/foreign',socketPath);
  await assert.rejects(startLocalBridge({socketPath,dispatch(){}}),/unsafe/);assert.equal(await readlink(socketPath),'/tmp/foreign');
  await rm(socketPath);await symlink('/tmp/foreign',socketPath+'.lock');
  await assert.rejects(startLocalBridge({socketPath,dispatch(){}}),/startup lock/);assert.equal(await readlink(socketPath+'.lock'),'/tmp/foreign');
});

test('a startup lock left by a dead process recovers without deleting a live claim',async t=>{
  const {socketPath}=await fixture(t),child=await owner(t,socketPath);await kill(child);
  await symlink(child.pid+':11111111-1111-4111-8111-111111111111',socketPath+'.lock');
  const stop=await startLocalBridge({socketPath,dispatch:()=>({connected:true})});t.after(stop);
  assert.equal((await desktopBridgeRequest(socketPath,'status')).connected,true);
  await symlink(process.pid+':22222222-2222-4222-8222-222222222222',socketPath+'.lock');
  await assert.rejects(startLocalBridge({socketPath,dispatch(){}}),{code:'EADDRINUSE'});
  assert.match(await readlink(socketPath+'.lock'),new RegExp('^'+process.pid+':'));
});

test('shutdown aborts idle and pending clients, does not replay actions, and is idempotent',async t=>{
  const {socketPath}=await fixture(t);let signal,calls=0,finish;
  const stop=await startLocalBridge({socketPath,dispatch:async(method,params,context)=>{
    calls++;signal=context.signal;await new Promise(resolve=>finish=resolve);return {done:true};
  }});t.after(stop);
  const idle=createConnection(socketPath);await once(idle,'connect');
  const result=desktopBridgeRequest(socketPath,'archive').catch(error=>error);await until(()=>calls===1);
  await Promise.race([stop(),delay(2000).then(()=>assert.fail('shutdown blocked on an open connection'))]);
  await until(()=>signal.aborted);assert.match((await result).message,/closed|disconnected/);finish();
  await stop();assert.equal(calls,1);assert.equal(await lstat(socketPath).catch(()=>null),null);idle.destroy();
});

test('standby retries only after a loaded context and takes over after owner exit',async t=>{
  const {socketPath}=await fixture(t);let ready=false,starts=0;
  const first=await startLocalBridge({socketPath,dispatch:()=>({owner:'first'})});t.after(first);
  const lifecycle=maintainDesktopBridge({ready:()=>ready,retryMs:20,start:()=>{
    starts++;return startLocalBridge({socketPath,dispatch:()=>({owner:'second'})});
  }});t.after(()=>lifecycle.stop());
  lifecycle.ensure();await delay(60);assert.equal(starts,0);
  ready=true;await lifecycle.ensure();assert.equal((await desktopBridgeRequest(socketPath,'status')).owner,'first');
  await first();await until(async()=>{try{return (await desktopBridgeRequest(socketPath,'status')).owner==='second';}catch{return false;}});
  assert(starts>=2);await lifecycle.stop();assert.equal(await lstat(socketPath).catch(()=>null),null);
});

test('shutdown while bridge startup is pending closes the eventual listener and cancels retries',async()=>{
  let resolve,closed=0,starts=0;const lifecycle=maintainDesktopBridge({ready:()=>true,retryMs:10,start:()=>{
    starts++;return new Promise(r=>resolve=r);
  }});
  const starting=lifecycle.ensure();await until(()=>resolve);const stopping=lifecycle.stop();
  resolve(async()=>closed++);await Promise.all([starting,stopping]);await delay(30);
  assert.equal(closed,1);assert.equal(starts,1);
});

test('native backend failure exits its proxy despite open Desktop stdin, and a new proxy reconnects',async t=>{
  const {root,socketPath}=await fixture(t),driver=join(root,'native.mjs');
  await writeFile(driver,`#!${process.execPath}
import readline from 'node:readline';
for await(const line of readline.createInterface({input:process.stdin})){
  const m=JSON.parse(line);if(m.method==='fail')process.exit(7);
  console.log(JSON.stringify({id:m.id,result:m.method==='thread/resume'?{thread:{id:m.params.threadId}}:{}}));
}
`,{mode:0o700});
  const proxies=[];t.after(async()=>{for(const child of proxies)if(child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}});
  async function launch(){
    const child=spawn(process.execPath,[fileURLToPath(new URL('./desktop-proxy.mjs',import.meta.url)),'app-server'],
      {env:{...process.env,KANBAN_REAL_CODEX:driver,KANBAN_BRIDGE_SOCKET:socketPath,KANBAN_FLOW_ROOT:''},stdio:['pipe','pipe','pipe']});
    proxies.push(child);child.stdout.resume();child.stderr.resume();
    child.stdin.write(JSON.stringify({id:1,method:'initialize'})+'\n'+JSON.stringify({id:2,method:'thread/resume',params:{threadId:'22222222-2222-4222-8222-222222222222'}})+'\n');
    await until(async()=>{try{return (await desktopBridgeRequest(socketPath,'status')).connected;}catch{return false;}});return child;
  }
  const first=await launch(),exit=once(first,'exit');first.stdin.write(JSON.stringify({id:3,method:'fail'})+'\n');
  assert.deepEqual(await Promise.race([exit,delay(3000).then(()=>assert.fail('Proxy remained alive after backend failure'))]),[7,null]);
  assert.equal(await lstat(socketPath).catch(()=>null),null);await launch();assert.equal((await desktopBridgeRequest(socketPath,'status')).connected,true);
});

test('only the elected proxy starts Auto organize, and a standby starts it after takeover',async t=>{
  const {root,socketPath}=await fixture(t),driver=join(root,'native.mjs'),trace=join(root,'requests.jsonl');
  await installFlowSettings(root);
  await writeFile(driver,`#!${process.execPath}
import readline from 'node:readline';import {appendFileSync} from 'node:fs';
for await(const line of readline.createInterface({input:process.stdin})){
  const m=JSON.parse(line);if(m.method==='fail')process.exit(7);
  appendFileSync(process.env.RECOVERY_TEST_TRACE,JSON.stringify({proxy:process.ppid,method:m.method})+'\\n');
  console.log(JSON.stringify({id:m.id,result:['thread/resume','thread/read'].includes(m.method)?{thread:{id:m.params.threadId,ephemeral:true,parentThreadId:null}}:{}}));
}
`,{mode:0o700});
  const children=[];t.after(async()=>{for(const child of children)if(child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}});
  for(let n=0;n<2;n++){
    const child=spawn(process.execPath,[fileURLToPath(new URL('./desktop-proxy.mjs',import.meta.url)),'app-server'],
      {env:{...process.env,KANBAN_REAL_CODEX:driver,KANBAN_BRIDGE_SOCKET:socketPath,KANBAN_FLOW_ROOT:root,RECOVERY_TEST_TRACE:trace},stdio:['pipe','pipe','pipe']});
    children.push(child);child.stdout.resume();child.stderr.resume();
    child.stdin.write(JSON.stringify({id:1,method:'initialize'})+'\n'+JSON.stringify({id:2,method:'thread/resume',params:{threadId:'22222222-2222-4222-8222-222222222222'}})+'\n');
  }
  const records=async()=>JSON.parse('['+(await readFile(trace,'utf8')).trim().split('\n').join(',')+']');
  await until(async()=>{try{const rows=await records();return rows.filter(r=>r.method==='thread/resume').length===2&&rows.some(r=>r.method==='thread/read');}catch{return false;}});
  await delay(100);const reads=(await records()).filter(r=>r.method==='thread/read');assert.equal(reads.length,1);
  assert.equal((await desktopBridgeRequest(socketPath,'status')).autoFlow.available,true);
  const elected=children.find(child=>child.pid===reads[0].proxy),exit=once(elected,'exit');
  elected.stdin.write(JSON.stringify({id:3,method:'fail'})+'\n');await exit;
  await until(async()=>{try{return (await records()).filter(r=>r.method==='thread/read').length===2;}catch{return false;}});
  const owners=(await records()).filter(r=>r.method==='thread/read').map(r=>r.proxy);assert.notEqual(owners[0],owners[1]);
  assert.equal((await desktopBridgeRequest(socketPath,'status')).connected,true);
});
