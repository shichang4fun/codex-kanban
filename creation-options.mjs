import {bridgeError} from './bridge-transport.mjs';

export const thinkingOptions=['none','minimal','low','medium','high','xhigh','max','ultra'];
export function creationSettings(value={}){
  if(!value||typeof value!=='object'||Array.isArray(value))throw bridgeError('Invalid creation settings.',400);
  const text=(key,max)=>{
    const v=value[key]??'';
    if(typeof v!=='string'||v.length>max||v.includes('\0'))throw bridgeError('Invalid '+key+'.',400);
    return v.trim();
  };
  const projectId=text('projectId',256)||null,environment=value.environment??'local',branch=text('branch',256),model=text('model',128),thinking=text('thinking',16),template=text('template',2000);
  if(!['local','worktree'].includes(environment)||thinking&&!thinkingOptions.includes(thinking))throw bridgeError('Invalid execution settings.',400);
  if((environment==='worktree'&&!projectId)||(branch&&environment!=='worktree'))throw bridgeError('Worktree and branch settings require a Git project.',400);
  return {projectId,environment,branch,model,thinking,template};
}
export function creationArguments(settings,prompt){
  if(typeof prompt!=='string'||!prompt.trim())throw bridgeError('Enter a task prompt.',400);
  const combined=[settings.template,prompt.trim()].filter(Boolean).join('\n\n');
  if(Buffer.byteLength(combined)>5000)throw bridgeError('Task prompt and template must fit within 5000 UTF-8 bytes.',400);
  const environment={type:settings.environment};
  if(settings.branch)environment.startingState={type:'branch',branchName:settings.branch};
  return {prompt:combined,target:settings.projectId?{type:'project',projectId:settings.projectId,environment}:{type:'projectless'},
    ...(settings.model?{model:settings.model}:{}),...(settings.thinking?{thinking:settings.thinking}:{})};
}
