import {readFlowSettings,updateFlowSettings} from './flow-config.mjs';
import {initializeFlowGroups} from './flow-initialization.mjs';
import {createJsonStore} from './creation-store.mjs';
import {join} from 'node:path';

// One FIFO gate covers complete read/write/readback transactions, shared by
// manual board actions and automatic organization on the same Desktop relay.
export function createTransactionGate(){
  let tail=Promise.resolve();
  return operation=>{const result=tail.then(operation);tail=result.catch(()=>{});return result;};
}
export async function startAutoFlow({root,relay,runExclusive=operation=>operation(),initializationStore=createJsonStore(join(root,'flow-group-initialization.json'))}){
  let manager,stopTimer,unsubscribe,unsubscribeContext,createManager,startTimer,stopped=false,changes=Promise.resolve(),generation=0,initializing=null;
  let initialization={state:'waiting',message:'Open a local chat in Codex. Missing flow groups will be created automatically.'};
  const backlog=[],events=new Set(['thread/started','thread/status/changed','turn/started','turn/completed']);
  const readConfig=()=>{const value=readFlowSettings(root);return {...value.policy,mode:value.enabled?value.policy.mode:'disabled'};};
  const rpc={request:(method,params)=>relay.flowRequest(method,params)};
  function retire(){stopTimer?.();const previous=manager;previous?.stop();manager=null;return previous;}
  function start(){
    manager=createManager(rpc,{readConfig,runExclusive});
    stopTimer=startTimer(manager,{readConfig,log:()=>{}});
    for(const message of backlog.splice(0))manager.handle(message).catch(()=>{});
  }
  try{
    readConfig();
    // These optional modules are loaded independently. An unavailable engine
    // must leave the manual Desktop bridge usable.
    const [{createDesktopObserverManager},{startReconciliation}]=await Promise.all([
      import(new URL('./flow/desktop-observer-manager.mjs',import.meta.url).href),
      import(new URL('./flow/desktop-reconciliation-timer.mjs',import.meta.url).href)
    ]);
    createManager=createDesktopObserverManager;startTimer=startReconciliation;
  }catch{return {status:()=>({available:false,error:'Auto organize is unavailable. Reinstall Codex Kanban to repair its runtime or settings.'}),
    change:()=>{throw Error('Auto organize is unavailable.');},stop:()=>{}};}
  const status=()=>{try{const value=readFlowSettings(root);return {available:true,enabled:value.enabled,mode:value.policy.mode,initialization};}
    catch{return {available:false,error:'Auto organize settings could not be read.'};}};
  function initialize(){
    if(initializing)return initializing.then(status);
    let settings;
    try{settings=readFlowSettings(root);}catch{
      initialization={state:'error',message:'Auto organize settings could not be read. Repair the settings or reinstall Codex Kanban.'};
      return Promise.resolve(status());
    }
    if(stopped||!settings.enabled||initialization.state==='ready')return Promise.resolve(status());
    const epoch=generation,fingerprint=JSON.stringify(settings.policy);
    const check=()=>{const current=readFlowSettings(root);
      if(stopped||epoch!==generation||!current.enabled||JSON.stringify(current.policy)!==fingerprint)
        throw Object.assign(Error('Automatic grouping initialization was cancelled.'),{status:409});};
    const contextThreadId=relay.contextThreadId;
    if(!relay.ready||!contextThreadId)return Promise.resolve(status());
    initialization={state:'initializing',message:'Preparing flow groups in Codex…'};
    initializing=runExclusive(async()=>{
      check();
      const thread=(await rpc.request('thread/read',{threadId:contextThreadId,includeTurns:false}))?.thread;check();
      if(thread?.id!==contextThreadId||thread.ephemeral!==false||thread.parentThreadId!=null
        ||(thread.hostId!==undefined&&thread.hostId!=='local')){
        initialization={state:'waiting',message:'Open a local chat in Codex. Missing flow groups will be created automatically.'};return;
      }
      const ready=await initializeFlowGroups({rpc,contextThreadId,policy:settings.policy,store:initializationStore,check});
      check();initialization=ready;start();
    }).catch(error=>{
      if(epoch===generation&&!stopped){initialization={state:'error',message:error.status?error.message:'Flow groups could not be prepared. Open a local chat and enable Auto organize again.'};backlog.length=0;}
    }).finally(()=>{
      initializing=null;
      if(!stopped&&epoch===generation&&relay.contextThreadId!==contextThreadId&&initialization.state!=='ready')
        queueMicrotask(()=>initialize());
    });
    return initializing.then(status);
  }
  unsubscribe=relay.subscribe(message=>{
    if(stopped||!readFlowSettings(root).enabled||!events.has(message.method))return;
    if(manager&&initialization.state==='ready')return manager.handle(message);
    if(initialization.state!=='error'){if(backlog.length>=256)backlog.shift();backlog.push(message);}
  });
  unsubscribeContext=relay.subscribeContext?.(()=>initialize());
  if(relay.ready&&relay.contextThreadId)initialize();
  return {status,change(enabled){
    const result=changes.then(async()=>{
      if(stopped)throw Error('Auto organize connection closed.');
      if(typeof enabled!=='boolean')throw Error('An explicit switch is required.');
      const previous=readFlowSettings(root);
      await updateFlowSettings(root,enabled);
      ++generation;const retired=retire();backlog.length=0;
      initialization={state:'waiting',message:'Open a local chat in Codex. Missing flow groups will be created automatically.'};
      await retired?.drain();await initializing;
      if(stopped)throw Error('Auto organize connection closed.');
      // A fresh manager discards all pre-disable lifecycle evidence and retries.
      if(enabled){
        await initialize();
        if(initialization.state==='error'){await updateFlowSettings(root,previous.enabled);throw Object.assign(Error(initialization.message),{status:409});}
      }
      return status();
    });changes=result.catch(()=>{});return result;
  },initialize,stop(){stopped=true;++generation;retire();backlog.length=0;unsubscribe?.();unsubscribeContext?.();}};
}
