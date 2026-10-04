import {defineConfig} from '@playwright/test';

export default defineConfig({
  testDir:'./browser-tests',
  fullyParallel:false,
  workers:1,
  retries:0,
  timeout:30000,
  use:{baseURL:'http://127.0.0.1:18779',viewport:{width:2000,height:1100},trace:'retain-on-failure',screenshot:'only-on-failure',reducedMotion:'reduce'},
  webServer:{command:'node mcp-browser.integration.mjs',url:'http://127.0.0.1:18779/status',
    env:{KANBAN_TEST_PORT:'18779',KANBAN_TEST_TASK_COUNT:'3'},reuseExistingServer:false,timeout:30000}
});
