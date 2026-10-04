import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {realpathSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {isAbsolute} from 'node:path';
import {startDesktopArchiveBridge} from './desktop-archive.mjs';
import {startAutoFlow,createTransactionGate} from './flow-runtime.mjs';
import {bridgeError} from './bridge-transport.mjs';

// Capture at module load: updating files must not make an old process look current.
const bridgeVersion=(()=>{
  try{return JSON.parse(readFileSync(new URL('../connection.json',import.meta.url),'utf8')).pluginVersion??null;}
  catch{return null;}
})();

// Preserve Desktop's original stdio handshake and RPC IDs. Added calls can only
// call a small tool whitelist. Explicit create_thread is the sole new-task
// entry point; arbitrary model execution methods remain unavailable.
export function createDesktopRelay({toServer,toDesktop,timeoutMs=35000}){
  const prefix='kanban:'+randomUUID()+':',pending=new Map(),listeners=new Set(),contexts=new Set(),lists=new Map();
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
      if(['thread/start','thread/resume'].includes(message.method)&&message.params?.ephemeral!==true&&message.id!=null&&loading.size<64)loading.add(message.id);
      toServer(message);
    },
    fromServer(message){
      const wasReady=ready;
      if(initializeId!==undefined&&message.id===initializeId&&!message.method)ready=!message.error;
      let loadedContext=false;
      // Title generation also starts threads, then discards them. Only a
      // persistent top-level local chat can supply the Desktop tool context.
      const thread=message.result?.thread;
      if(!message.method&&loading.delete(message.id)&&!message.error&&typeof thread?.id==='string'
        &&thread.ephemeral===false&&thread.parentThreadId==null&&(thread.hostId===undefined||thread.hostId==='local')){
        contextThreadId=thread.id;loadedContext=true;
      }
      if(typeof message.id==='string'&&message.id.startsWith(prefix)&&!message.method){
        const operation=pending.get(message.id);if(!operation)return;
        pending.delete(message.id);clearTimeout(operation.timer);
        if(message.error)operation.reject(message.error.message?.startsWith('thread not found:')
          ?bridgeError('Desktop task context expired. Open a local chat and try again; the action was not repeated.')
          :Error('Desktop RPC failed'));
        else operation.resolve(message.result);
        return;
      }
      toDesktop(message);
      if(ready&&contextThreadId&&(loadedContext||!wasReady))for(const listener of contexts){try{Promise.resolve(listener(contextThreadId)).catch(()=>{});}catch{}}
      if(ready&&message.id==null&&message.method)for(const listener of listeners){
        try{Promise.resolve(listener(message)).catch(()=>{});}catch{}
      }
    },
    call(tool,args,contextThreadId){
      if(!['list_threads','read_thread','list_projects','create_thread','set_thread_archived','set_thread_title','move_thread_to_sidebar_section'].includes(tool))return Promise.reject(Error('Tool not allowed'));
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
    flowRequest(method,params={}){
      if(method==='mcpServer/tool/call'){
        const create=params.tool==='create_sidebar_section'&&params.arguments&&Object.keys(params.arguments).length===1
          &&['In Progress','For Review','For Later'].includes(params.arguments.name);
        if(params.server!=='codex_app'||!(['list_threads','read_thread','move_thread_to_sidebar_section'].includes(params.tool)||create)
          ||typeof params.threadId!=='string')return Promise.reject(Error('Auto organize tool not allowed'));
      }else if(!['thread/read','thread/list','thread/loaded/list','threadSection/list'].includes(method)
        ||method==='thread/read'&&(params.includeTurns!==false||typeof params.threadId!=='string'))
        return Promise.reject(Error('Auto organize method not allowed'));
      const key=method==='mcpServer/tool/call'&&params.tool==='list_threads'?JSON.stringify(params):null;
      if(key&&lists.has(key))return lists.get(key);
      const result=send(method,params);
      if(key){lists.set(key,result);result.finally(()=>{if(lists.get(key)===result)lists.delete(key);}).catch(()=>{});}
      return result;
    },
    subscribe(listener){listeners.add(listener);return ()=>listeners.delete(listener);},
    subscribeContext(listener){contexts.add(listener);if(ready&&contextThreadId)queueMicrotask(()=>{if(contexts.has(listener)){try{Promise.resolve(listener(contextThreadId)).catch(()=>{});}catch{}}});return ()=>contexts.delete(listener);},
    close(){ready=false;contextThreadId=null;loading.clear();listeners.clear();contexts.clear();lists.clear();for(const operation of pending.values()){clearTimeout(operation.timer);operation.reject(Error('Desktop connection closed'));}pending.clear();}
  };
}
function jsonLines(stream,accept,raw,onEnd=()=>{}){
  stream.setEncoding('utf8');let buffer='';
  stream.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{accept(JSON.parse(line));}catch{raw(line+'\n');}}});
  stream.once('end',()=>{if(buffer)raw(buffer);onEnd();});
}
// A standby proxy never replaces a live owner. It retries when a Desktop-loaded
// context is available, so a temporary bind conflict cannot disable the bridge.
export function maintainDesktopBridge({start,ready,report=()=>{},retryMs=1000}){
  let stopped=false,pending=null,stopBridge=null,timer=null,lastError=null,closing=null;
  function schedule(){if(!stopped){timer=setTimeout(()=>{timer=null;ensure();},retryMs);timer.unref();}}
  function ensure(){
    if(stopped||stopBridge||pending||!ready()){if(!stopped&&!stopBridge&&!pending&&!timer)schedule();return pending;}
    clearTimeout(timer);timer=null;
    pending=Promise.resolve().then(start).then(async stop=>{
      if(stopped)await stop();else{stopBridge=stop;lastError=null;report('KANBAN_BRIDGE_CONNECTED');}
    }).catch(error=>{
      const code=error.code??'START_FAILED';
      if(!stopped&&code!==lastError){lastError=code;report('KANBAN_BRIDGE_WAITING '+code);}
    }).finally(()=>{pending=null;if(!stopped&&!stopBridge)schedule();});
    return pending;
  }
  return {ensure,stop(){
    if(closing)return closing;
    stopped=true;clearTimeout(timer);timer=null;
    closing=Promise.resolve(pending).then(async()=>{const stop=stopBridge;stopBridge=null;await stop?.();});
    return closing;
  }};
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
  let bridge,autoFlow,ended=false;
  const diagnostic=value=>process.stderr.write(value+'\n');
  const stop=()=>{
    if(ended)return;
    ended=true;relay.close();autoFlow?.stop();process.stdin.destroy();
    bridge?.stop().catch(()=>diagnostic('KANBAN_BRIDGE_STOP_FAILED'));
  };
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>child.kill(signal));
  child.once('error',()=>{stop();process.exitCode=1;});
  child.once('exit',(code,signal)=>{diagnostic('KANBAN_NATIVE_EXIT code='+(code??'null')+' signal='+(signal??'none'));stop();process.exitCode=code??(signal?1:0);});
  child.stdin.on('error',()=>{stop();child.kill();});process.stdout.on('error',()=>{stop();child.kill();});
  const runExclusive=createTransactionGate();
  jsonLines(process.stdin,message=>{if(!ended)relay.fromDesktop(message);},value=>{if(!ended)child.stdin.write(value);},()=>{stop();child.stdin.end();});
  jsonLines(child.stdout,relay.fromServer,value=>process.stdout.write(value));
  const ready=()=>!ended&&relay.ready&&relay.contextThreadId!==null;
  const flow={status:()=>autoFlow?.status()??{available:false},change:enabled=>{
    if(!autoFlow)throw Error('Auto organize is not ready.');return autoFlow.change(enabled);
  }};
  bridge=maintainDesktopBridge({ready,report:diagnostic,start:async()=>{
    const stopBridge=await startDesktopArchiveBridge({socketPath:process.env.KANBAN_BRIDGE_SOCKET,bridgeVersion,autoFlow:flow,runExclusive,
      ready,call:(tool,args)=>relay.call(tool,args,relay.contextThreadId),request:(method,params)=>relay.request(method,params)});
    try{
      // Only the elected socket owner observes events or performs auto grouping.
      if(!ended&&process.env.KANBAN_FLOW_ROOT)autoFlow=await startAutoFlow({root:process.env.KANBAN_FLOW_ROOT,relay,runExclusive});
      if(ended)autoFlow?.stop();
      return async()=>{autoFlow?.stop();autoFlow=null;await stopBridge();};
    }catch(error){await stopBridge();throw error;}
  }});
  relay.subscribeContext(()=>bridge.ensure());
  if(ended)await bridge.stop();else bridge.ensure();
}
if(process.argv[1]&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url)))startDesktopProxy().catch(()=>{process.stderr.write('KANBAN_PROXY_START_FAILED\n');process.exitCode=1;});
