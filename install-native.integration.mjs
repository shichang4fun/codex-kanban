// Exercise the actual CLI, installed package and proxy in a disposable CODEX_HOME.
// No Desktop tool calls, model turns or existing user task changes.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {installKanban} from './install.mjs';
import {readDesktopBridgeConfig} from './setup-desktop-bridge.mjs';
import {desktopBridgeRequest} from './bridge-transport.mjs';

const root=await mkdtemp(join(tmpdir(),'kb-in-')),home=join(root,'home');
const source=process.env.KANBAN_MARKETPLACE_SOURCE||resolve('dist/marketplace');
const ref=process.env.KANBAN_MARKETPLACE_REF||null;
let child,buffer='',sequence=0,diagnostic='';const pending=new Map();
function request(method,params={}){
  const id=++sequence;
  return new Promise((resolve,reject)=>{
    pending.set(id,{resolve,reject,timer:setTimeout(()=>{pending.delete(id);reject(Error('RPC timeout: '+method));},30000)});
    child.stdin.write(JSON.stringify({id,method,params})+'\n');
  });
}
try{
  await mkdir(home,{mode:0o700});
  const options={home,marketplaceSource:source,ref};
  const installed=await installKanban(options);
  const config=await readDesktopBridgeConfig(join(home,'kanban-desktop'));
  assert(!('contextThreadId' in config));
  assert.equal(config.codexHome,home);
  const manifest=JSON.parse(await readFile(join(installed.pluginPath,'plugin.json'),'utf8'));
  assert.equal(installed.version,manifest.version);
  const reinstalled=await installKanban(options);assert.equal(reinstalled.version,installed.version);
  assert.equal((await readDesktopBridgeConfig(config.root)).chainedCli,config.chainedCli);
  child=spawn(config.proxy,['--disable','hooks','app-server','--listen','stdio://'],{
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
  assert.equal((await desktopBridgeRequest(config.socketPath,'status')).connected,false);
  const context=await request('thread/start',{cwd:root,ephemeral:true,approvalPolicy:'never',sandbox:'read-only'});
  assert(context.thread?.id);
  assert.equal((await desktopBridgeRequest(config.socketPath,'status')).connected,true);
  const status=await request('mcpServerStatus/list',{limit:100,threadId:context.thread.id});
  const entry=status.data?.find(server=>server.name.includes('codex-kanban'));
  assert(entry,'Installed plugin was not discovered. '+diagnostic.slice(-2000));
  assert.equal(Object.keys(entry.tools).length,12);
  assert.equal(entry.serverInfo.version,manifest.version);
  assert(Object.values(entry.tools).every(tool=>tool._meta.ui.visibility[0]==='app'));
  console.log(`PASS: native installer ${installed.version}, repeat install, private bridge, dynamic context and 12 app-only tools; zero model turns.`);
}finally{
  for(const operation of pending.values())clearTimeout(operation.timer);
  if(child&&child.exitCode===null){const ended=once(child,'exit');child.stdin.end();child.kill();await ended;}
  await rm(root,{recursive:true,force:true});
}
