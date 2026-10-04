import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {isAbsolute} from 'node:path';
import {startDesktopArchiveBridge} from './desktop-archive.mjs';

// Preserve Desktop's original stdio handshake and RPC IDs. Added calls can only
// call a small tool whitelist. Explicit create_thread is the sole new-task
// entry point; arbitrary model execution methods remain unavailable.
export function createDesktopRelay({toServer,toDesktop,timeoutMs=35000}){
  const prefix='kanban:'+randomUUID()+':',pending=new Map();
  let ready=false,initializeId,sequence=0,contextThreadId=null;const loading=new Set();
  function send(method,params){
    if(!ready)return Promise.reject(Error('Desktop handshake not ready'));
    if(pending.size>=8)return Promise.reject(Error('Bridge busy'));
    const id=prefix+(++sequence);
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(id);reject(Error('Desktop RPC timeout'));},timeoutMs);
      pending.set(id,{resolve,reject,timer});
      try{toServer({id,method,params});}catch(error){pending.delete(id);clearTimeout(timer);reject(error);}
    });
  }
  return {
    get ready(){return ready;},
    get contextThreadId(){return contextThreadId;},
    fromDesktop(message){
      if(message.method==='initialize')initializeId=message.id;
      if(['thread/start','thread/resume'].includes(message.method)&&message.id!=null&&loading.size<64)loading.add(message.id);
      toServer(message);
    },
    fromServer(message){
      if(initializeId!==undefined&&message.id===initializeId&&!message.method)ready=!message.error;
      if(!message.method&&loading.delete(message.id)&&!message.error&&typeof message.result?.thread?.id==='string')contextThreadId=message.result.thread.id;
      if(typeof message.id==='string'&&message.id.startsWith(prefix)&&!message.method){
        const operation=pending.get(message.id);if(!operation)return;
        pending.delete(message.id);clearTimeout(operation.timer);message.error?operation.reject(Error('Desktop RPC failed')):operation.resolve(message.result);return;
      }
      toDesktop(message);
    },
    call(tool,args,contextThreadId){
      if(!['list_threads','read_thread','list_projects','create_thread','set_thread_archived','move_thread_to_sidebar_section'].includes(tool))return Promise.reject(Error('Tool not allowed'));
      return send('mcpServer/tool/call',{threadId:contextThreadId,server:'codex_app',tool,arguments:args}).then(result=>{
        const blocks=result?.content?.filter(block=>block.type==='text');
        if(result?.isError||blocks?.length!==1)throw Error('Invalid Desktop tool reply');
        return JSON.parse(blocks[0].text);
      });
    },
    request(method,params){
      if(method!=='thread/read'||params?.includeTurns!==false||typeof params?.threadId!=='string')
        return Promise.reject(Error('Runtime method not allowed'));
      return send(method,{threadId:params.threadId,includeTurns:false});
    },
    close(){ready=false;contextThreadId=null;loading.clear();for(const operation of pending.values()){clearTimeout(operation.timer);operation.reject(Error('Desktop connection closed'));}pending.clear();}
  };
}
function jsonLines(stream,accept,raw){
  stream.setEncoding('utf8');let buffer='';
  stream.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{accept(JSON.parse(line));}catch{raw(line+'\n');}}});
  stream.once('end',()=>{if(buffer)raw(buffer);});
}
export async function startDesktopProxy(){
  const executable=process.env.KANBAN_REAL_CODEX;
  if(!executable||!isAbsolute(executable)||realpathSync(executable)===realpathSync(fileURLToPath(import.meta.url)))throw Error('Native CLI required');
  const args=process.argv.slice(2),index=args.indexOf('app-server');
  const attached=index>=0&&!['daemon','proxy','generate-ts','generate-json-schema'].includes(args[index+1])&&!args.includes('--help');
  if(!attached){const child=spawn(executable,args,{stdio:'inherit'});child.once('exit',code=>process.exitCode=code??1);return;}
  const env={...process.env,CODEX_CLI_PATH:executable};
  for(const key of Object.keys(env))if(key.startsWith('KANBAN_')||key.startsWith('SIDEBAR_FLOW_'))delete env[key];
  const child=spawn(executable,args,{stdio:['pipe','pipe','inherit'],env});
  const relay=createDesktopRelay({toServer:message=>child.stdin.write(JSON.stringify(message)+'\n'),toDesktop:message=>process.stdout.write(JSON.stringify(message)+'\n')});
  jsonLines(process.stdin,relay.fromDesktop,value=>child.stdin.write(value));
  jsonLines(child.stdout,relay.fromServer,value=>process.stdout.write(value));
  let stopBridge,ended=false;
  process.stdin.once('end',()=>child.stdin.end());
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>child.kill(signal));
  child.once('error',()=>{ended=true;relay.close();stopBridge?.();process.exitCode=1;});
  child.once('exit',(code,signal)=>{ended=true;relay.close();stopBridge?.();process.exitCode=code??(signal?1:0);});
  child.stdin.on('error',()=>relay.close());process.stdout.on('error',()=>{relay.close();child.kill();});
  try{stopBridge=await startDesktopArchiveBridge({socketPath:process.env.KANBAN_BRIDGE_SOCKET,
    ready:()=>relay.ready&&relay.contextThreadId!==null,call:(tool,args)=>relay.call(tool,args,relay.contextThreadId),
    request:(method,params)=>relay.request(method,params)});}
  catch{process.stderr.write('KANBAN_BRIDGE_NOT_STARTED\n');}
  if(ended)await stopBridge?.();
}
if(process.argv[1]&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url)))startDesktopProxy().catch(()=>{process.stderr.write('KANBAN_PROXY_START_FAILED\n');process.exitCode=1;});
