import {test,expect} from '@playwright/test';

const key='local:11111111-1111-4111-8111-111111111111';
const card=app=>app.locator(`[data-task-key="${key}"]`);
const status=async page=>(await page.request.get('/status')).json();
async function open(page,options={}){
  await page.request.post('/fixture/reset',{data:options});
  await page.goto('/');
  await page.getByRole('button',{name:'Codex Kanban',exact:true}).click();
  await expect(page.locator('#status')).toHaveText('MCP App initialized');
  const app=page.frameLocator('iframe');await expect(card(app)).toBeVisible();return app;
}
async function archive(app){
  await card(app).locator('.card-details').click();
  await app.getByRole('menuitem',{name:'Archive',exact:true}).click();
}

test('first archive click removes the task despite stale reads and one Undo expires without returning',async({page})=>{
  const app=await open(page,{staleArchiveBoard:true,archiveDelayMs:700});
  await archive(app);
  await expect(card(app)).toHaveAttribute('aria-busy','true');
  await expect(card(app).locator('.card-archive')).toBeDisabled();
  await expect(app.locator('#task-toast')).toHaveText('Archiving…');
  await expect(card(app)).toHaveCount(0);
  await expect(app.locator('.archive-notice')).toHaveCount(1);
  const state=await status(page);expect(state.archives).toHaveLength(1);expect(state.archived).toBe(true);
  await expect.poll(async()=>(await status(page)).reads,{timeout:6000}).toBeGreaterThan(state.reads);
  await expect(card(app)).toHaveCount(0);
  await expect(app.locator('.archive-notice')).toHaveCount(0,{timeout:10000});
  const expired=await status(page);
  await expect.poll(async()=>(await status(page)).reads,{timeout:6000}).toBeGreaterThan(expired.reads);
  await expect(app.locator('.archive-notice')).toHaveCount(0);
  expect((await status(page)).archives).toHaveLength(1);
});

test('Undo restores the task once and dismissing a later notice survives polling',async({page})=>{
  const app=await open(page,{staleArchiveBoard:true});
  await archive(app);await expect(card(app)).toHaveCount(0);
  await app.getByRole('button',{name:'Undo archive: Sidebar integration fixture',exact:true}).click();
  await expect(card(app)).toBeVisible();await expect(app.locator('.archive-notice')).toHaveCount(0);
  expect((await status(page)).archives.map(p=>p.archived)).toEqual([true,false]);
  await archive(app);await expect(app.locator('.archive-notice')).toHaveCount(1);
  await app.getByRole('button',{name:'Dismiss archive notice: Sidebar integration fixture',exact:true}).click();
  const state=await status(page);
  await expect.poll(async()=>(await status(page)).reads,{timeout:6000}).toBeGreaterThan(state.reads);
  await expect(app.locator('.archive-notice')).toHaveCount(0);await expect(card(app)).toHaveCount(0);
  expect((await status(page)).archives.map(p=>p.archived)).toEqual([true,false,true]);
});

test('failed archive keeps the card and never offers Undo',async({page})=>{
  const app=await open(page,{archiveFailure:true});
  await archive(app);
  await expect(app.locator('#task-toast')).toHaveText('Synthetic archive failure');
  await expect(card(app)).toBeVisible();await expect(card(app)).not.toHaveAttribute('aria-busy','true');
  await expect(app.locator('.archive-notice')).toHaveCount(0);
  const state=await status(page);expect(state.archived).toBe(false);expect(state.archives).toHaveLength(1);
});

test('verified Undo restores the card and its group despite stale restore reads',async({page})=>{
  const app=await open(page,{staleRestoreBoard:true});
  const group=await card(app).evaluate(node=>node.closest('[data-group-id]').dataset.groupId);
  await archive(app);await expect(card(app)).toHaveCount(0);
  await app.getByRole('button',{name:'Undo archive: Sidebar integration fixture',exact:true}).click();
  await expect(card(app)).toBeVisible();await expect(app.locator('.archive-notice')).toHaveCount(0);
  const state=await status(page);
  await expect.poll(async()=>(await status(page)).reads,{timeout:6000}).toBeGreaterThan(state.reads);
  await expect(card(app)).toBeVisible();
  expect(await card(app).evaluate(node=>node.closest('[data-group-id]').dataset.groupId)).toBe(group);
  expect((await status(page)).archives.map(p=>p.archived)).toEqual([true,false]);
});

test('slow failed Undo keeps its recovery action past notice expiry and permits one retry',async({page})=>{
  const app=await open(page,{restoreDelayMs:8500,restoreFailures:1});
  await archive(app);await expect(card(app)).toHaveCount(0);
  const undo=app.getByRole('button',{name:'Undo archive: Sidebar integration fixture',exact:true});
  await undo.click();await expect(undo).toBeDisabled();
  await expect(app.locator('.archive-notice')).toContainText('Synthetic Undo failure',{timeout:12000});
  await expect(undo).toBeEnabled();await expect(card(app)).toHaveCount(0);
  await undo.click();await expect(card(app)).toBeVisible({timeout:12000});
  await expect(app.locator('.archive-notice')).toHaveCount(0);
  expect((await status(page)).archives.map(p=>p.archived)).toEqual([true,false,false]);
});
