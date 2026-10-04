import {test,expect} from '@playwright/test';

test.use({launchOptions:{ignoreDefaultArgs:['--hide-scrollbars']}});

for(const scrollbarWidth of ['auto','thin'])test(`Board cards retain their geometry with ${scrollbarWidth} scrollbars when a column gains and loses overflow`,async({page})=>{
  await page.request.post('/fixture/reset');
  await page.goto('/');
  await page.getByRole('button',{name:'Codex Kanban',exact:true}).click();
  await expect(page.locator('#status')).toHaveText('MCP App initialized');
  const cards=page.frameLocator('iframe').locator('.column[data-group-id="chats"] .cards');
  await expect(cards.locator('.card')).toBeVisible();
  const measurements=await cards.evaluate((container,scrollbarWidth)=>{
    // Exercise full-width scrollbars as well as the unmodified production thin style.
    const style=document.createElement('style');
    style.textContent='.board:not(.list) .cards{scrollbar-width:auto}';
    if(scrollbarWidth==='auto')document.head.append(style);
    const computedWidth=getComputedStyle(container).scrollbarWidth;
    const card=container.querySelector('.card');
    const measure=()=>{
      const {x,width,height}=card.getBoundingClientRect();
      return {x,width,height,gutter:container.offsetWidth-container.clientWidth,overflows:container.scrollHeight>container.clientHeight};
    };
    const before=measure();
    const spacer=document.createElement('div');
    spacer.style.height=(container.clientHeight+200)+'px';
    container.append(spacer);
    const overflowing=measure();
    container.scrollTop=100;
    const scrollTop=container.scrollTop;
    spacer.remove();
    const after=measure();
    style.remove();
    return {before,overflowing,after,scrollTop,computedWidth};
  },scrollbarWidth);
  expect(measurements.computedWidth).toBe(scrollbarWidth);
  expect(measurements.before.overflows).toBe(false);
  expect(measurements.overflowing.overflows).toBe(true);
  expect(measurements.scrollTop).toBeGreaterThan(0);
  // Overlay scrollbars consume no width and would let broken CSS pass.
  expect(measurements.overflowing.gutter).toBeGreaterThan(0);
  expect(measurements.overflowing).toEqual({...measurements.before,overflows:true});
  expect(measurements.after).toEqual(measurements.before);
});
