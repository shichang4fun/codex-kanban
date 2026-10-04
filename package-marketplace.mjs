import {cp,mkdir,readFile,rm,writeFile,chmod} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildPlugin} from './build-plugin.mjs';

const root=dirname(fileURLToPath(import.meta.url));
// buildPlugin copies an explicit file list; user data and local settings never enter this tree.
export async function packageMarketplace(){
  await buildPlugin();
  const output=join(root,'dist','marketplace');
  await rm(output,{recursive:true,force:true});
  await mkdir(join(output,'.agents','plugins'),{recursive:true});
  await cp(join(root,'dist','plugin'),join(output,'plugins','codex-kanban'),{recursive:true});
  await cp(join(root,'Install Codex Kanban.command'),join(output,'Install Codex Kanban.command'));
  await chmod(join(output,'Install Codex Kanban.command'),0o755);
  const manifest=JSON.parse(await readFile(join(root,'plugin.json'),'utf8'));
  const marketplace={name:'codex-kanban',interface:{displayName:'Codex Kanban'},plugins:[{
    name:'codex-kanban',source:{source:'local',path:'./plugins/codex-kanban'},
    policy:{installation:'AVAILABLE',authentication:'ON_INSTALL'},category:'Productivity'
  }]};
  await writeFile(join(output,'.agents','plugins','marketplace.json'),JSON.stringify(marketplace,null,2)+'\n');
  // Share the concise bilingual overview with the public ZIP; detailed docs stay on main.
  for(const name of ['README.md','README.zh-CN.md']){
    const overview=(await readFile(join(root,name),'utf8'))
      .replace(/^# Codex Kanban$/m,`# Codex Kanban ${manifest.version}`)
      .replaceAll('(docs/technical-reference.md)','(https://github.com/shichang4fun/codex-kanban/blob/main/docs/technical-reference.md)')
      .replaceAll('(TESTING.md)','(https://github.com/shichang4fun/codex-kanban/blob/main/TESTING.md)');
    await writeFile(join(output,name),overview);
  }
  return {output,marketplace:marketplace.name,version:manifest.version};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await packageMarketplace(),null,2));
