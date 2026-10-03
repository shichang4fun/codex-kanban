import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';

// Read only the verified local Desktop marker format. Cloud markers differ
// from the Desktop tool response, so never use them or guess across identities.
export function parseLocalUnread(data){
  const state=data?.['electron-thread-read-state-v1'];
  if(state?.version!==1||!state.unreadByIdentity||typeof state.unreadByIdentity!=='object')return {known:false};
  const identities=Object.values(state.unreadByIdentity);
  if(identities.length!==1||!identities[0]||typeof identities[0]!=='object')return {known:false};
  const buckets=Object.entries(identities[0]).filter(([key])=>/^local:[0-9a-f]{64}$/.test(key));
  if(buckets.length!==1||!Array.isArray(buckets[0][1])||!buckets[0][1].every(id=>typeof id==='string'))return {known:false};
  return {known:true,ids:[...new Set(buckets[0][1])]};
}
export async function readLocalUnread({statePath=join(homedir(),'.codex','.codex-global-state.json')}={}){
  try{
    const state=parseLocalUnread(JSON.parse(await readFile(statePath,'utf8')));
    return {...state,capturedAt:new Date().toISOString()};
  }catch{return {known:false};}
}
