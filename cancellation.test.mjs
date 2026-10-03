import test from 'node:test';
import assert from 'node:assert/strict';
import {archiveLocalTask,restoreArchivedTask} from './archive.mjs';
import {pinLocalTask} from './pin.mjs';
import {moveLocalTask} from './move.mjs';
import {createKanbanService} from './kanban-service.mjs';

const id='11111111-1111-4111-8111-111111111111';
const task={id,hostId:'local',title:'Disposable fixture',placementSource:'localDefault'};
const board={tasks:[task],sections:[],sync:{connected:true}};
for(const action of ['archive','restore','pin','move'])test(`${action} cancellation during native preflight does not write`,async()=>{
  const controller=new AbortController();let writes=0,closed=false;
  const client={close(){closed=true;},async request(method){
    if(method==='thread/read'){
      controller.abort();
      return {thread:{id,ephemeral:false,parentThreadId:null,cwd:'/fixture',section:null}};
    }
    if(method==='threadSection/list')return {data:[{id:'pinned',name:'Pinned'},{id:'review',name:'For Review'}]};
    if(method==='thread/list')return {data:[]};
    writes++;throw Error('Must never write');
  }};
  const options={open:async()=>client,signal:controller.signal};
  const params={threadId:id,hostId:'local'};
  const operation=action==='archive'?archiveLocalTask(params,board,options):action==='restore'?restoreArchivedTask(params,options)
    :action==='pin'?pinLocalTask({...params,pinned:true},board,options)
    :moveLocalTask({...params,sectionId:'review',expectedSectionId:null},board,options);
  await assert.rejects(operation,/cancel/i);assert.equal(writes,0);assert(closed);
});
test('shared service forwards cancellation into the native archive preflight',async()=>{
  const controller=new AbortController();let writes=0;
  const client={close(){},async request(method){
    if(method==='thread/read'){controller.abort();return {thread:{id,ephemeral:false,parentThreadId:null,cwd:'/fixture'}};}
    writes++;throw Error('Must never write');
  }};
  const service=createKanbanService({getBoard:async()=>board,
    archiveTask:(params,current,options)=>archiveLocalTask(params,current,{...options,open:async()=>client})});
  await assert.rejects(service.action('archive',{threadId:id,hostId:'local'},{signal:controller.signal}),error=>error.status===408);
  assert.equal(writes,0);assert.deepEqual((await service.read()).undoArchives,[]);await service.close();
});
