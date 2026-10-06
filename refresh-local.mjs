import {readFile,writeFile} from 'node:fs/promises';
import {openLocalReader} from './local-read.mjs';
import {createLocalBoard} from './local-board.mjs';
import {writeBoard} from './build.mjs';
import {readLocalUnread} from './desktop-unread.mjs';
import {readLocalProjects} from './desktop-projects.mjs';
import {createGitStatusReader} from './git-status.mjs';

const snapshot=JSON.parse(await readFile(new URL('./snapshot.json',import.meta.url),'utf8'));
const reader=await openLocalReader();
try{
  const gitStatus=createGitStatusReader();
  let board=await gitStatus.enrich(await createLocalBoard(reader,snapshot,{unreadState:await readLocalUnread(),projectState:await readLocalProjects()}).getBoard());
  await gitStatus.settle();board=await gitStatus.enrich(board);
  await writeFile(new URL('./local-group-snapshot.json',import.meta.url),JSON.stringify(board,null,2));
  await writeBoard(board,new URL('./index.html',import.meta.url));
  console.log(JSON.stringify({capturedAt:board.capturedAt,tasks:board.tasks.length,
    groups:board.sections.map(s=>({name:s.name,count:board.tasks.filter(t=>t.nativeSectionId===s.sectionId).length}))}));
}finally{reader.close();}
