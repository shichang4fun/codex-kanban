# 回归测试标准

修改交互、布局、MCP transport 或 Desktop 桥接后，提交前执行：

```sh
npm ci
npx playwright install chromium
npm run test:regression
```

`test:regression` 顺序运行 Node 测试和真实 Chromium 交互测试。浏览器使用隔离的合成任务、正式构建的 MCP UI 和 SDK 宿主桥接；不启动模型，不更改真实任务。独立调试可用 `npm run test:browser`，或 `npm run test:browser -- --headed`。

滚动条几何测试在 macOS 为临时 Chromium 进程传入 `AppleShowScrollBars=Always`，确保使用真实占用宽度的滚动条；不写入系统偏好，退出后删除临时启动文件。其他浏览器测试保持默认滚动条模式。

## 必须保持的交互契约

| 场景 | 验收标准 | 自动覆盖 |
| --- | --- | --- |
| 列滚动条显隐 | 占用宽度的普通及生产细滚动条，卡片区从不溢出到溢出再恢复时，卡片位置、宽度、高度及预留槽宽不变，溢出时仍可滚动 | 浏览器 |
| Board / List 跨组拖动 | 从卡片点击层起拖，拖入空组或已有卡片的组；三个流程组、Pinned、Ungrouped 均可接收 | 浏览器 |
| 清除分组 | Ungrouped 写入 `null`，不写显示 ID `chats`；折叠时拖入会展开，刷新后保持，轮询恢复 | 浏览器、Node |
| 项目继承、项目置顶 | 只移动任务，保留项目关联，使用任务自身的原分组校验 | 浏览器、Node |
| worktree 项目识别 | 本机 projectId 为空时按唯一 Git 共享目录匹配正式项目，保留本机空字段与自身分组；显式归属优先，普通 checkout、异常 Git 边界不推断；空字段不恢复旧快照；继承项目可显式设置、切换及清除，写入次数和来源字段正确 | 浏览器、Node、真实 Git |
| 组内排序、group 排序 | 只保存浏览器顺序，不调用原生移动；重载后保持 | 浏览器、Node |
| 取消拖动 | Escape 取消，无写入、无聊天导航，轮询恢复 | 浏览器 |
| 桥接断连与重连 | 使用中断连出现持续提示，说明受影响操作及恢复方式；提供手动检查；断连时不可跨组写入，恢复后提示消失，无需重载即可移动 | 浏览器、Node |
| Git 自动/手动刷新 | Git 自动缓存 30 秒，PR 60 秒，任务轮询 3 秒；只有 Refresh 显式绕过 Git/PR 缓存，按查询完成后的实际分支刷新 PR；pending 去重、读取非阻塞、草稿保留；首次点击有效，按住移出 iframe 后轮询恢复 | 浏览器、Node |
| 写入冲突 | 模拟外部客户端同时移动至第三组，显示错误并回读新分组；保留项目关联，不自动重复写入 | 浏览器、Node |
| Pin、Archive / Undo、项目编辑、重命名、筛选、创建入口 | 对应现有 Node 用例必须通过；测试不能实际启动任务 | Node |
| Archive 首次点击、滞后读取与 Undo 提示 | 首次点击显示处理中并禁止重复操作；确认后旧读取不能带回卡片；同一任务一个 Undo，8 秒后关闭且轮询不再弹出；撤销后旧读取不能隐藏恢复的卡片，保留分组和项目；慢撤销及失败重试保留撤销入口 | 浏览器、Node |
| Rename 弹窗和原生同步 | 桌面、窄屏和高视口均按内容高度显示；更新的桥接只通过客户端重命名一次并回读确认；保留其他任务字段，失败保留草稿且不切换通道重试 | 浏览器、Node、隔离原生 |

新增或修复用户交互时，先加入能在旧代码上失败的用例，再修复。浏览器用例应操作用户实际点击的节点，不手工调用拖放回调；必须同时核对 DOM 结果、写入次数和保留字段。新边界场景加入此表及相应测试。

## CI 和发布门禁

Tests 和 Publish marketplace 均执行 Node 全量测试与 `test:browser`；任何失败都会阻止发布构建继续。失败时上传 `test-results/` 中的截图、错误上下文及 trace，保留 7 天。本地用 `npx playwright show-trace <trace.zip>` 查看。

浏览器测试证明 MCP 宿主内的交互及 transport 契约，不代表当前 Desktop 已连接。涉及安装、启动链或原生协议时，另运行 `npm run test:integration` / `npm run test:install-native`，并在真实客户端核对桥接连接及侧栏回读；不要以合成测试通过代替这些验收。

## 性能基线

```sh
npm run test:performance
```

使用正式 MCP UI、SDK 宿主及隔离 Chromium，对 50、200、1,000 条合成任务测量 Board/List、项目视图、搜索、折叠、无变化刷新和单任务变化。每项预热 3 次、采样 15 次，输出 p50/p95 到 `performance-results/latest.json`；1,000 条任务另测正常动画偏好。计时包含同步操作及强制布局，随后等待两帧；不等同于完整可见响应时间或 Desktop 原生侧栏耗时。首开是单次 Playwright 点击到卡片可用的观测。

脚本断言任务数量、无变化刷新保留 DOM、运行状态读取覆盖完整、RPC 并发上限、无浏览器异常及无 fixture 移动/归档/导航。后端 RPC 的 0/5/20 ms 延迟是模拟输入，不能当作真实 Desktop 延迟。复用时间格式化器的对照只在隔离浏览器内临时替换函数，核对时间文本、tooltip 和 aria-label 后恢复，不修改业务代码。

可通过 `KANBAN_BENCH_SIZES=50,200,1000`、`KANBAN_BENCH_SAMPLES=15`、`KANBAN_BENCH_OUTPUT=performance-results/baseline.json` 调整规模、采样和保存路径。性能采样应独立运行，避免与测试、构建或其他负载并发；原始结果属于本机环境观测，不作为跨机器的固定毫秒门禁。优化前保留基线，优化后比较相同环境和参数，并单独执行 `npm run test:regression`。
