# Git 刷新频率调整方案

## 目标与范围

- Git 分支、HEAD SHA、origin 的自动刷新缓存从 5 秒延长到 30 秒。
- PR / CI / Review 自动刷新维持 60 秒，任务分组、未读和 runtime 轮询维持 3 秒。
- 手动 Refresh 绕过 Git/PR 缓存，立即发起查询；Git/PR 查询仍在后台执行，结果通过后续 3 秒轮询显示，不能阻塞任务状态。
- 页面恢复可见走普通读取：超过 30 秒的 Git 缓存自动查询，未过期的缓存继续复用。
- 本轮只实现这项频率调整及必要的传输链路，不混入全量渲染重构或其他优化。

## 实现

1. `git-status.mjs` 的 Git TTL 改为 30,000 ms；`enrich(board, {waitForFresh, force})` 新增默认 false 的强制刷新选项。正在执行的 Git/PR 请求优先复用，强制请求不启动重复子进程；并发上限维持总计 4、GitHub 2。PR 强刷意图绑定到本次 Git pending 完成后的真实 repository / branch / SHA：通过 pending.then 在 Git 完成后调度 PR force，并继续复用 PR pending；非阻塞返回的旧 Git 快照只能走普通 PR 缓存。冷加载及加入普通 pending 的 force 请求同样保留该意图。
2. `createBoardSource.getBoard({forceGit})` 保留元数据读取合并，但把 Git enrichment 放在共享元数据读取之后。每个调用者单独传递 force 标记，避免强制刷新被并发的普通读取吞掉。Git enrichment 始终 `waitForFresh:false`。
3. `createKanbanService.read({forceGit})` → source 传递布尔值；所有写入后的回读保持普通路径。参数不改变写锁、CSRF、Undo 或运行状态读取。
4. MCP `get_board` 添加可选布尔参数 `forceGit`；`open_board` 保持空 schema。UI 新增常驻紧凑 Refresh 按钮（当前只有断连时 Check connection），`refreshNativeBoard(force=false,{forceGit=false}={})` 将回读/重绘的 force 与 Git 强制查询分开；仅该按钮使用 `/api/board?forceGit=1`。普通轮询、恢复可见、Check connection、写入失败回读继续 `/api/board`。MCP fetch adapter 和 HTTP server 同时解析这一个明确参数，保持其他路由和写入参数不变。
5. Git/PR 的 `checkedAt` 只在实际查询完成时更新；刷新期间保留既有值并标记 refreshing。原有 90 秒浏览器 Cached 标记和失败不推断成功的规则维持。

## 验证与门禁

- 虚拟时钟验证每 3 秒调用下，0–27 秒不重复 Git 查询，30 秒重新查询；PR 保持 60 秒。
- 强制刷新验证未过期缓存仍发起 Git 和 PR 查询；并发强制请求复用 pending；慢 Git / GitHub 不阻塞 board 读取，旧时间戳不续期。
- source 验证普通读取尚未完成时，随后到来的强制读取仍传递 force；关闭/失败语义维持。
- MCP、HTTP 和浏览器 UI 单独验证参数从手动入口到 service/source 的完整传递；恢复可见和自动轮询不携带 force。
- 跑 Git 和 transport 聚焦测试、Node 全量、Chromium 交互和原生协议隔离测试。
- 用同一虚拟时钟/工作目录数比较新旧 Git 命令次数，验证真实减少后台负载；不靠墙钟等待 30 秒或降低任务轮询频率获得收益。

## 独立审查

独立 agent `review_git_refresh` 已完成只读审查。指出一处阻塞语义：直接强刷旧显示快照会查询错误分支、遗漏新分支的未过期 PR 缓存。方案已按建议把 PR force 绑定到 Git 完成后的真实身份，并增加预热 A/B 分支、冷加载和普通 pending 加入 force 的测试。其余设计没有发现阻塞，可按修正方案开始开发测试。

实现后的独立复审同样通过。真实浏览器发现首次点击让 iframe 获得焦点，普通刷新会禁用按钮并吞掉点击；已保护 Refresh 的按压过程，按钮内释放延迟清理，移出按钮、取消或失焦立即清理，避免影响后续轮询。复审指出并验证了移出 iframe 释放的边界；独立聚焦测试 16 项全部通过，没有剩余阻塞问题。

## 性能对照

- 同一份 Git reader 源码，只替换 TTL：旧 5,000 ms 对照新 30,000 ms。
- 输入为 20 个不同本地工作目录、同一个 GitHub 仓库/分支，在虚拟时钟 0–57 秒内每 3 秒读取，共 20 次；模拟命令立即成功，每次读取后等待 pending 排空。
- 旧策略执行 600 次 Git 命令，新策略 120 次，减少 **80%**；两组 PR 查询均为 1 次，保持共享缓存与 60 秒 TTL。
- 原始计数保存在本机忽略目录 `performance-results/git-refresh-command-counts.json`。这是稳定成功情况下的命令数对照，不代表实际 CPU、耗电或原生 UI 延迟下降 80%；实际节省取决于工作目录数、命令耗时及手动刷新频率。

## 首次实现验证结果（rebase 前）

- `npm test`：668 项通过，0 失败；最终日志 `performance-results/git-refresh-unit-final.log`。
- Chromium：13 项通过，包含首次手动 Refresh、后续普通轮询、移出 iframe 释放，以及原有拖动、排序、断连与冲突回读；使用 `/tmp/kanban-41c0-playwright.config.mjs` 的独立端口 19843，正式配置未改动。日志 `performance-results/git-refresh-browser-final.log`。
- `npm run test:integration`：通过。一次性 CODEX_HOME、真实 bundled App Server、模拟 Desktop MCP；重命名、项目、分组、Pin/Unpin、Archive/Undo、创建去重等保持，modelTurnsStarted = 0。日志 `performance-results/git-refresh-native.log`。
- 独立 agent 最终复审通过；方案和实现中的边界问题均已修正并加入测试。
- `git diff --check`：通过。
- 该次验收仅覆盖工作区实现，尚未提交、发布或更新已安装插件；实际 Desktop 原生侧栏的安装后验收尚未执行。

## Rebase 与兼容性验证

- PR 基于远端 `origin/main` 的 `e1d67f4`（0.4.54），保留最新归档恢复、Desktop 重命名同步、滚动条稳定性与 worktree 项目识别修复。
- Git 强刷参数经 `currentBoard(options)` 传递，使普通/手动读取都保留已验证的归档和 Undo 状态；新增用例覆盖强刷时旧 reader 快照不能让归档任务重新出现、不能让已恢复任务消失。
- Rebase 后完整验证：Node 686 项、Chromium 28 项及原生协议隔离测试全部通过；滚动条用例使用最新主分支自带的 macOS 进程级经典滚动条配置，未修改系统偏好或测试断言。日志分别为 `performance-results/rebase-latest-unit.log`、`rebase-latest-browser.log`、`rebase-latest-native.log`。
- 独立 agent 对 rebase 冲突整合再次审查通过，归档、Git 刷新及 MCP 聚焦回归 38 项通过。
- `npm run package:marketplace` 通过，仅生成本地包，不安装或发布。
- 性能脚本冒烟通过：50 条合成任务、每项 5 次采样，结果 `performance-results/rebase-latest-benchmark-smoke.json`；该小样本仅用于确认脚本在最新基线上可运行，不更新此前完整性能基线结论。
