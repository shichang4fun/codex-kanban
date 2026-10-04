# Codex Kanban 0.4.55

从 Codex 侧栏查看本机任务，支持看板、列表、项目分组和原生新建入口。

## 快速安装

当前支持 macOS 与安装在 `/Applications/ChatGPT.app` 的 Codex Desktop。无需终端命令、全局 Codex CLI、单独安装 Node 或 npm 依赖：

1. [下载安装包 ZIP](https://github.com/shichang4fun/codex-kanban/archive/refs/heads/marketplace.zip)，解压。
2. 双击 **Install Codex Kanban.command**，自动安装插件、Desktop 桥接、内置自动分类及原图标接入；重复运行会升级并保留分类设置。
3. 如果 Codex 正在运行，正常退出（⌘Q）后，点击原来的 Codex 图标打开。打开任意本机聊天，再从侧栏打开「Codex Kanban」。以后照常从 Dock、Finder 或 Spotlight 启动，无需专用启动器。

首次打开下载的脚本若被 macOS 拦截，右键选择「打开」并按系统提示确认。已有 `codex-kanban@codex-kanban-local` 开发副本时，先在 Codex 中禁用它，避免重复入口。

安装包已包含 Sidebar Flow 当前的 Desktop 自动分类引擎，无需单独安装 Sidebar Flow。只保留结构化事件分类及有界补偿检查，不包含旧 Hook、模型 heartbeat、全局指令注入和旧安装器。已有安装的有效配置迁移到 `$CODEX_HOME/kanban-desktop/flow.json`，保留管理范围、排除任务、检查间隔和分组映射；原安装文件留作备份，新的启动链不再启动它。

看板不再提供顶部自动分组设置按钮，已有自动分类配置继续生效，不影响手动操作。启停由私有 `$CODEX_HOME/kanban-desktop/flow.json` 的 `enabled` 布尔值控制，修改后正常退出并重新打开 Codex。新安装默认管理本机任务，每 60 秒补偿检查。首次启动或重新开启时，打开一个本机聊天即可自动补建缺失的 **In Progress / For Review / For Later** 分组；已有唯一同名分组直接复用。重名时暂停分类，需修改重复名称。创建响应无法确认时，持久记录请求，只回读检查，不自动重发；确认分组已存在后继续，确实缺失时可手动创建。迁移的显式 UUID 映射不会被替换，失效时需恢复原分组或修复映射。

运行且没有待输入／审批的任务进入 In Progress，等待处理或运行结束进入 For Review；未知状态和未观察到运行的历史空闲任务不据此分类。普通策略保护 Pinned、自定义分组、远程及临时任务；迁移的 `forceStatusSections` 显式策略保留原有跨自定义分组行为和更严格的 For Later 时间戳检查，详见 [运行时说明](flow/README.md)。自动分类不会启动模型任务，和手动操作共享完整读写事务锁。关闭后丢弃旧事件，重新开启使用新的观察器。

仅需基础看板时，也可以使用官方 CLI：

```sh
codex plugin marketplace add shichang4fun/codex-kanban --ref marketplace
codex plugin add codex-kanban@codex-kanban
```

这两条 CLI 命令只安装基础插件；双击安装器则一并完成桥接及原图标接入，无需填写任务 ID、路径或编辑配置文件。首次启用需要正常退出并重新打开客户端，无需重启电脑，安装器不会退出正在运行的客户端。没有全局 `codex` 命令时，查看下方 [安装详情](#github-安装两条命令)。

安装器使用一个用户级 LaunchAgent，在登录时恢复 `CODEX_CLI_PATH`。已有 Sidebar Flow 原图标接入时，复用它的同一个任务和稳定入口，保留原有 manifest／plist，并备份辅助脚本。不会修改应用包、签名或 Dock 图标。启动链为原图标 → Kanban（含自动分类）→ 官方 CLI，只有一个原生子进程。`CODEX_HOME` 在子进程中使用安装时的目录，不设置 GUI 全局 `CODEX_HOME`。

启动前检查运行时及模块链接；Kanban 不可用时直接使用应用内官方 CLI，不重新启用旧的独立分类器。自动分类引擎不可用时保留手动桥接；Node 或路由配置缺失也有原生启动回退。进程开始处理输入后不会自动重启或重放请求。官方 CLI 本身不可用时明确退出，不启动未知程序。

需要撤销接入时，打开 `~/Library/Application Support/Codex Sidebar Flow Original Icon/Disable Kanban Original Icon.command`（无 Sidebar Flow 时目录为 `Codex Kanban Original Icon`）；它恢复原来的 Sidebar Flow 接入或移除 Kanban 自己的登录任务，不删除插件数据。若 Node 或模块损坏，使用同目录的 **Emergency Disable Original Icon.command**：它停用整条原图标自动接入并保留文件，随后正常退出并重新打开客户端。重装 Kanban 可恢复接入。旧版 Sidebar Flow 更新器可能恢复其原始辅助脚本；此时重跑 Kanban 安装器恢复，两者不需要各自增加后台任务。检测到不认识的启动设置或文件修改时会停止并保留现场。

发布者合并到 `main` 后，[Publish marketplace](https://github.com/shichang4fun/codex-kanban/actions/workflows/publish.yml) 自动测试并发布新版；完整步骤见 [发布说明](#发布者自动发布新版)。

## 功能与行为

任务卡片支持右键打开与右下角 ⋯ 相同的操作菜单，菜单在鼠标位置展开并限制在视口内；键盘可用菜单键或 Shift + F10 打开，Esc 返回操作按钮。Board、List 和 Project View 内的任务卡片行为一致。

菜单中的 Rename 支持修改本机任务标题。居中弹窗宽度最多 360px，高度随内容收缩；窗口预填当前名称，Enter 保存，Cancel 或 Esc 取消，空白名称不写入，保存失败时保留输入。更新的 Desktop 桥接通过客户端 `set_thread_title` 修改标题并同步原生界面，避免独立进程写入后等待客户端轮询。未连接或旧桥接不支持时使用原生 `thread/name/set`；已派发的客户端写入失败不会切换通道重试。两种通道均在写入前检查标题和非归档任务身份，写入后回读同一任务确认；远程任务和无法核验的任务显示禁用原因。

自动刷新间隔为 3 秒，切回窗口或标签页时立即读取；慢请求尚未完成时不会叠加轮询。项目、分组、任务目录与桥接连接状态并行读取，Git／PR 信息在后台刷新，避免慢工作目录阻塞任务状态。只更新时间戳的响应不重建卡片。菜单、编辑窗口和拖动期间暂停自动重绘，保留输入、焦点和滚动位置。

侧栏 MCP App 完成握手后，点击卡片立即通过官方 `app.openLink` 发送导航请求；同一链接在等待响应期间只发送一次，并显示打开中的边框和光标。按住卡片或时间戳、以及等待导航响应时暂停刷新和过期提示更新，避免点击目标被替换或移位；导航结束后恢复。拒绝打开时显示原因并允许重试。聊天页的加载仍由 Codex 客户端处理，尚未测量实际进入聊天页的耗时变化。

顶部 Aa 文字大小选项提供 90%、100%、110%、120%、130% 五档，100% 恢复默认。看板、列表、详情、菜单及输入控件的文字按比例调整，不缩放图标或整个页面。选择保存在当前浏览器并同步同源标签页；存储不可用时仍可调整并提示。字体变化保留当前任务顺序、筛选和键盘焦点。

卡片快捷操作和无项目的淡色文件夹按钮在鼠标悬停、键盘聚焦或菜单展开时显示；普通鼠标点击留下的焦点不保留按钮，自动重绘只恢复键盘焦点。无项目的卡片不显示 Set project 占位文字；文件夹按钮提示 Set project，点击继续打开项目菜单。菜单展开期间保留按钮，预留按钮尺寸避免卡片跳动；触屏也可通过右下角 ⋯ → Project 设置。有项目时保留文件夹图标及项目名称。

头部左侧显示标题、结果数量和未读收件箱；未读总数用蓝色数字角标显示，不随搜索或主机筛选变化，零未读隐藏角标但保留切换入口，超过 99 用 99+ 显示且提示保留实际数量。点击收件箱切换仅未读／全部，开启时高亮。标题和数量按实际文字宽度排列，保留 10px 间距。切换时两处宽度均以 160ms 线性过渡，标题同步淡入淡出，收件箱随文字宽度平滑移动；使用等宽数字。测量独立文字层，避免把动画中的容器宽度作为目标；隐藏状态不写入零宽度。连续切换由 CSS 从当前过渡状态反向衔接，减少动态效果时取消过渡。宽屏搜索以整个窗口为中心，左右区域等宽；Board／List 合为完整分段控件，右侧显示 Host、Theme 和字号下拉选项，移除自动分组设置按钮。固定使用稳定顺序与每 3 秒自动刷新。主机标签和 Clear filters 放在搜索下方，清除筛选保留排序及布局。选择器保留原节点及焦点，刷新不重置有效选择。窄屏搜索独占一行，极窄屏布局及选择器另起一行并自动换行。

顶部 Theme 提供 System、Light、Dark 三种模式，默认 System；localhost 跟随系统色彩偏好，侧栏 MCP App 优先跟随 Codex 主机主题通知。手动选择后固定主题；选择按浏览器来源保存并同步同源标签页，存储不可用时仍可切换并提示。浅色与深色覆盖看板、列表、详情、菜单和 Undo 提示，并使用对应的状态色。看板内部侧栏及折叠按钮已移除，项目标签去掉徽章边框，筛选与布局控件减少外框；分组项目视图保留为单个文件夹按钮，选中时高亮。列宽、拖放、快捷操作及原生写入规则保持原有实现。

界面统一使用英文；用户任务名称、摘要及自定义分组保留原文。参考 Linear 的深色任务工作台：完整宽度的任务区域、按原生分组排列的卡片、看板／列表切换和右侧详情面板。`index.html` 可直接打开；支持搜索、主机筛选、排序和分组折叠。本机任务点击卡片可通过官方 `codex://threads/<thread-id>` 链接打开聊天，卡片右上角悬停显示 Pin／Archive，右下角 ⋯ 展开项目、分组及详情菜单。无法生成有效直达链接的任务保留复制打开指令及剪贴板失败后的文本框。

界面只使用原生分组，移除 Runtime status 筛选／分组与独立的 Local workflow。移除看板内部侧边栏，只在标题旁提供未读收件箱按钮；默认展示全部任务，开启后仅显示未读任务，关闭后恢复全部任务，筛选在轮询及 Board／List 切换中保持。置顶任务继续放在 Pinned 分组；页头合并为当前视图名称、结果数量和常用操作，不再重复展示标题、面包屑、常驻说明和页脚统计。本机卡片隐藏重复的 Local 标签，其他主机继续显示。读取时间、运行快照时间和覆盖范围可在任务数量提示中查看；自动刷新不重新加载页面或清除当前 Undo 入口，读取失败后继续自动重试。连接失败、只读状态、主机不可用和读取缺口仍有明确提示。

详情的 Open chat 提前到标题下方；仅无法直接打开的任务显示 Copy open instruction。常用属性只保留主机、更新时间和项目，原生 Group 选择器保留；任务 ID、主机 ID、工作目录、分组来源及运行观察记录默认折叠在 Technical information 中。移除重复 Group 属性和底部 Close，右上角关闭、Esc 和点击遮罩继续可用。

Group 禁用时显示具体原因，包括项目归属无法核验、远程任务、Desktop 桥接未启用、操作进行中和无法确认的成员关系。项目归属已核验且自身分组明确为空的本机任务可以单独修改 Group，项目容器位置和归属保持不变。任务离开当前看板数据后，详情保留跳转入口并显示提示，暂时禁用分组修改；后续读取到该任务会恢复正常状态。筛选无结果只显示一个全局空态，有结果时空分组显示未匹配提示；主机选项随刷新同步，保留有效选择，主机消失时回到 All hosts。

本机 Git 仓库的卡片仅在有分支名或已匹配 PR 时显示对应信息（Draft／Open／Merged／Closed），PR 标签可打开原链接；多个匹配结果从详情查看。没有 PR 时只显示已有分支，不显示查询中、未关联或无匹配等占位提示；两者都没有时整行隐藏。详情的 Branch & pull requests 区域同样按实际信息显示，空区域隐藏；PR 链接、CI／审阅结果和读取时间随已匹配 PR 展示。提交 SHA、仓库、匹配依据及查询诊断保留在折叠的 Technical information 中。搜索支持分支、仓库和 PR 编号。

分支描述当前工作目录，共享目录会显示同一分支及 PR 匹配结果，不等同于任务明确附加的 PR。仅本机 GitHub origin 使用仓库与当前分支自动匹配；已合并／已关闭 PR 还要求其 head SHA 与当前 HEAD 一致，避免复用分支名时关联历史 PR。分离 HEAD 的提交和未关联原因仅放在技术信息中，不通过起始提交反查 PR：新 worktree 可以从已有 merge commit 创建，但并不属于那个 PR。跨仓库 fork PR 暂不自动关联。Git 读取缓存 30 秒，GitHub 使用已登录的 gh 在后台刷新、缓存 60 秒，并预留本地 Git 读取并发。头部 Refresh 按钮立即发起 Git 和 PR 后台查询，结果在查询完成后的任务轮询中显示；查询按实际读取的分支匹配 PR，正在执行的查询继续复用。任务分组、未读和运行状态仍每 3 秒刷新，切回页面仅在缓存过期时查询 Git。无结果与不可用的区别保留在技术信息中，仅读取超过 90 秒或时间无效时标注 Cached，正常后台刷新不触发提示；缺少 Git、gh 或访问权限不会影响原生分组。

快捷键：`/` 聚焦搜索，`Cmd/Ctrl B` 切换看板和列表，`Esc` 关闭详情。原生跳转的最终行为由浏览器和 Codex 客户端处理，浏览器自动化无法验证自定义协议跳转。

Board 的每列独立滚动，保留列头；List 使用整页滚动。列滚动位置按原生分组保存，刷新、折叠和布局切换后恢复。折叠分组缩为 48px 竖栏，保留名称、数量、展开按钮和排序／拖放入口。

Pin／Unpin 与 Archive 图标直接放在卡片右上角，默认隐藏，鼠标悬停或键盘焦点进入卡片时以 160ms 过渡显示；触屏保持可见。置顶图标使用实心样式，未置顶使用轮廓样式，远程或不可编辑的置顶任务仅显示只读标记。卡片左下角显示项目，非本机任务另显示主机图标，右下角显示时间及「⋯」操作菜单。Board 和 List 使用相同操作，图标具有操作提示和可访问名称。Pin／Unpin 通过已连接的 Codex Desktop `move_thread_to_sidebar_section` 执行。Pin 使用 Desktop 保留的 pinned ID，Unpin 传 null 清除任务自身分组；每次均回读本机 section 和项目归属确认。未连接新桥接时不显示按钮，不退回独立写入通道。项目容器置顶与任务自身置顶分别识别，任务按钮不移动或取消置顶项目容器。

Pin／Unpin 在读取分组目录后、写入前再次核对任务自身分组；如果 Sidebar Flow 已移动任务，操作会停止并提示刷新，避免清除较新的分类。

默认独立通道的 Archive 调用官方 `thread/archive`；启用客户端桥接后改由 `set_thread_archived` 执行。首次点击立即显示 Archiving… 并禁止重复操作；两种通道均在归档列表回读同一任务 ID 后移除卡片。已确认的归档优先于滞后的看板读取，直到读取端确认卡片已消失，避免旧数据将卡片带回。页面顶部居中显示该任务的 Undo 浮窗，多条提示纵向排列，窄屏两侧保留 16px 空间。同一任务只保留一个入口；浮窗 8 秒后自动关闭，轮询不会重新弹出。撤销进行中暂停自动关闭，失败保留入口供重试。Undo 只接受服务为已确认归档生成的令牌，通过原通道恢复，并回读非归档列表后恢复卡片和原来的分组；成功后移除提示；读取端尚未看到恢复结果时，保留已确认恢复卡片的分组和项目，直到读取追上后再跟随外部变化；恢复卡片尚未被读取端确认时，标题、分组、置顶和项目编辑会提示等待同步，不使用恢复快照写入。原生恢复可能将工作目录路径规范化，验证按任务 ID 匹配，避免 /var 与 /private/var 别名导致误报。撤销入口属于当前页面与服务会话；浮窗关闭或服务重启后，可从 Codex 归档列表恢复。

所有操作仅支持本机任务，重复点击被阻止；失败保留卡片或撤销入口和错误提示。读取与操作互斥，刷新后恢复同一任务的操作控件焦点，保持自动读取。独立归档接口会拒绝被其他 Codex 会话占用的任务，提示用户在 Codex 内归档后刷新；不会强制停止任务。本地排序记录保留，Undo 不执行模型任务，也不重新分类流程状态。

已用隔离的临时 CODEX_HOME 和离线测试任务验证官方置顶、取消置顶、归档及恢复，确认恢复保留原来的 Pinned 分组；未修改任何现有用户任务。已打开的 Codex 侧边栏是否立即刷新尚未端到端验收。

卡片直接以任务标题开头，不显示顶部的状态和任务 ID 行。未读标记放在标题左侧，使用醒目的橙色圆点和更粗的标题，看板与列表位置一致。有有效运行记录的任务显示运行图标并隐藏未读标记，但保留真实未读状态用于计数和筛选；运行记录失效或任务不再运行时按未读状态恢复圆点。置顶标记保留在底部；完整任务 ID 和运行状态记录保留在详情中。

列表视图中，每个分组有独立边框、标题背景和组间留白，内部行保留分割线。分组折叠与拖拽排序继续可用。

状态颜色统一使用语义变量：进行中为蓝色，待审阅／完成为绿色，稍后处理／待办／需关注为琥珀色，置顶为紫色，未读为珊瑚橙，普通任务为蓝灰，未知／未加载为低饱和灰，错误为红色。分组图标、任务旋转图标、运行状态及侧边栏使用同一套颜色。

任务标题旁的运行图标只依据有效运行状态显示，与 Sidebar groups 和 Local workflow 的所属分组无关；手动从 Pinned 移入 In Progress 不会触发运行图标。仅实时运行状态使用旋转圆弧，快照中的运行记录保持静止并在提示中注明 snapshot，过期、未知、空闲或等待输入时不显示运行图标。看板和列表均支持，分组标题保留静态图标。动画以文档时间轴为共同起点，每 3 秒刷新、切换视图和折叠重绘时继续原有角度；旧动画显式取消，折叠隐藏的任务不创建旋转动画。系统开启减少动态效果时保持静止。

自动刷新时，换组和排序引起的位置变化使用 500ms 平滑移动，新增卡片和新增未读圆点使用 180ms 淡入。位置未变化时不播放移动动画；保留滚动位置，不为折叠隐藏的任务创建动画。Board 和 List 均支持，拖拽、隐藏页面和系统减少动态效果时跳过过渡。后续刷新会从当前动画位置衔接，并取消旧动画。

项目标签按主机 ID + projectId 精确匹配正式项目名称；不使用工作目录名。本机显式项目字段优先；字段为 null 的 linked worktree，通过 `.git` 指针与 `commondir` 的真实路径核对已注册项目的 Git 目录，唯一匹配时显示继承的项目归属，即使没有桌面快照也可识别。普通 checkout、缺失元数据或多个项目匹配时不推断归属。没有项目关联或名称无法确认时隐藏标签，完整工作目录保留在详情。snapshot.json 的 projects 和 projectsCapturedAt 来自单独的项目目录快照；更新项目目录不刷新运行状态采集时间。

每个分组标题旁有独立的 Project view 小开关，默认关闭；开启后只在该组内按项目聚合，显示项目名称和筛选后的任务数，Board 和 List 均支持。项目按主机 ID + projectId 区分，同名项目不会合并；未关联项目的任务放在 No project，项目名称未确认时显示 Unnamed project。有项目的子分组优先展示，No project 固定放在最后；各项目之间及项目内任务沿用当前排序的首次出现顺序。启用项目聚合的组只允许在同一项目内重排，关闭后恢复完整分组的手动顺序。开关状态按分组模式和分组 ID 分别保存在当前浏览器并同步同源标签页，各组独立，Board 和 List 共用同组设置。旧版全局开关不再使用。不改变原生分组或项目关联。

本机未读标记每 3 秒只读回读桌面持久化的 electron-thread-read-state-v1，并覆盖旧快照中的 isUnread；不修改原应用文件。此为当前已核对的内部格式，并非官方稳定接口：仅接受单一身份、单一本机连接、版本 1，格式未知或读取失败时退回桌面快照。读取其他身份不明确的数据时不猜测。其他主机继续使用桌面快照；云端持久化标记已观察到与桌面工具不一致，因此不用于实时未读判断。

未保存自定义列顺序时，默认将 In Progress 放在 For Later 前面，其他列保留原位置。拖拽分组标题可调整整列的显示顺序；拖到目标列左半边放在它之前，右半边放在它之后。列表视图也支持分组排序；标题聚焦后可用 `Alt + 方向键` 移动。继续使用原来的 native 浏览器存储键，刷新和自动更新后保留，同源标签页同步；已保存的自定义顺序优先于默认顺序。新增分组追加到末尾。这只调整看板布局，不移动任务或改变 Codex 侧边栏。

固定使用稳定排序；状态、未读和更新时间刷新时保留已有卡片位置。旧的时间及标题排序偏好不再读取，保留浏览器中的旧记录。Board 和 List 均支持组内任务拖拽排序，拖到目标卡片上半部放在它之前，下半部放在它之后；聚焦卡片或详情按钮可用 Alt + 上／下移动。排序继续使用 native 模式、分组 ID 和主机＋任务 ID 的存储键，自定义位置也在刷新后保留；本机组内重排不修改 Codex 侧边栏或运行状态，显式跨组移动仍使用原生分组接口。初始顺序按最近更新时间排列，此后首次进入该组的任务默认放在最前面，同时进入的多个任务按最近更新时间排列；已有任务的相对顺序保持不变，时间更新不会改变位置。曾在该组保存过位置的任务返回时恢复原位置。搜索和主机筛选不会丢失被隐藏任务的位置，同源标签页同步，存储失败时明确提示。

客户端桥接连接后，每 3 秒通过当前 Desktop 所属 App Server 的 `thread/read` 读取本机任务状态，不启动模型任务。真正运行的任务显示旋转蓝色圆弧，等待输入／审批或空闲时停止显示；持续读取会续期，所以长任务不会因旧快照过期而丢失图标。读取失败或连接中断后，不再续期；浏览器使超过 15 秒的旧状态失效。未启用桥接及其他主机继续使用注明“快照”的静态记录。详情保留上次观察的状态和时间；不能根据分组或过期推断任务空闲或完成。

本机分组通过官方 App Server 只读接口读取：最近 50 个非归档任务，加各本机分组内全部可读取的非归档任务；排除 ephemeral 和子代理任务。本机运行状态优先来自当前 Desktop 连接，未连接时退回带时间的桌面工具快照；其他主机保留快照。没有有效运行状态记录的任务标为未知，不能把独立读取进程的 notLoaded 当成真实桌面状态。`idle` 不表示目标已完成，`notLoaded` 不表示尚未开始。分组、运行状态的读取时间分别显示。

卡片标题下直接显示现有摘要或任务预览，不加 Preview／Summary 前缀：Board 最多两行，List 最多一行，空白或与标题完全重复时隐藏。展示前过滤已知的前置浏览器自动上下文、Page 评论上下文、ChatGPT 对话引用及 Files mentioned by the user 附件清单，保留 My request 后的真实用户请求。Page 和对话引用须匹配已知自动说明；引用须校验完整 JSON，避免误用历史对话里的请求标记。旧版浏览器提示兼容多行及单行格式，须在请求前识别末尾 URL 元数据；边界不明确、只有元信息或元信息已截断时隐藏预览。不移除请求正文中的标签及文件说明，原始摘要保留在详情中。内容来自桌面快照摘要或本机 thread/list 预览（通常是初始用户请求），不代表最新进展。卡片不显示整块悬停说明，时间、PR 和具体按钮保留各自的提示。底部时间表示任务更新时间，时间自身的悬停提示说明它不是摘要或回复时间。不读取完整对话，不生成新摘要。

有效运行状态下，卡片显示 Waiting for input、Waiting for approval 或 Runtime error 标签；两种等待标记同时存在时均显示。快照标签注明 snapshot，观察超过 15 秒或状态不可用时隐藏，空闲和未加载不会推断为完成或失败。运行异常不等于任务目标失败。

卡片在匹配的 PR 下直接显示 CI failed、Changes requested、Review required，点击标签打开对应 PR；多个 PR 时注明编号。仅开放 PR 显示审核提示，草稿只显示 CI 失败，已合并或关闭的 PR 不展示历史异常；正常、未知、检查中等状态留在详情。读取超过 90 秒或时间无效时注明 Cached，菜单或拖拽期间也会原地更新缓存提示。数据继续按工作目录与当前分支匹配，不表示任务完成，也不表示审核一定由当前用户负责。完整 CI／Review 状态仍可在详情查看。

## 侧边栏分组

本机任务优先使用官方 `thread/list` 返回的 `thread.section`，分组目录来自 `threadSection/list`。这与 Sidebar Flow 的本机分组读取路径一致；不能用桌面 `list_threads.sections` 的逻辑成员列表覆盖它。已核实的案例中，桌面列表把同一任务列入 Tasks，而本机字段为 For Review，与用户实际界面一致。两条接口的分组 ID 属于不同命名空间，不能混用。

看板将默认 Tasks 和 Projects 合并显示为 Ungrouped，Board、List 和详情使用相同名称；项目标签仍保留。底层仍区分独立任务与项目继承位置，不修改 Codex 侧边栏或实际任务归属。合并后沿用最先出现的旧默认列位置，稳定排序保留旧 Tasks 的排序，并接续旧 Projects 的排序。真实自定义分组即使同名为 Tasks 或 Projects，也不会被合并。只有本机分组字段明确为空时，任务才按默认位置展示；项目关联优先使用本机原生 projectId，空字段的 linked worktree 可继承经 Git 路径验证的项目，仅字段缺失时才由桌面快照补充；项目容器位置仍由快照补充。项目中的任务有独立分组时，以任务自身分组为准。其他主机单独放入“其他主机（快照）”。详情显示分组依据。For Review 表示待审阅，不代表目标已完成。列内数字是任务卡片数，不是项目容器与任务等混合条目的数量；尚未全量核验所有原生界面边界。

本地服务每次 GET /api/board 都回读本机分组，页面每 3 秒刷新。Sidebar groups 下支持将本机任务拖入 For Later、In Progress、For Review、Pinned，Board 和 List 均可用。所有视图的任务详情中，Native group 选择器支持这三个流程分组、Pinned 和 Ungrouped；可直接将 Pinned 任务移到其他组。选择后保存，回读确认后同时更新详情属性、选择器和卡片位置；失败恢复最新原生分组并显示错误。写入通过 Desktop `move_thread_to_sidebar_section` 执行一次；本机 `threadSection/list` ID 只用于请求校验与原生回读，目标按唯一名称映射为当前 Desktop 逻辑 ID。写入前重新校验目标目录、任务源分组及原生项目关联；不能混用两个 ID 命名空间。移动前检查源分组是否已变化，移动后回读同一任务确认，不自动重试写入。详情选择 Ungrouped 对应清除任务自身分组，写入 null，不能把显示用的 chats 当成原生 ID；项目中的任务清除自身分组后会恢复项目继承位置。继承项目分组的本机任务也支持拖动及详情编辑：要求明确的项目关联和空的任务自身分组，为任务设置独立分组，保留项目归属及项目容器位置（包括项目置顶）。

Sidebar Flow 的自动分类保持原样。手动移动不创建持久覆盖规则，之后自动分类再次移动任务时，看板及已打开的详情跟随最新原生结果；不会把它移回先前手动选择的组。拖入 In Progress 不启动任务，拖入 For Review 不停止任务或宣称目标完成。Board 和 List 均支持拖入 Pinned 置顶，以及从 Pinned 拖到三个流程分组，稳定排序下也可跨组拖动；项目容器本身、云端、远程、临时任务及子代理不支持此操作。项目容器和任务项目关联不被移动。组内重排继续仅调整浏览器顺序。

读取失败会保留最近分组数据并提示，浏览器仍会使过期运行状态失效。连接客户端桥接后，本机运行状态随页面轮询更新；未连接时需更新桌面快照。Pin／Unpin、Archive 和 Undo 保持独立显式操作，并与分组移动互斥，避免重复写入。

## 新增任务与分组默认设置

每个本机原生分组（包括空组和 Ungrouped）的标题旁都有「＋」，卡片后有 New task 链接，直接打开真实 Codex 原生新建页。无预设时使用 `codex://threads/new`，有项目或模板时使用 `codex://new?projectId=…&prompt=…`；Project view 内使用已核验的 Desktop 项目 ID。项目映射不唯一或默认项目已删除时，入口禁用并提示调整默认设置。No project 省略项目参数，由 Codex 原生页面选择默认项目，不保证无项目创建。模型、推理级别、权限和环境在原生页面设置，点击链接不会派发任务，也不要求创建桥接在线。远程聚合列不提供创建入口。

当前客户端的新建 deep link 没有分组参数：创建后需要在 Codex 侧边栏选择分组，不能保证任务自动进入点击入口所在的组。标题提示明确此限制。组标题的 Creation settings 仅显示可传入原生页的默认项目和提示词模板；其他旧默认值保留，供已有 Kanban 创建适配器使用。以下桥接创建、请求日志和恢复说明描述保留的适配器路径，默认 New task 链接不调用它。

默认设置按原生分组 ID 保存在 `$CODEX_HOME/kanban/group-creation-settings.json`（默认 `~/.codex/kanban/`，或 `KANBAN_DATA_DIR`），不写插件缓存。存储支持现有本机项目、Local／Worktree、模型 ID、推理级别和提示词模板；默认界面只编辑项目和模板。保存不创建任务，也不修改 Codex 项目设置；适配器创建时使用选定项目的原生环境配置，留空模型及推理级别沿用 Codex 默认值。Worktree 仅支持已核验的 Git 项目，可填写现有起始分支；不自动创建新分支。模板与输入合计最多 5000 UTF-8 字节。跨进程写锁和原子替换避免并发覆盖；损坏文件或遗留写锁会阻止相关创建写入，需修复后重试。

Create & run 通过当前 Desktop 连接调用原生 `create_thread`，会启动新任务。收到真实任务 ID 后核验项目关联，再按唯一名称映射 Desktop 分组 ID、移动并回读确认；创建可以使用原生自定义分组。保存设置、刷新、移动已有任务和归档不会启动模型执行，已有任务的手动移动目标范围保持原样。

派发前在私有桥接目录的 `creation-operations.json` 记录请求。同一请求不会重复创建；超时或重启后结果未知时可 Check status，确认已创建但分组失败时可 Retry group，仅重试分组。Start another task 明确开始一个独立请求，旧记录仍保留。Worktree 若只返回排队中的 clientThreadId，无法可靠解析真实任务 ID；页面显示排队状态，完成后需在 Codex 原生侧边栏手动分组，不自动重复创建。

桥接创建和默认设置保存需要更新后的客户端桥接；`sync.createWritable` 为 true 才启用。旧桥接或断线时显示原因，不回退到独立写入进程。无项目预选或有已核验项目的原生新建链接仍可用。本机安装包的链接解析与导航代码已核对；浏览器验证覆盖 MCP 宿主链接代理，真实 Codex 落地页尚未自动验收。自动测试使用隔离任务及模拟 Desktop 分发，不调用模型。

## 旧浏览器数据

移除独立本地流程的界面与写入代码，原先 `codex-kanban.workflow.v1:*` 分类和 workflow／runtime 排序数据保留在浏览器中，不删除、迁移或覆盖。当前看板只读取和更新 native 排序；原生任务分组仍以 Codex 回读为准。

## 客户端操作桥接

可选桥接让现有 Codex Desktop 的 App Server 调用 `codex_app.set_thread_archived`，由客户端执行 Archive／Undo；独立连接只负责读取并验证同一任务 ID。健康桥接连接后，服务自动选择此通道，并在 Undo 令牌中记录原通道；已派发的客户端操作失败时不会自动改用独立写入进程。未连接时保留原来的本机独立归档功能，它仍可能遇到 active writer 拒绝。

安装在私有目录中生成代理及备用启动器；一键安装还配置内置自动分类及用户级原图标接入。保留旧 Sidebar Flow 的代理备份，不修改应用签名。启动链为 Kanban（含自动分类）→ 官方 CLI；网页提供归档、恢复、任务分组、Pin、显式新增任务及只读运行状态；已有任务移动允许三个流程分组、Pinned 及清除自身分组，新增任务可归入唯一可映射的原生自定义分组。Create & run 调用原生任务创建；项目容器移动保持关闭。代理保留原始初始化、请求 ID 和事件，等待客户端成功加载一个本机任务后才启用任务操作桥接。

```sh
node setup-desktop-bridge.mjs
```

一键安装后正常退出 Codex，再点击原图标启动。上面的源码命令只配置桥接，可通过备用 `~/.codex/kanban-desktop/Launch Codex with Kanban.command` 启动；备用启动器发现 Codex 正在运行时只提示需要退出，不终止任何进程。启动后打开一个本机任务；`GET /api/board` 的 `sync.desktopArchiveConnected` 表示归档连接状态；`sync.desktopGroupsConnected` 与 `sync.moveWritable` 为 true 才启用任务分组及 Pin 写入。旧桥接、未连接或断线时禁止这些写入；不自动回退写入。连接状态不替代真实客户端工具及侧栏显示验收。看板服务需在安装后启动，以加载连接设置；以后每次检查连接，无需为客户端重连重启服务。

桥接在 Desktop 成功加载本地聊天后取得私有 socket 的所有权；多个后台重连时，只有取得所有权的代理运行自动分组，其余代理等待并定时重试。异常退出留下的 socket 仅在确认连接被拒绝、文件属于当前用户且身份未改变时自动清理；存活连接、权限异常、普通文件及未知符号链接不会被替换。后台退出时代理停止轮询、关闭客户端连接并取消待处理请求，保留后台退出码；归档、移动和创建等用户动作不会因重连自动重放。Kanban 继续轮询，连接恢复后自动撤掉断连提示。

自动测试覆盖进程强制退出后的恢复、并发启动与接管、挂起连接的关闭、启动中断、安装／卸载、登录刷新、旧 Sidebar Flow 重装、启动链、故障回退及真实 App Server；Desktop MCP 分发部分仍为模拟。真实客户端工具授权、侧边栏即时刷新，以及完整退出再打开／重新登录后的 GUI 启动时序需要现场验收，不会为了测试强制退出客户端。升级桥接后，需要正常退出并打开 Codex 一次，使已启动的代理加载新代码；此后后台异常重连无需手动清理 socket。

卡片右下角使用「⋯」打开就地菜单，提供 Pin／Unpin、Project、Section、View details 和 Archive；原有右上角 Pin／Archive 快捷按钮保留。Project 和 Section 悬停时在旁边展开，保留点击、触屏和方向键操作；悬停不抢键盘焦点，移向子菜单时保留短暂缓冲。子菜单自动向可用的一侧展开并限制在视口内，窄屏提供 Back。直接选择并保存，当前项带选中标记，不打开详情；不可写项目和分组置灰并说明原因。项目列表底部提供带文件夹移除图标的「Remove from 项目名」，无归属时隐藏移除项；详情选择器也可移除。仅继承 worktree 项目且本机字段为空时，不显示移除操作，详情显示 Inherited from 项目名；可选择项目建立显式归属。HTTP 使用 null 表示清除，转换为原生协议的空 projectId，写前核对本机原字段、写后回读确认；旧快照不会恢复已移除的显式归属，清除后 linked worktree 仍可显示经 Git 路径确认的继承项目。仅缺少项目字段的旧读取器回退桌面快照，显式 null 不使用旧归属。目录临时失败保留上一份界面数据。工作目录与自身分组不改变。图标按原生菜单的文件夹移动、文件夹移除、斜向图钉、列表及归档样式绘制。菜单支持方向键、Home／End、Esc 及 Tab，点击外部、滚动看板或切换布局时关闭。菜单打开时暂缓轮询刷新，避免打断选择。此菜单使用已有接口，不直接调用 Codex 原生菜单，也未增加 Rename、Unread、Fork 或 Share。

## 使用

需要 macOS、Node.js 22 或更新版本，以及已安装的 Codex Desktop。独立网页预览使用 Node 内置模块；MCP 插件的开发和测试需要安装 SDK 与构建依赖，安装包已内置所需运行库。首次克隆后，在项目目录执行以下命令；已有 snapshot.json 时不要覆盖它：

```sh
cp -n snapshot.example.json snapshot.json
```

空快照也可读取本机任务与原生分组；连接客户端桥接后可持续读取本机运行状态。本机项目目录和归属由原生 API 读取，其他主机信息由宿主工具补充。snapshot.json、生成页面、截图和本机连接配置均不提交到 GitHub。

```sh
node refresh-local.mjs
node --test *.test.mjs
node serve.mjs
```

本地预览：<http://127.0.0.1:8876>。服务器仅监听本机；PR 查询通过 gh 访问 GitHub，只提供仓库、分支或提交 SHA，不发送任务标题与摘要。同源检查和请求限制保留。需要当前官方 Codex CLI，以及本机元数据读取权限。常驻只读 App Server 只调用初始化、项目、分组与任务读取；项目选择与移除使用仅开放 thread/metadata/update 的独立连接，写前检查目标与原归属，写后回读确认，不修改 cwd、运行状态或项目容器；显式 Archive／Undo 使用只增加 `thread/archive` 与 `thread/unarchive` 的连接；Pin／Unpin、跨组拖动与详情修改复用 Desktop 桥接，只读连接负责前后验证，允许三个流程分组、Pinned 及清除自身分组。独立写入控制器仍作为隔离测试基础，不是 HTTP 分组写入的回退通道。不开始模型任务，也不修改 Sidebar Flow 配置。更新运行状态时，让 Codex 使用 `list_threads` 重新保存带采集时间的 snapshot.json；服务会在下一次读取时载入该快照。

## 插件范围

此版本提供本地 STDIO MCP App。`open_board` 注册全局 sidebar 入口，UI 资源为 `ui://kanban/board/v1.html`，MIME 为 `text/html;profile=mcp-app`。看板通过 MCP Apps SDK 的宿主 bridge 调用工具，iframe 不请求 localhost API。十三个工具只对 App 可见；写操作还需要当前服务签发的 action token。HTTP 与 MCP 复用服务实现；写锁、回读和 Undo registry 在同一服务实例内共享，独立进程之间不互通。

插件的 `logo/composerIcon` 配置用于插件展示。侧栏入口从 MCP 工具或服务的 `icons` 读取图标；服务通过内嵌 PNG 提供 Kanban 图标，无需外部网络或访问本机文件路径。

开发与验证：

```sh
npm ci
npm run build:plugin
npm test
npm run test:plugin-native
npm run test:ui
```

固定回归入口为 `npm run test:regression`：全量 Node 测试及真实 Chromium 拖放检查均需通过。首次运行先执行 `npx playwright install chromium`；覆盖范围、断连/重连场景和发布门禁见 [回归测试标准](TESTING.md)。

`test:ui` 启动只含合成任务的手工浏览器验收宿主，终端打印实际端口，可验证 SDK 握手、置顶、分组、归档、Undo 和列表。该命令只启动宿主，不会自动执行断言；自动浏览器验收使用 `npm run test:browser`。这些测试不操作真实任务，也不代表真实客户端 sidebar 验收。

浏览器宿主同时模拟 Codex 强制透明的 body 背景；`KANBAN_TEST_HOST_THEME=light npm run test:ui` 用浅色宿主验证看板自身深色底色，不受透明画布影响。

`test:plugin-native` 使用临时 CODEX_HOME，通过官方 CLI 安装插件并由真实 App Server 验证服务发现、十三个工具和全局入口元数据。它只创建临时上下文，不启动模型任务，结束后清理目录。

`npm run package:marketplace && npm run test:install-native` 验证一键安装器的真实 CLI 安装、重复升级、自动任务上下文、私有桥接和十三个 App 工具。默认使用构建好的本机分发包；可设置 `KANBAN_MARKETPLACE_SOURCE=shichang4fun/codex-kanban KANBAN_MARKETPLACE_REF=marketplace` 验证公开 GitHub 包。隔离的临时 CODEX_HOME 不触碰现有任务，不启动模型或重启当前客户端。

### GitHub 安装：两条命令

发布包位于独立的 `marketplace` 分支，包含已构建 UI 与运行依赖，不需要克隆源码或运行 npm install。需要 macOS、安装于 `/Applications/ChatGPT.app` 的当前 ChatGPT Desktop（含 Codex）。启动器优先使用 PATH 上的 Node.js 22+，否则使用应用内置 Node；可通过 `KANBAN_NODE` 指定兼容的可执行文件。

```sh
codex plugin marketplace add shichang4fun/codex-kanban --ref marketplace
codex plugin add codex-kanban@codex-kanban
```

全局 `codex` 不可用时，可将命令中的 `codex` 替换为 `/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex`。重新加载 MCP 配置或正常重启客户端后，查看侧栏「Codex Kanban」。已有本机版本 `codex-kanban@codex-kanban-local` 时，先禁用该副本，避免重复入口。GitHub 安装不会配置 Desktop 桥接；实时状态、Pin 与分组写入仍需按上面的桥接步骤设置。

更新时执行以下命令，再重新加载 MCP 配置或正常重启客户端：

```sh
codex plugin marketplace upgrade codex-kanban
codex plugin add codex-kanban@codex-kanban
```

这是自托管的 GitHub marketplace，不属于 OpenAI 官方公开目录。双击安装器包含桥接配置；仅使用 CLI 安装的基础看板可按需单独配置桥接。桥接自动使用客户端成功加载的本机任务，无需提供固定任务 ID；目录默认位于 `$CODEX_HOME/kanban-desktop`（未设置时为 `~/.codex/kanban-desktop`）。

### 发布者：自动发布新版

每次合并代码或推送到 `main` 后，[Actions → Publish marketplace](https://github.com/shichang4fun/codex-kanban/actions/workflows/publish.yml) 自动运行。需要重试时仍可点击 **Run workflow**，选择 **main** 并运行。无需手动复制文件、切换分支或配置额外 token。

工作流先安装依赖、执行全部测试，再构建分发包。测试通过后，仅将 `dist/marketplace/` 更新到 `marketplace` 分支，保留原有历史；隐藏的插件目录与启动器权限通过 tar 传递。构建任务只有读取权限，发布任务才拥有仓库内容写权限。重复发布相同内容不新增提交；主干变更或远端写入冲突会停止发布，后续 `main` 推送会触发新一轮发布，也可手动重试。`marketplace` 分支更新不会触发发布工作流。

仓库需要启用 GitHub Actions 并允许发布任务写入 `marketplace` 分支。成功后可查看 [分发包](https://github.com/shichang4fun/codex-kanban/tree/marketplace)，其 README 标明当前版本与安装命令。本机构建使用 `npm run package:marketplace`；不要发布本机安装器生成的私有目录。

### 本机开发安装

```sh
npm run prepare:plugin
codex plugin marketplace add "$HOME/.codex/kanban-plugin-marketplace"
codex plugin add codex-kanban@codex-kanban-local
```

`prepare:plugin` 在私有目录生成 `.agents/plugins/marketplace.json` 和自包含插件，通过插件内的可执行脚本固定当前 Node 路径，符合官方插件命令与目录限制。插件缓存不需要 `node_modules`，保留各业务模块独立的主程序边界。重复准备成功后保留上一份安装包；发布失败时恢复旧包，marketplace 文件通过最后一次原子替换发布。它不修改客户端程序、签名或启动器。插件启用后重新加载 MCP 配置，必要时正常重启客户端，再检查侧栏「Codex Kanban」。CLI 安装成功不能替代入口点击验收。

插件的用户数据默认在 `$CODEX_HOME/kanban/snapshot.json`（未设置 CODEX_HOME 时为 `~/.codex/kanban/snapshot.json`），可用 `KANBAN_DATA_DIR` 指定目录。缺少快照仍可读取本机任务与分组；项目目录从原生 API 读取；其他主机和备用运行快照由宿主 `list_threads` / `list_projects` 更新。服务不写插件缓存。MCP 和原 localhost 网页的本地偏好属于不同存储来源，不自动迁移；iframe 存储不可用时沿用现有错误提示。

归档与 Undo 令牌绑定 MCP 服务实例。刷新数据保留恢复入口，丢失动作响应时下次读取可恢复 Undo；一个 UI 恢复成功后，其他 UI 下次刷新移除相应入口。关闭整个 MCP 服务后，使用客户端归档列表恢复。请求取消或服务关闭都会取消尚在预检中的操作，不执行写入；已经派发的写入继续回读确认，不自动重试。多 UI 操作共用互斥锁，覆盖动作后的回读。

插件与 HTTP 使用相同的 Desktop 能力检查、分组写入和运行状态读取。已启用的桥接每 3 秒读取本机真实运行状态，断线后 15 秒过期；没有桥接时保留桌面快照，禁用 Group／Pin 写入。sidebar 注册本身不授予桌面工具权限。真实 Desktop 写入与即时侧栏更新仍需现场验收。旧 native-sync／native-bridge 不用于当前拖拽。GitHub marketplace 分发不代表通过 OpenAI 官方目录审核。

开发依据：
- https://linear.app/docs/board-layout
- https://learn.chatgpt.com/docs/app-server
- https://developers.openai.com/plugins/build/extensions
- https://developers.openai.com/plugins/build/plugins
- https://learn.chatgpt.com/docs/reference/commands
