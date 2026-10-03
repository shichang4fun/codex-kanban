// Preserve the browser UI's Response contract without making iframe HTTP calls.
const routes={
  '/api/board':['GET','get_board'],
  '/api/creation-options':['GET','get_creation_options'],
  '/api/create':['POST','create_task'],
  '/api/group-settings':['POST','save_group_settings'],
  '/api/creation-group':['POST','retry_creation_group'],
  '/api/move':['POST','move_task'],
  '/api/pin':['POST','pin_task'],
  '/api/project':['POST','set_project'],
  '/api/archive':['POST','archive_task'],
  '/api/unarchive':['POST','undo_archive']
};
export function createMcpFetch(app,ready){
  return async(endpoint,options={})=>{
    const statusUrl=endpoint.startsWith('/api/creation-status?')?new URL(endpoint,'http://kanban.local'):null;
    const route=statusUrl?['GET','get_creation_status']:routes[endpoint],method=options.method??'GET';
    if(!route||route[0]!==method)throw Error('Unsupported board request.');
    await ready;
    const args=method==='GET'?(statusUrl?{requestId:statusUrl.searchParams.get('requestId')}:{}):{...JSON.parse(options.body),actionToken:options.headers?.['X-Kanban-Token']};
    const value=await app.callServerTool({name:route[1],arguments:args},{timeout:method==='GET'?60000:180000});
    const payload=value.structuredContent;
    if(!payload||typeof payload!=='object')throw Error('Incomplete board response.');
    return {ok:value.isError!==true&&!payload.error,status:payload.status??(value.isError?503:200),json:async()=>payload};
  };
}
