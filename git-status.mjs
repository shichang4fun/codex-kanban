import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const exec=promisify(execFile);
const fields='number,url,state,isDraft,headRefName,headRefOid,isCrossRepository,reviewDecision,statusCheckRollup,updatedAt';
const gitMaxAgeMs=5000,prMaxAgeMs=60000;

export function githubRepository(remote){
  if(typeof remote!=='string')return null;
  const match=remote.trim().match(/^(?:https:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  return match&&!['.','..'].includes(match[1])&&!['.','..'].includes(match[2])?match[1]+'/'+match[2]:null;
}

export function checkSummary(checks){
  if(!Array.isArray(checks)||!checks.length)return 'none';
  const failed=new Set(['FAILURE','ERROR','TIMED_OUT','CANCELLED','ACTION_REQUIRED','STARTUP_FAILURE','STALE']);
  if(checks.some(c=>failed.has(c.conclusion)||failed.has(c.state)))return 'failed';
  if(checks.some(c=>c.status?c.status!=='COMPLETED':!['SUCCESS','NEUTRAL','SKIPPED'].includes(c.state)))return 'pending';
  if(checks.some(c=>c.status==='COMPLETED'&&!['SUCCESS','NEUTRAL','SKIPPED'].includes(c.conclusion)))return 'unknown';
  return 'passed';
}

// Bound subprocesses across all workspaces. GitHub refreshes never block board reads.
export function createGitStatusReader({run=async(command,args,{signal}={})=>{
  const {stdout}=await exec(command,args,{signal,timeout:8000,maxBuffer:2*1024*1024,
    env:{...process.env,GIT_OPTIONAL_LOCKS:'0',GIT_TERMINAL_PROMPT:'0',GH_PROMPT_DISABLED:'1'}});
  return stdout.trim();
},clock=()=>Date.now()}={}){
  const workspaces=new Map(),requests=new Map(),queue=[],lifetime=new AbortController();let active=0,githubActive=0,closed=false;
  function command(name,args){
    if(closed)return Promise.reject(Error('Git status reader closed.'));
    return new Promise((resolve,reject)=>{queue.push({name,args,resolve,reject});pump();});
  }
  function pump(){
    if(closed)return;
    while(active<4&&queue.length){
      // Leave slots for local Git reads even when GitHub is slow.
      const index=queue.findIndex(job=>job.name!=='gh'||githubActive<2);
      if(index<0)break;
      const job=queue.splice(index,1)[0];active++;if(job.name==='gh')githubActive++;
      Promise.resolve().then(()=>{if(closed)throw Error('Git status reader closed.');return run(job.name,job.args,{signal:lifetime.signal});})
        .then(job.resolve,job.reject).finally(()=>{active--;if(job.name==='gh')githubActive--;pump();});
    }
  }
  async function readWorkspace(cwd){
    const existing=workspaces.get(cwd);
    if(existing&&(existing.pending||clock()-existing.time<gitMaxAgeMs))return existing.pending??existing.value;
    const entry={time:clock(),value:existing?.value};workspaces.set(cwd,entry);
    entry.pending=(async()=>{
      const git=args=>command('git',['-C',cwd,...args]);
      try{
        const [sha,branch,remote]=await Promise.all([
          git(['rev-parse','--verify','HEAD']),
          git(['symbolic-ref','--quiet','--short','HEAD']).catch(()=>null),
          git(['remote','get-url','origin']).catch(()=>null)
        ]);
        if(!/^[a-f\d]{40,64}$/i.test(sha))throw Error('Invalid commit');
        return {status:'ready',branch:branch||null,sha,repository:githubRepository(remote),checkedAt:new Date(clock()).toISOString()};
      }catch{return {status:'unavailable',checkedAt:new Date(clock()).toISOString()};}
    })().then(value=>{entry.value=value;entry.time=clock();entry.pending=null;return value;});
    return entry.pending;
  }
  function readPullRequests(git){
    // A checkout's starting commit does not identify a worktree's PR.
    if(!git.branch)return {status:'detached',items:[]};
    if(!git.repository)return {status:'unsupported',items:[]};
    const key=JSON.stringify([git.repository,git.branch,git.sha]);
    let entry=requests.get(key);
    if(!entry){entry={value:{status:'loading',items:[]},time:-Infinity,pending:null};requests.set(key,entry);}
    if(!closed&&!entry.pending&&clock()-entry.time>=prMaxAgeMs){
      entry.pending=command('gh',['pr','list','--repo','github.com/'+git.repository,'--state','all','--head',git.branch,'--limit','100','--json',fields])
        .then(raw=>{
          const rows=JSON.parse(raw);
          if(!Array.isArray(rows)||rows.length>=100)throw Error('Incomplete PR results');
          const items=rows.filter(p=>p.isCrossRepository===false&&p.headRefName===git.branch
            &&(p.state==='OPEN'||p.headRefOid===git.sha))
            .map(p=>{
              if(!Number.isSafeInteger(p.number)||p.number<1||typeof p.url!=='string'||p.url.toLowerCase()!==`https://github.com/${git.repository}/pull/${p.number}`.toLowerCase()
                ||!['OPEN','MERGED','CLOSED'].includes(p.state))throw Error('Invalid PR');
              return {number:p.number,url:p.url,state:p.state==='OPEN'&&p.isDraft?'DRAFT':p.state,
                checks:checkSummary(p.statusCheckRollup),review:p.reviewDecision||'NONE',updatedAt:p.updatedAt};
            });
          return {status:items.length?'ready':'none',items,match:'branch',checkedAt:new Date(clock()).toISOString()};
        }).catch(()=>({status:'unavailable',items:[],checkedAt:new Date(clock()).toISOString()}))
        .then(value=>{entry.value=value;entry.time=clock();entry.pending=null;});
    }
    return {...entry.value,refreshing:!!entry.pending};
  }
  return {async enrich(board,{waitForFresh=true}={}){
    if(closed)throw Error('Git status reader closed.');
    const directories=[...new Set(board.tasks.filter(t=>t.hostId==='local'&&!t.sidebarOnly&&typeof t.cwd==='string'&&t.cwd.startsWith('/')).map(t=>t.cwd))];
    const values=await Promise.all(directories.map(async cwd=>{
      const pending=readWorkspace(cwd);
      if(waitForFresh)return [cwd,await pending];
      const entry=workspaces.get(cwd);
      return [cwd,{...(entry.value??{status:'loading'}),refreshing:!!entry.pending}];
    }));
    const byDirectory=new Map(values);
    return {...board,tasks:board.tasks.map(task=>{
      const git=task.hostId==='local'&&!task.sidebarOnly?byDirectory.get(task.cwd):null;
      return {...task,git:git?{...git,pullRequests:git.status==='ready'?readPullRequests(git):{status:'unavailable',items:[]}}:null};
    })};
  },async settle(){while([...workspaces.values(),...requests.values()].some(e=>e.pending))await Promise.all([...workspaces.values(),...requests.values()].map(e=>e.pending));},
  close(){closed=true;lifetime.abort();for(const job of queue.splice(0))job.reject(Error('Git status reader closed.'));}};
}
