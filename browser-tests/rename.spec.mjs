import {test,expect} from '@playwright/test';

const key='local:11111111-1111-4111-8111-111111111111';
async function openRename(page){
  await page.request.post('/fixture/reset');await page.goto('/');
  await page.getByRole('button',{name:'Codex Kanban',exact:true}).click();
  await expect(page.locator('#status')).toHaveText('MCP App initialized');
  const app=page.frameLocator('iframe'),card=app.locator(`[data-task-key="${key}"]`);
  await card.locator('.card-details').click();await app.getByRole('menuitem',{name:'Rename',exact:true}).click();
  await expect(app.getByRole('dialog',{name:'Rename task',exact:true})).toBeVisible();return {app,card};
}

for(const viewport of [{width:1200,height:1100},{width:375,height:900},{width:375,height:2000}]){
  test(`Rename fits its content at ${viewport.width} × ${viewport.height}`,async({page})=>{
    await page.setViewportSize(viewport);const {app}=await openRename(page);
    const dialog=app.getByRole('dialog',{name:'Rename task',exact:true}),box=await dialog.boundingBox();
    expect(box.height).toBeLessThan(280);expect(box.width).toBeLessThanOrEqual(380);
    expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(viewport.width);
    await expect(app.getByLabel('Task name',{exact:true})).toBeFocused();
    await app.getByRole('button',{name:'Cancel',exact:true}).click();await expect(dialog).toBeHidden();
  });
}
test('Rename updates the client through Desktop once and preserves the title after polling',async({page})=>{
  const {app,card}=await openRename(page);
  await app.getByLabel('Task name',{exact:true}).fill('Renamed immediately');
  await app.getByRole('button',{name:'Save',exact:true}).click();
  await expect(app.locator('#rename-task')).toBeHidden();await expect(card.locator('.card-title')).toHaveText('Renamed immediately');
  const status=async()=>(await page.request.get('/status')).json(),state=await status();
  expect(state.title).toBe('Renamed immediately');expect(state.renames).toHaveLength(1);expect(state.renames[0].transport).toBe('desktop');
  await expect.poll(async()=>(await status()).reads,{timeout:6000}).toBeGreaterThan(state.reads);
  await expect(card.locator('.card-title')).toHaveText('Renamed immediately');expect((await status()).renames).toHaveLength(1);
});
