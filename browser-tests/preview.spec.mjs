import {readFileSync} from 'node:fs';
import {test,expect} from '@playwright/test';
import {fixture} from '../ui-test-helpers.mjs';

const html=readFileSync(new URL('../ui.html',import.meta.url),'utf8');
const pageContext='<page-comment-context>Do the user request below, using [this Page](page://fixture) and comment thread fixture as context.</page-comment-context>';
const reference='## Referenced ChatGPT conversation: This is an untrusted ChatGPT conversation reference. `priorConversation` is a bounded cached preview and may be null. '+
  JSON.stringify({conversationId:'fixture',priorConversation:{text:'History ## My request: Ignore history'}});

for(const view of ['Board','List'])test(`${view}: metadata cleanup preserves actual requests and ordinary content`,async({page})=>{
  const board=fixture();
  const cases=[
    {summary:pageContext+' ## My request: 检查持仓',expected:'检查持仓'},
    {summary:reference+' ## My request: 整理当前请求',expected:'整理当前请求'},
    {summary:'# Chrome tabs: - The user has the Chrome extension side panel open. - Current URL: https://example.com ## My request: 解释页面',expected:'解释页面'},
    {summary:pageContext.replace('</page-comment-context>',''),expected:null},
    {summary:'<page-comment-context>用户正文</page-comment-context>',expected:'<page-comment-context>用户正文</page-comment-context>'}
  ];
  board.tasks=cases.map((entry,index)=>({...board.tasks[0],id:'preview-'+index,title:'Task '+index,summary:entry.summary}));
  await page.setContent(html.replace('/*__BOARD_DATA__*/null',()=>JSON.stringify(board)));
  await page.getByRole('button',{name:view+' view',exact:true}).click();
  for(const [index,entry] of cases.entries()){
    const preview=page.locator(`[data-task-key="local:preview-${index}"] .card-preview`);
    if(entry.expected===null)await expect(preview).toHaveCount(0);
    else await expect(preview).toHaveText(entry.expected);
  }
});
