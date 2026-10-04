import {readFlowSettings,updateFlowSettings} from './flow-config.mjs';

// One FIFO gate covers complete read/write/readback transactions, shared by
// manual board actions and automatic organization on the same Desktop relay.
export function createTransactionGate(){
  let tail=Promise.resolve();
  return operation=>{const result=tail.then(operation);tail=result.catch(()=>{});return result;};
}
export async function startAutoFlow({root,relay,runExclusive}){
  let manager,stopTimer,unsubscribe,createManager,startTimer,stopped=false,changes=Promise.resolve();
  const readConfig=()=>{const value=readFlowSettings(root);return {...value.policy,mode:value.enabled?value.policy.mode:'disabled'};};
  function retire(){unsubscribe?.();stopTimer?.();manager?.stop();}
  function start(){
    manager=createManager({request:(method,params)=>relay.flowRequest(method,params)},{readConfig,runExclusive});
    const current=manager;
    unsubscribe=relay.subscribe(message=>current.handle(message));
    stopTimer=startTimer(current,{readConfig,log:()=>{}});
  }
  try{
    readConfig();
    // These optional modules are loaded independently. An unavailable engine
    // must leave the manual Desktop bridge usable.
    const [{createDesktopObserverManager},{startReconciliation}]=await Promise.all([
      import(new URL('./flow/desktop-observer-manager.mjs',import.meta.url).href),
      import(new URL('./flow/desktop-reconciliation-timer.mjs',import.meta.url).href)
    ]);
    createManager=createDesktopObserverManager;startTimer=startReconciliation;start();
  }catch{return {status:()=>({available:false,error:'Auto organize is unavailable. Reinstall Codex Kanban to repair its runtime or settings.'}),
    change:()=>{throw Error('Auto organize is unavailable.');},stop:()=>{}};}
  const status=()=>{try{const value=readFlowSettings(root);return {available:true,enabled:value.enabled,mode:value.policy.mode};}
    catch{return {available:false,error:'Auto organize settings could not be read.'};}};
  return {status,change(enabled){
    const result=changes.then(async()=>{
      if(stopped)throw Error('Auto organize connection closed.');
      if(typeof enabled!=='boolean')throw Error('An explicit switch is required.');
      await updateFlowSettings(root,enabled);
      retire();await manager.drain();
      if(stopped)throw Error('Auto organize connection closed.');
      // A fresh manager discards all pre-disable lifecycle evidence and retries.
      if(enabled)start();
      return status();
    });changes=result.catch(()=>{});return result;
  },stop(){stopped=true;retire();}};
}
