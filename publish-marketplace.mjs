import {cp,mkdtemp,readFile,rm,lstat,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// Publish only a built package, with a normal fast-forward push. Never force-push
// or switch the source checkout; a concurrent remote update rejects publication.
export async function publishMarketplace({packagePath,repository=process.cwd()}={}){
  if(!packagePath)throw Error('A built marketplace package path is required.');
  const source=resolve(packagePath),cwd=resolve(repository);
  async function validate(path){
    const stat=await lstat(path);
    if(stat.isSymbolicLink())throw Error('Marketplace packages cannot contain symlinks.');
    if(stat.isDirectory())for(const name of await readdir(path)){
      if(['.git','snapshot.json','connection.json'].includes(name)||name.startsWith('.env'))throw Error('Private or Git data found in marketplace package.');
      await validate(join(path,name));
    }
    else if(!stat.isFile())throw Error('Marketplace packages must contain regular files.');
  }
  await validate(source);
  const entries=(await readdir(source)).sort();
  const required=['.agents','Install Codex Kanban.command','README.md','plugins'];
  const allowed=[...required,'README.zh-CN.md'];
  if(required.some(name=>!entries.includes(name))||entries.some(name=>!allowed.includes(name)))throw Error('Invalid marketplace package root.');
  if(!((await lstat(join(source,'Install Codex Kanban.command'))).mode&0o111))throw Error('Packaged installer must be executable.');
  const catalog=JSON.parse(await readFile(join(source,'.agents/plugins/marketplace.json'),'utf8'));
  if(catalog.name!=='codex-kanban'||catalog.plugins?.length!==1||catalog.plugins[0].name!=='codex-kanban'
    ||catalog.plugins[0].source?.source!=='local'||catalog.plugins[0].source?.path!=='./plugins/codex-kanban')throw Error('Invalid marketplace catalog.');
  const plugin=join(source,'plugins/codex-kanban');
  const manifest=JSON.parse(await readFile(join(plugin,'plugin.json'),'utf8'));
  const expected=JSON.parse(await readFile(join(cwd,'plugin.json'),'utf8'));
  if(manifest.name!==expected.name||manifest.version!==expected.version)throw Error('Package version does not match the source checkout.');
  if(!((await lstat(join(plugin,'launch-mcp'))).mode&0o111))throw Error('Packaged MCP launcher must be executable.');
  const git=(...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const sourceCommit=git('rev-parse','HEAD');
  git('fetch','origin','+refs/heads/main:refs/remotes/origin/main','+refs/heads/marketplace:refs/remotes/origin/marketplace');
  if(sourceCommit!==git('rev-parse','origin/main'))throw Error('Main changed or this is not its latest commit. Run publication again from main.');
  const temporary=await mkdtemp(join(tmpdir(),'kanban-publish-')),checkout=join(temporary,'marketplace');let attached=false;
  try{
    git('worktree','add','--detach',checkout,'origin/marketplace');attached=true;
    const publishGit=(...args)=>execFileSync('git',args,{cwd:checkout,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
    publishGit('rm','-r','--ignore-unmatch','.');
    await cp(source,checkout,{recursive:true});
    publishGit('add','--all');
    if(!publishGit('diff','--cached','--name-only'))return {published:false,version:manifest.version,sourceCommit,commit:publishGit('rev-parse','HEAD')};
    // Recheck after preparing the package, before making it publicly available.
    git('fetch','origin','+refs/heads/main:refs/remotes/origin/main');
    if(sourceCommit!==git('rev-parse','origin/main'))throw Error('Main changed during publication. Run publication again.');
    publishGit('-c','user.name=github-actions[bot]','-c','user.email=41898282+github-actions[bot]@users.noreply.github.com',
      'commit','-m',`Publish Codex Kanban ${manifest.version} from ${sourceCommit.slice(0,12)}`);
    publishGit('push','origin','HEAD:refs/heads/marketplace');
    return {published:true,version:manifest.version,sourceCommit,commit:publishGit('rev-parse','HEAD')};
  }finally{
    if(attached)git('worktree','remove','--force',checkout);
    await rm(temporary,{recursive:true,force:true});
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  console.log(JSON.stringify(await publishMarketplace({packagePath:process.argv[2]})));
}
