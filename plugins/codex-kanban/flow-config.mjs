import {readFileSync,lstatSync} from 'node:fs';
import {writeFile,rename,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {validateProxyConfig} from './flow/desktop-proxy-config.mjs';

function readPrivate(file){
  const s=lstatSync(file);
  if(!s.isFile()||s.isSymbolicLink()||s.uid!==process.getuid()||(s.mode&0o077))throw Error('Private auto organize settings required.');
  return JSON.parse(readFileSync(file,'utf8'));
}
export function validateFlowSettings(value){
  if(value?.version!==1||typeof value.enabled!=='boolean')throw Error('Invalid auto organize settings.');
  const policy=validateProxyConfig(value.policy);
  if(policy.mode==='disabled')throw Error('Use the separate auto organize switch.');
  return {version:1,enabled:value.enabled,policy};
}
export function readFlowSettings(root){return validateFlowSettings(readPrivate(join(root,'flow.json')));}
async function save(root,value){
  const file=join(root,'flow.json'),temp=file+'.'+randomUUID();
  try{await writeFile(temp,JSON.stringify(validateFlowSettings(value),null,2)+'\n',{mode:0o600,flag:'wx'});await rename(temp,file);}
  finally{await unlink(temp).catch(()=>{});}
}
export async function updateFlowSettings(root,enabled){
  if(typeof enabled!=='boolean')throw Error('An explicit auto organize switch is required.');
  const current=readFlowSettings(root);await save(root,{...current,enabled});return readFlowSettings(root);
}
// Import only effective policy data from an owned installation. Never execute
// its entrypoint or import its old installers, hooks or global instructions.
export function prepareFlowSettings(root,{legacyRoot}={}){
  try{return readFlowSettings(root);}catch(error){if(error.code!=='ENOENT')throw error;}
  let policy={version:1,mode:'all-local',threadIds:[],excludedThreadIds:[],reconcileIntervalSeconds:60},enabled=true;
  if(legacyRoot){
    const s=lstatSync(legacyRoot);
    if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid()||(s.mode&0o077))throw Error('Private Sidebar Flow installation required.');
    if(readFileSync(join(legacyRoot,'.owner'),'utf8')!=='codex-sidebar-flow-desktop-v1')throw Error('Unknown Sidebar Flow installation.');
    policy=validateProxyConfig(readPrivate(join(legacyRoot,'config.json')));
    if(policy.mode==='disabled'){enabled=false;policy={...policy,mode:policy.threadIds.length?'allowlist':'all-local'};}
  }
  return {version:1,enabled,policy};
}
export async function installFlowSettings(root,options){
  const value=prepareFlowSettings(root,options);
  try{return readFlowSettings(root);}catch(error){if(error.code!=='ENOENT')throw error;}
  await save(root,value);return value;
}
