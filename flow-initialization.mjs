import {randomUUID} from 'node:crypto';

export const FLOW_GROUP_NAMES=['In Progress','For Review','For Later'];
const reserved=new Set(['pinned','chats','threads']);
const fail=message=>Object.assign(Error(message),{status:409});

// The journal records intent before a non-idempotent Desktop create. A lost
// reply must be resolved by fresh catalog reads, never another automatic write.
export async function initializeFlowGroups({rpc,contextThreadId,policy,store,check=()=>{}}){
  async function call(tool,args){
    const reply=await rpc.request('mcpServer/tool/call',{server:'codex_app',threadId:contextThreadId,tool,arguments:args});
    const text=reply?.content?.filter(item=>item.type==='text');
    if(reply?.isError||text?.length!==1||typeof text[0].text!=='string')throw fail('Desktop group initialization could not be confirmed. Open a local chat and try again.');
    try{return JSON.parse(text[0].text);}catch{throw fail('Invalid Desktop group reply.');}
  }
  async function catalog(){
    const data=await call('list_threads',{limit:1});
    if(!Array.isArray(data?.sections)||data.unavailableHosts?.includes('local')||data.unavailableSources?.length
      ||data.sections.some(s=>typeof s.sectionId!=='string'||!s.sectionId||typeof s.name!=='string')
      ||new Set(data.sections.map(s=>s.sectionId)).size!==data.sections.length)throw fail('Desktop groups are unavailable. Open a local chat and try again.');
    for(const name of FLOW_GROUP_NAMES){
      const matches=data.sections.filter(s=>s.name===name);
      if(matches.length>1)throw fail(`More than one group is named ${name}. Rename the duplicate groups in Codex, then enable Auto organize again.`);
      if(matches.some(s=>reserved.has(s.sectionId)))throw fail(`The group ${name} must be a custom Codex sidebar group.`);
    }
    for(const [key,name] of [['inProgress','In Progress'],['forReview','For Review']]){
      const pair=policy.forceStatusSections?.[key];
      if(pair&&data.sections.find(s=>s.name===name)?.sectionId!==pair.desktopId)
        throw fail(`The saved ${name} mapping no longer matches Codex. Restore the configured group or repair the mapping before enabling Auto organize.`);
    }
    return data.sections;
  }
  const find=(sections,name)=>sections.find(s=>s.name===name);
  async function verifyLocalMapping(){
    if(!policy.forceStatusSections)return;
    // A migrated UUID mapping is an explicit policy. Never silently replace
    // its missing destinations or bind the policy to a newly created group.
    const local=[];let cursor=null;const seen=new Set();
    do{
      const page=await rpc.request('threadSection/list',{limit:100,cursor});check();
      if(!Array.isArray(page?.data)||local.length+page.data.length>5000)throw fail('The configured local group mapping could not be verified.');
      local.push(...page.data);cursor=page.nextCursor??null;
      if(cursor!==null&&(typeof cursor!=='string'||!cursor||seen.has(cursor)))throw fail('Invalid local group catalog.');seen.add(cursor);
    }while(cursor!==null);
    for(const [key,name] of [['inProgress','In Progress'],['forReview','For Review']]){
      const pair=policy.forceStatusSections[key],matches=local.filter(s=>s.id===pair.localId||s.name===name);
      if(matches.length!==1||matches[0].id!==pair.localId||matches[0].name!==name)
        throw fail(`The saved ${name} mapping no longer matches Codex. Restore the configured group or repair the mapping before enabling Auto organize.`);
    }
  }
  let sections=await catalog();check();await verifyLocalMapping();
  for(const name of FLOW_GROUP_NAMES){
    check();sections=await catalog();check();
    if(find(sections,name)){
      if((await store.read())[name])await store.update(entries=>{delete entries[name];});continue;
    }
    const claim=randomUUID();
    await store.update(entries=>{
      check();
      if(entries[name])throw fail(`Creation of ${name} is unconfirmed. Check Codex for that group; create it manually if absent, then enable Auto organize again. No creation request was repeated.`);
      entries[name]={claim};
    });
    let dispatched=false;
    try{
      // Recheck after taking the durable claim, immediately before dispatch.
      sections=await catalog();check();
      if(!find(sections,name)){
        await verifyLocalMapping();check();
        dispatched=true;
        try{await call('create_sidebar_section',{name});}catch{/* A fresh read can confirm a committed create with a lost response. */}
        sections=await catalog();
        if(!find(sections,name))throw fail(`Creation of ${name} is unconfirmed. Check Codex for that group; create it manually if absent, then enable Auto organize again. No creation request was repeated.`);
      }
      await store.update(entries=>{if(entries[name]?.claim===claim)delete entries[name];});
    }catch(error){
      if(!dispatched)await store.update(entries=>{if(entries[name]?.claim===claim)delete entries[name];});
      throw error;
    }
  }
  sections=await catalog();check();await verifyLocalMapping();check();
  if(FLOW_GROUP_NAMES.some(name=>!find(sections,name)))throw fail('A flow group was removed during initialization. Enable Auto organize again to recheck the groups.');
  return {state:'ready',message:'Flow groups are ready. Running tasks move to In Progress; tasks needing review move to For Review.'};
}
