import {openLocalReader} from './local-read.mjs';
import {moveLocalTask} from './move.mjs';
import {pinLocalTask} from './pin.mjs';
import {bridgeError} from './bridge-transport.mjs';

const allowedNames=['For Later','In Progress','For Review','Pinned'];
// Only the write is adapted. The existing controllers keep native validation,
// stale-source checks and readback; this connection never acquires a writer.
export function createDesktopGroups({call,ready=()=>true,openReader=openLocalReader}){
  let busy=false;
  async function run(action,params,{signal}={}){
    if(!ready())throw bridgeError('Launch Codex with Kanban and open a local task to change groups.');
    if(busy)throw bridgeError('Another desktop group action is in progress.',409);
    const checkCancellation=()=>{if(signal?.aborted)throw bridgeError('Group change cancelled before writing.',409);};
    checkCancellation();busy=true;
    try{
      const open=async()=>{
        const reader=await openReader();let original;
        const read=async()=>{
          const result=await reader.request('thread/read',{threadId:params.threadId,includeTurns:false}),t=result?.thread;
          if(t?.id!==params.threadId||t.ephemeral!==false||t.parentThreadId!=null||t.section===undefined||t.archived||t.isArchived
            ||!Object.hasOwn(t,'projectId')||(t.projectId!==null&&typeof t.projectId!=='string'))
            throw bridgeError('Cannot verify this task and its project before changing groups.',409);
          return t;
        };
        const catalog=async()=>{
          const sections=[];let cursor=null;const seen=new Set();
          do{
            const page=await reader.request('threadSection/list',{limit:100,cursor});
            if(!Array.isArray(page?.data))throw bridgeError('Native group catalog is unavailable.',409);
            sections.push(...page.data);cursor=page.nextCursor??null;
            if(cursor!==null&&(typeof cursor!=='string'||seen.has(cursor)||sections.length>5000))throw bridgeError('Native group catalog is unavailable.',409);
            seen.add(cursor);
          }while(cursor!==null);
          return sections;
        };
        return {close:()=>reader.close(),request:async(method,args)=>{
          if(method!=='thread/section/move'){
            const result=await reader.request(method,args);
            if(method==='thread/read'&&!original&&result?.thread){
              original={sectionId:result.thread.section?.id??null,projectId:result.thread.projectId};
            }
            return result;
          }
          if(!original||original.projectId===undefined)throw bridgeError('Task project is unavailable; no group change was made.',409);
          const sections=await catalog();
          const snapshot=await call('list_threads',{limit:50});
          if(!Array.isArray(snapshot?.sections)||snapshot.unavailableHosts?.includes('local')||snapshot.unavailableSources?.length
            ||snapshot.sections.some(s=>typeof s.sectionId!=='string'||typeof s.name!=='string')
            ||new Set(snapshot.sections.map(s=>s.sectionId)).size!==snapshot.sections.length)
            throw bridgeError('Desktop groups are unavailable; no group change was made.',409);
          let desktopSectionId=null,destinationName=null;
          if(args.sectionId!==null){
            const destination=sections.filter(s=>s.id===args.sectionId);
            if(destination.length!==1||!allowedNames.includes(destination[0].name)
              ||sections.filter(s=>s.name===destination[0].name).length!==1)
              throw bridgeError('A unique native destination group is required.',409);
            const name=destination[0].name,matches=snapshot.sections.filter(s=>s.name===name);destinationName=name;
            if(name==='Pinned'){
              if(!snapshot.sections.some(s=>s.sectionId==='pinned'&&s.name==='Pinned'))throw bridgeError('Desktop Pinned group is unavailable.',409);
              desktopSectionId='pinned';
            }else{
              if(matches.length!==1||['pinned','chats','threads'].includes(matches[0].sectionId))throw bridgeError('A unique Desktop destination group is required.',409);
              desktopSectionId=matches[0].sectionId;
            }
          }
          if(args.sectionId!==null){
            const latest=await catalog(),matches=latest.filter(s=>s.name===destinationName);
            if(matches.length!==1||matches[0].id!==args.sectionId)
              throw bridgeError('The destination group changed. Refresh and try again.',409);
          }
          // Desktop lookup can take time: keep the last native check adjacent
          // to the one mutation, including canonical project association.
          const adjacent=await read();
          if((adjacent.section?.id??null)!==original.sectionId||adjacent.projectId!==original.projectId)
            throw bridgeError('This task changed groups or projects. Refresh and try again.',409);
          checkCancellation();if(!ready())throw bridgeError('Desktop disconnected before the group change.');
          await call('move_thread_to_sidebar_section',{threadId:params.threadId,hostId:'local',source:'codex',sectionId:desktopSectionId});
          const verified=await read();
          if((verified.section?.id??null)!==args.sectionId||verified.projectId!==original.projectId)
            throw bridgeError('Desktop group change could not be confirmed. Refresh before retrying; it was not repeated.',409);
          return {};
        }};
      };
      // Native reads below establish eligibility. No project-container identity
      // or caller-supplied placement data is accepted over the private socket.
      const board={tasks:[{id:params?.threadId,hostId:params?.hostId,placementSource:'localDefault'}]};
      return action==='move'?await moveLocalTask(params,board,{open,signal}):await pinLocalTask(params,board,{open});
    }finally{busy=false;}
  }
  return {move:(params,context)=>run('move',params,context),pin:(params,context)=>run('pin',params,context)};
}
