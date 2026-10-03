import {readFile,writeFile,mkdir,rename,lstat,unlink,rmdir} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';

export const defaultCreationSettingsStore=()=>createJsonStore(join(process.env.KANBAN_DATA_DIR??join(process.env.CODEX_HOME??join(homedir(),'.codex'),'kanban'),'group-creation-settings.json'));

// Atomic replacement, a writer lock and an in-process queue keep settings and the
// pre-dispatch creation journal durable. Corrupt files fail closed.
export function createJsonStore(path){
  let queue=Promise.resolve();
  async function read(){
    try{
      const stat=await lstat(path);
      if(!stat.isFile()||stat.isSymbolicLink())throw Error('Invalid creation storage file.');
      const data=JSON.parse(await readFile(path,'utf8'));
      if(data.version!==1||!data.entries||Array.isArray(data.entries)||typeof data.entries!=='object')throw Error('Invalid creation storage data.');
      return data.entries;
    }catch(error){if(error.code==='ENOENT')return {};throw error;}
  }
  return {
    read:()=>queue.then(read),
    update(change){
      const next=queue.then(async()=>{
        await mkdir(dirname(path),{recursive:true,mode:0o700});
        const lock=path+'.lock',deadline=Date.now()+1000;
        for(;;){
          try{await mkdir(lock,{mode:0o700});break;}
          catch(error){
            if(error.code!=='EEXIST')throw error;
            if(Date.now()>=deadline)throw Object.assign(Error('Creation storage is busy. Retry after the other writer finishes; a stale lock requires repair.'),{status:409});
            await new Promise(resolve=>setTimeout(resolve,10));
          }
        }
        try{
          const entries=await read(),result=await change(entries);
          const temporary=path+'.'+randomUUID()+'.tmp';
          try{await writeFile(temporary,JSON.stringify({version:1,entries})+'\n',{mode:0o600,flag:'wx',flush:true});await rename(temporary,path);}
          finally{await unlink(temporary).catch(()=>{});}
          return result;
        }finally{await rmdir(lock);}
      });
      queue=next.catch(()=>{});return next;
    }
  };
}
