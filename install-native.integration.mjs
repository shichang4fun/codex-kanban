// Exercise the actual CLI, installed package and proxy in a disposable CODEX_HOME.
// No Desktop tool calls, model turns or existing user task changes.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,readFile,realpath} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {join,resolve} from 'node:path';
import {installKanban} from './install.mjs';
import {readDesktopBridgeConfig,installDesktopBridge} from './setup-desktop-bridge.mjs';
import {desktopBridgeRequest} from './bridge-transport.mjs';

// Canonicalize macOS /tmp without exceeding the Unix-domain socket path limit.
const root=await realpath(await mkdtemp('/tmp/kb-in-')),home=join(root,'home');
const source=process.env.KANBAN_MARKETPLACE_SOURCE||resolve('dist/marketplace');
const ref=process.env.KANBAN_MARKETPLACE_REF||null;
let child,buffer='',sequence=0,diagnostic='';const pending=new Map();
// Exercise the real installed shim, but keep GUI launchd completely isolated.
const jobs=new Map();let guiCli='';
function run(bin,args,options){
  if(bin!=='/bin/launchctl')return execFileSync(bin,args,options);
  if(args[0]==='getenv')return Buffer.from(guiCli);
  if(args[0]==='setenv'){guiCli=args[2];return '';}
  if(args[0]==='unsetenv'){guiCli='';return '';}
  if(args[0]==='bootstrap'){
    const text=readFileSync(args[2],'utf8'),label=text.match(/<key>Label<\/key><string>(.*?)<\/string>/)[1];
    const argv=[...text.match(/<key>ProgramArguments<\/key><array>(.*?)<\/array>/s)[1].matchAll(/<string>(.*?)<\/string>/g)].map(m=>m[1].replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>'));
    jobs.set(`${args[1]}/${label}`,`${args[1]}/${label} = {\n\tpath = ${args[2]}\n\tprogram = ${argv[0]}\n\targuments = {\n${argv.map(a=>'\t\t'+a).join('\n')}\n\t}\n}\n`);return '';
  }
  if(args[0]==='print'){if(!jobs.has(args[1]))throw Error('No fixture job');return Buffer.from(jobs.get(args[1]));}
  if(args[0]==='bootout'){jobs.delete(args[1]);return '';}
  throw Error('Unexpected fixture launchctl action');
}
function request(method,params={}){
  const id=++sequence;
  return new Promise((resolve,reject)=>{
    pending.set(id,{resolve,reject,timer:setTimeout(()=>{pending.delete(id);reject(Error('RPC timeout: '+method));},30000)});
    child.stdin.write(JSON.stringify({id,method,params})+'\n');
  });
}
try{
  await mkdir(home,{mode:0o700});
  const options={home,homeDir:root,marketplaceSource:source,ref,run};
  const installed=await installKanban(options);
  let config=await readDesktopBridgeConfig(join(home,'kanban-desktop'));
  // No access to the user's Sidebar configuration from this acceptance fixture.
  config=await installDesktopBridge({...config,chainedCli:join(config.app,'Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex')});
  assert(!('contextThreadId' in config));
  assert.equal(config.codexHome,home);
  assert.equal(config.autoFlow,true);
  const flowSettings=JSON.parse(await readFile(join(config.root,'flow.json'),'utf8'));
  assert.equal(flowSettings.enabled,true);assert.equal(flowSettings.policy.mode,'all-local');
  const manifest=JSON.parse(await readFile(join(installed.pluginPath,'plugin.json'),'utf8'));
  assert.equal(installed.version,manifest.version);
  const reinstalled=await installKanban(options);assert.equal(reinstalled.version,installed.version);
  assert.equal((await readDesktopBridgeConfig(config.root)).chainedCli,config.chainedCli);
  assert.equal(jobs.size,1);assert.equal(guiCli,reinstalled.startup.shim);
  child=spawn(guiCli,['--disable','hooks','app-server','--listen','stdio://'],{
    env:{...process.env,CODEX_HOME:home},stdio:['pipe','pipe','pipe']});
  child.stderr.on('data',data=>diagnostic+=data);
  child.stdout.on('data',data=>{
    buffer+=data;let end;
    while((end=buffer.indexOf('\n'))>=0){
      const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let message;
      try{message=JSON.parse(line);}catch{continue;}
      const operation=pending.get(message.id);if(!operation)continue;
      pending.delete(message.id);clearTimeout(operation.timer);
      if(message.error)operation.reject(Error('RPC error: '+message.error.code));else operation.resolve(message.result);
    }
  });
  await request('initialize',{clientInfo:{name:'kanban_installer_acceptance',version:'1'},capabilities:{experimentalApi:true}});
  child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
  await assert.rejects(desktopBridgeRequest(config.socketPath,'status'),{status:503});
  const transient=await request('thread/start',{cwd:root,ephemeral:true,approvalPolicy:'never',sandbox:'read-only'});
  assert(transient.thread?.id);
  await assert.rejects(desktopBridgeRequest(config.socketPath,'status'),{status:503});
  const context=await request('thread/start',{cwd:root,ephemeral:false,approvalPolicy:'never',sandbox:'read-only'});
  assert(context.thread?.id);
  for(let attempt=0;attempt<50;attempt++){
    try{if((await desktopBridgeRequest(config.socketPath,'status')).connected)break;}
    catch(error){if(error.status!==503)throw error;}
    await delay(100);
  }
  assert.equal((await desktopBridgeRequest(config.socketPath,'status')).connected,true);
  const flowStatus=(await desktopBridgeRequest(config.socketPath,'status')).autoFlow;
  assert.equal(flowStatus.available,true);assert.equal(flowStatus.enabled,true);assert.equal(flowStatus.mode,'all-local');
  assert.equal((await desktopBridgeRequest(config.socketPath,'flowSettings',{enabled:false})).autoFlow.enabled,false);
  assert.equal(JSON.parse(await readFile(join(config.root,'flow.json'),'utf8')).enabled,false);
  // This isolated App Server has no GUI tool dispatcher. Failed initialization
  // must preserve the disabled policy instead of claiming readiness.
  await assert.rejects(desktopBridgeRequest(config.socketPath,'flowSettings',{enabled:true}),{status:409});
  const enabledFlow=(await desktopBridgeRequest(config.socketPath,'status')).autoFlow;
  assert.equal(enabledFlow.enabled,false);assert.equal(enabledFlow.initialization.state,'error');
  assert.equal(JSON.parse(await readFile(join(config.root,'flow.json'),'utf8')).enabled,false);
  const status=await request('mcpServerStatus/list',{limit:100,threadId:context.thread.id});
  const candidates=status.data?.filter(server=>server.name.includes('codex-kanban'))??[];
  const entry=candidates.find(server=>server.serverInfo?.version===manifest.version);
  assert(entry,'Installed plugin was not discovered. '+JSON.stringify(candidates.map(({name,serverInfo})=>({name,version:serverInfo?.version})))+' '+diagnostic.slice(-2000));
  assert.equal(Object.keys(entry.tools).length,14);
  assert.equal(entry.serverInfo.version,manifest.version);
  assert(Object.values(entry.tools).every(tool=>tool._meta.ui.visibility[0]==='app'));
  console.log(`PASS: native installer ${installed.version}, repeat install, original-icon shim, single simulated login agent, private bridge, dynamic context and 14 app-only tools; zero model turns, no GUI launchd changes.`);
}finally{
  for(const operation of pending.values())clearTimeout(operation.timer);
  if(child&&child.exitCode===null){const ended=once(child,'exit');child.stdin.end();child.kill();await ended;}
  await rm(root,{recursive:true,force:true});
}
