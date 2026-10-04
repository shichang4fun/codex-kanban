# 回归测试标准

修改交互、布局、MCP transport 或 Desktop 桥接后，提交前执行：

```sh
npm ci
npx playwright install chromium
npm run test:regression
```

`test:regression` 顺序运行 Node 测试和真实 Chromium 交互测试。浏览器使用隔离的合成任务、正式构建的 MCP UI 和 SDK 宿主桥接；不启动模型，不更改真实任务。独立调试可用 `npm run test:browser`，或 `npm run test:browser -- --headed`。

## 必须保持的交互契约

| 场景 | 验收标准 | 自动覆盖 |
| --- | --- | --- |
| Board / List 跨组拖动 | 从卡片点击层起拖，拖入空组或已有卡片的组；三个流程组、Pinned、Ungrouped 均可接收 | 浏览器 |
| 清除分组 | Ungrouped 写入 `null`，不写显示 ID `chats`；折叠时拖入会展开，刷新后保持，轮询恢复 | 浏览器、Node |
| 项目继承、项目置顶 | 只移动任务，保留项目关联，使用任务自身的原分组校验 | 浏览器、Node |
| 组内排序、group 排序 | 只保存浏览器顺序，不调用原生移动；重载后保持 | 浏览器、Node |
| 取消拖动 | Escape 取消，无写入、无聊天导航，轮询恢复 | 浏览器 |
| 桥接断连与重连 | 使用中断连出现持续提示，说明受影响操作及恢复方式；提供手动检查；断连时不可跨组写入，恢复后提示消失，无需重载即可移动 | 浏览器、Node |
| 写入冲突 | 模拟外部客户端同时移动至第三组，显示错误并回读新分组；保留项目关联，不自动重复写入 | 浏览器、Node |
| Pin、Archive / Undo、项目编辑、重命名、筛选、创建入口 | 对应现有 Node 用例必须通过；测试不能实际启动任务 | Node |

新增或修复用户交互时，先加入能在旧代码上失败的用例，再修复。浏览器用例应操作用户实际点击的节点，不手工调用拖放回调；必须同时核对 DOM 结果、写入次数和保留字段。新边界场景加入此表及相应测试。

## CI 和发布门禁

Tests 和 Publish marketplace 均执行 Node 全量测试与 `test:browser`；任何失败都会阻止发布构建继续。失败时上传 `test-results/` 中的截图、错误上下文及 trace，保留 7 天。本地用 `npx playwright show-trace <trace.zip>` 查看。

浏览器测试证明 MCP 宿主内的交互及 transport 契约，不代表当前 Desktop 已连接。涉及安装、启动链或原生协议时，另运行 `npm run test:integration` / `npm run test:install-native`，并在真实客户端核对桥接连接及侧栏回读；不要以合成测试通过代替这些验收。
