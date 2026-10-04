import {readFile,realpath,lstat,stat} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const exec=promisify(execFile);

async function gitDirectory(cwd){
  let directory=await realpath(cwd).catch(()=>null);
  while(directory){
    const path=join(directory,'.git');
    let exists;
    try{exists=await lstat(path);}catch(error){if(error.code!=='ENOENT')return null;}
    if(exists){
      // An existing but unreadable/broken boundary must not inherit its parent.
      try{
        const dotGit=await realpath(path),entry=await stat(dotGit);
        if(entry.isDirectory())return dotGit;
        if(!entry.isFile())return null;
        const match=(await readFile(dotGit,'utf8')).match(/^gitdir: ([^\r\n]+)\r?\n?$/);
        return match?await realpath(resolve(directory,match[1])):null;
      }catch{return null;}
    }
    // Bare repositories have no .git entry. Verify this exact directory only
    // when HEAD exists; ordinary ancestor traversal never launches Git.
    let head;
    try{head=await lstat(join(directory,'HEAD'));}catch(error){if(error.code!=='ENOENT')return null;}
    if(head){
      try{await exec('git',['--no-optional-locks','rev-parse','--resolve-git-dir',directory],{cwd:directory,timeout:1000,maxBuffer:16384});return directory;}
      catch{return null;}
    }
    const parent=dirname(directory);
    directory=parent===directory?null:parent;
  }
  return null;
}

async function sharedDirectory(git){
  if(!git)return null;
  try{return await realpath(resolve(git,(await readFile(join(git,'commondir'),'utf8')).trim()));}
  catch(error){return error.code==='ENOENT'?git:null;}
}

// Match linked worktrees by Git identity, never by cwd names or stale task
// associations. Ordinary checkouts keep an explicit native null authoritative.
export async function readWorktreeProjects(directories,projects){
  if(!directories.length||!projects.length)return new Map();
  const roots=await Promise.all(projects.flatMap(p=>p.roots.map(async root=>({
    projectId:p.id,git:await sharedDirectory(await gitDirectory(root.path))
  }))));
  return new Map(await Promise.all(directories.map(async cwd=>{
    try{
      const git=await gitDirectory(cwd);
      if(!git)return [cwd,null];
      const shared=await sharedDirectory(git);
      if(!shared||shared===git)return [cwd,null];
      const matches=new Set(roots.filter(r=>r.git===shared).map(r=>r.projectId));
      return [cwd,matches.size===1?[...matches][0]:null];
    }catch{return [cwd,null];}
  })));
}
