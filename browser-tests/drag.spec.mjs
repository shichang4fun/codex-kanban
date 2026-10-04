import {test,expect} from '@playwright/test';

const key='local:11111111-1111-4111-8111-111111111111';
const card=app=>app.locator(`[data-task-key="${key}"]`);
const group=(app,id)=>app.locator(`.column[data-group-id="${id}"]`);
const status=async page=>(await page.request.get('/status')).json();
async function open(page){
  await page.goto('/');
  await page.getByRole('button',{name:'Codex Kanban',exact:true}).click();
  await expect(page.locator('#status')).toHaveText('MCP App initialized');
  await expect(card(page.frameLocator('iframe'))).toBeVisible();
}

test.beforeEach(async({page})=>{
  await page.request.post('/fixture/reset');
  await open(page);
});

for(const view of ['Board','List']){
  test(`${view}: drag from the title across empty, populated, pinned and Ungrouped groups`,async({page})=>{
    const app=page.frameLocator('iframe');
    await app.getByRole('button',{name:view+' view',exact:true}).click();
    let writes=0;
    for(const destination of ['group-1','group-0','group-3','group-2','chats']){
      const target=group(app,destination);
      // Populated targets exercise bubbling past the card's reorder listener.
      const drop=destination==='group-0'?target.locator('.card-open').first():target.locator('.col-name');
      await card(app).locator('.card-open').dragTo(drop);
      await expect.poll(async()=>(await status(page)).sectionId).toBe(destination==='chats'?null:destination);
      await expect(target.locator(`[data-task-key="${key}"]`)).toBeVisible();
      const state=await status(page);expect(state.moves).toHaveLength(++writes);expect(state.navigationUrls).toEqual([]);
      expect(state.projectId).toBe('desktop-a');
      expect(await page.frameLocator('iframe').locator('body').evaluate(()=>globalThis.kanbanTransport.navigationPending)).toBe(false);
    }
    await page.reload();await page.getByRole('button',{name:'Codex Kanban',exact:true}).click();
    await expect(group(app,'chats').locator(`[data-task-key="${key}"]`)).toBeVisible();
    expect((await status(page)).moves).toHaveLength(writes);
  });
}

for(const view of ['Board','List']){
  test(`${view}: dropping into collapsed Ungrouped expands it and writes null once`,async({page})=>{
    const app=page.frameLocator('iframe');
    await app.getByRole('button',{name:view+' view',exact:true}).click();
    await card(app).locator('.card-open').dragTo(group(app,'group-2').locator('.col-name'));
    await expect(group(app,'group-2').locator(`[data-task-key="${key}"]`)).toBeVisible();
    const target=group(app,'chats'),header=target.locator('.col-head');
    // A finished drag briefly suppresses clicks to avoid opening a chat.
    await expect(async()=>{await header.click();await expect(header).toHaveAttribute('aria-expanded','false',{timeout:100});}).toPass({timeout:2000});
    await card(app).locator('.card-open').dragTo(target.locator('.col-name'));
    await expect.poll(async()=>(await status(page)).sectionId).toBeNull();
    await expect(header).toHaveAttribute('aria-expanded','true');
    await expect(target.locator(`[data-task-key="${key}"]`)).toBeVisible();
    const state=await status(page);expect(state.moves).toHaveLength(2);
    expect(state.moves[1].sectionId).toBeNull();expect(state.projectId).toBe('desktop-a');expect(state.navigationUrls).toEqual([]);
    const reads=state.reads;
    await expect.poll(async()=>(await status(page)).reads,{timeout:6000}).toBeGreaterThan(reads);
  });
}

test('a pinned project task moves independently of its project',async({page})=>{
  await page.request.post('/fixture/reset',{data:{inheritedProject:true}});await open(page);
  const app=page.frameLocator('iframe');
  await app.getByRole('switch',{name:'Project view: Pinned',exact:true}).click();
  await card(app).locator('.card-open').dragTo(group(app,'group-2').locator('.col-name'));
  await expect(group(app,'group-2').locator(`[data-task-key="${key}"]`)).toBeVisible();
  const state=await status(page);expect(state.moves).toHaveLength(1);
  expect(state.moves[0].expectedSectionId).toBeNull();expect(state.projectId).toBe('desktop-a');expect(state.navigationUrls).toEqual([]);
});

test('disconnected group capability keeps cross-group dragging read only',async({page})=>{
  await page.request.post('/fixture/reset',{data:{groupActions:false}});await open(page);
  const app=page.frameLocator('iframe');
  await expect(app.locator('#native-note')).toContainText('Desktop group connection unavailable');
  await card(app).locator('.card-open').dragTo(group(app,'group-2').locator('.col-name'));
  await expect(group(app,'chats').locator(`[data-task-key="${key}"]`)).toBeVisible();
  const state=await status(page);expect(state.moves).toEqual([]);expect(state.navigationUrls).toEqual([]);
  await page.request.post('/fixture/reset');
  await expect(app.locator('#native-note')).toBeHidden({timeout:6000});
  await card(app).locator('.card-open').dragTo(group(app,'group-2').locator('.col-name'));
  await expect(group(app,'group-2').locator(`[data-task-key="${key}"]`)).toBeVisible();
  expect((await status(page)).moves).toHaveLength(1);
});

test('a rejected group write restores authoritative placement and does not retry',async({page})=>{
  await page.request.post('/fixture/reset',{data:{moveFailure:true}});await open(page);
  const app=page.frameLocator('iframe');
  await card(app).locator('.card-open').dragTo(group(app,'group-2').locator('.col-name'));
  await expect(app.locator('#task-toast')).toHaveText('Synthetic group conflict');
  await expect(group(app,'group-1').locator(`[data-task-key="${key}"]`)).toBeVisible();
  const state=await status(page);expect(state.moves).toHaveLength(1);expect(state.sectionId).toBe('group-1');
  expect(state.projectId).toBe('desktop-a');expect(state.navigationUrls).toEqual([]);
});

test('Desktop loss during use shows a persistent recovery banner and manual recheck clears it',async({page})=>{
  const app=page.frameLocator('iframe');
  await expect(app.locator('#connection-notice')).toBeHidden();
  await page.request.post('/fixture/reset',{data:{desktopConnected:false}});
  await expect(app.locator('#connection-notice')).toBeVisible({timeout:6000});
  await expect(app.getByRole('status').filter({hasText:'Desktop disconnected'})).toContainText('Cross-group dragging and Pin/Unpin are unavailable');
  await expect(app.locator('#native-note')).toContainText('open a local chat');
  await expect(app.locator('#native-note')).toContainText('rechecks automatically');
  await page.request.post('/fixture/reset');
  await app.getByRole('button',{name:'Check connection',exact:true}).click();
  await expect(app.locator('#connection-notice')).toBeHidden();
  expect((await status(page)).moves).toEqual([]);
});

for(const view of ['Board','List'])test(`${view}: reordering cards and groups stays local and survives reload`,async({page})=>{
  const app=page.frameLocator('iframe'),later=group(app,'group-0'),cards=later.locator('.card');
  await app.getByRole('button',{name:view+' view',exact:true}).click();
  const original=await cards.evaluateAll(nodes=>nodes.map(node=>node.dataset.taskKey));
  const drop=cards.last().locator('.card-open'),box=await drop.boundingBox();
  await cards.first().locator('.card-open').dragTo(drop,{targetPosition:{x:Math.min(50,box.width/2),y:box.height-2}});
  await expect.poll(()=>cards.evaluateAll(nodes=>nodes.map(node=>node.dataset.taskKey))).toEqual([...original].reverse());
  await group(app,'group-3').locator('.col-head').dragTo(group(app,'chats').locator('.col-head'));
  await expect(app.locator('.column').first()).toHaveAttribute('data-group-id','group-3');
  await open(page);
  await expect(app.locator('.column').first()).toHaveAttribute('data-group-id','group-3');
  expect(await cards.evaluateAll(nodes=>nodes.map(node=>node.dataset.taskKey))).toEqual([...original].reverse());
  expect((await status(page)).moves).toEqual([]);
});

test('Escape cancels a mouse drag and releases polling without navigation or a write',async({page})=>{
  const app=page.frameLocator('iframe'),link=card(app).locator('.card-open'),box=await link.boundingBox();
  await page.mouse.move(box.x+35,box.y+25);await page.mouse.down();
  await page.mouse.move(box.x+80,box.y+25,{steps:5});
  await expect(app.locator('#board')).toHaveClass(/task-dragging/);
  await page.keyboard.press('Escape');await page.mouse.up();
  await expect(app.locator('#board')).not.toHaveClass(/task-dragging/);
  const state=await status(page);expect(state.moves).toEqual([]);expect(state.navigationUrls).toEqual([]);
  await expect.poll(async()=>(await status(page)).reads,{timeout:6000}).toBeGreaterThan(state.reads);
});
