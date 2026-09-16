# Customers Plugin（Mattermost 插件）

面向 **Mattermost 10.12.x** 的客户化定制插件，目前提供两个功能：

1. **接管聊天窗口的时间显示** —— 管理员在系统控制台统一配置显示格式（如 `2026-09-15 09:42`），用户也可以在自己的「设置」里按个人偏好覆盖。
2. **新成员历史消息隔离** —— 新加入频道的成员看不到其加入之前的历史消息。

---

## 1. 它能做什么

### 1.1 时间显示自定义

| 能力 | 说明 |
| --- | --- |
| 管理员统一格式 | 系统控制台 → 插件 → Customers Plugin，配置一个格式串，全站立即生效 |
| 用户级覆盖 | 用户 → 设置 → 插件 → **Customers Plugin** → 时间显示，可选择「跟随系统默认 / 自定义格式 / 关闭」 |
| 自定义格式令牌 | 支持 `YYYY MM DD HH mm ss dddd MMMM A Z ...`，还支持方括号字面量（如 `YYYY年MM月DD日 HH:mm`） |
| 时区控制 | 可留空（用浏览器本地时区），或强制到某个 IANA 时区（如 `Asia/Shanghai`、`UTC`） |
| 作用范围 | 仅消息时间（`time.post__time`）或页面内所有 `<time>` 元素（含悬停提示、右侧边栏、搜索结果） |

### 1.2 新成员历史消息隔离

| 能力 | 说明 |
| --- | --- |
| 按加入时间隔离 | 服务端在 `UserHasJoinedChannel` 钩子里记录「谁在什么时候进了哪个频道」，前端据此隐藏更早的消息 |
| 服务端权威 | 边界只由服务端计算并通过 `GET /api/v1/history/boundary` 下发，前端不能自己编造 |
| 多视图覆盖 | 中心频道、右侧线程，可选搜索结果 / 置顶 / 已保存 |
| 管理员回填 | 老成员可通过管理接口 `POST /api/v1/history/boundary` 精确设置边界，不必先移出频道 |
| 提示条 | 频道头部可显示一条提示，说明更早的消息已被隐藏 |

---

## 2. 目录结构

```
customers-plugin/
├── plugin.json              # 插件清单：id、可执行文件路径、webapp 包路径、settings_schema
├── go.mod
├── Makefile                 # build/dist/deploy/enable/disable/logs 等
├── assets/icon.svg
├── build/                   # 官方构建工具（manifest 注入、pluginctl 部署）
│   ├── setup.mk
│   ├── manifest/main.go
│   └── pluginctl/
├── server/                  # 服务端（Go）
│   ├── main.go              # plugin.ClientMain 入口
│   ├── plugin.go            # Plugin 结构体 + OnActivate/ServeHTTP
│   ├── configuration.go     # 系统控制台配置加载、校验、默认值
│   ├── api.go               # 自有 REST 接口：/api/v1/config、/api/v1/history/boundary
│   ├── history.go           # 加入时间 KV 存储 + 历史边界计算
│   ├── api_test.go
│   └── history_test.go
└── webapp/                  # 前端（React + TypeScript）
    ├── package.json / tsconfig.json / webpack.config.js / babel.config.js
    └── src/
        ├── index.tsx                        # 插件入口 registerPlugin
        ├── manifest.ts                      # 由 `make apply` 生成（已提交，方便直接 npm run build）
        ├── constants.ts                     # 插件常量与用户设置字段名
        ├── base_url.ts                      # 计算 <siteURL>/plugins/<id>
        ├── hooks.ts                         # 拉取并缓存服务端配置
        ├── format.ts                        # 格式令牌解析器（基于 Intl.DateTimeFormat）
        ├── time_engine.ts                   # MutationObserver 驱动的 DOM 改写引擎
        ├── resolve.ts                       # 合并「管理员默认值 + 用户偏好」
        ├── user_settings.ts                 # 读取 pp_<pluginId> 偏好
        ├── types/config.ts                  # 配置类型
        ├── types/history.ts                 # 历史边界类型
        ├── types/mattermost-webapp/         # webapp 插件 API 类型
        ├── history_api.ts                   # 拉取并缓存每个频道的历史边界
        ├── history_gate.ts                  # 历史消息隐藏引擎（注入 CSS 规则）
        └── components/
            ├── time_format_controller.tsx   # 注册为 root component 的控制器
            ├── history_gate_controller.tsx  # 历史隔离控制器（root component）
            ├── custom_format_setting.tsx    # 用户设置里的自定义格式输入框
            └── user_timezone_setting.tsx    # 用户设置里的时区输入框
```

---

## 3. 实现原理（重点，先看这一段）

### 3.1 为什么不是「注册一个 React 组件覆盖时间戳」

Mattermost 10.12 的消息时间渲染链路是：

```
PostView → Post → PostHeader → PostTime（webapp/channels/src/components/post_view/post_time/post_time.tsx）
                                  └→ Timestamp（components/timestamp/timestamp.tsx）
                                       └→ SemanticTime → <time class="post__time" datetime="...">
```

`Timestamp` / `PostTime` **并没有**出现在插件的 `PluginRegistry` API 里（`registerRootComponent`、`registerPostTypeComponent`、`registerChannelHeaderButtonAction`… 都没有针对它的覆盖点）。官方 webapp 插件 API 允许的是「追加组件」，不是「替换已有组件」。

所以可行做法只有两条：

1. **改 webapp 源码再重新编译** —— 等于 fork，每次升级都要 rebase，不推荐；
2. **插件内挂一个不可见的 root 组件，用 MutationObserver 重写 `<time>` 的文本** —— 本插件采用的方式，官方支持的 API，零侵入。

### 3.2 DOM 改写引擎怎么工作（`webapp/src/time_engine.ts`）

1. 控制器组件通过 `fetch` 拿到服务端下发的配置，计算出「生效的」`{format, timeZone, selector}`；
2. 引擎调用 `new Intl.DateTimeFormat(...)` 构造格式化器，然后把页面上所有匹配 `selector` 的 `<time datetime="...">` 的 `textContent` 换成格式化结果；
3. `<time datetime>` 里的时间戳是 luxon 转成本地时区的墙钟字符串（无时区后缀），`new Date(datetime)` 会被 JS 按本地时区解析回原时刻，因此再按任意时区输出都没问题；
4. React 会周期性重渲染时间（相对时间刷新、新消息、表情回应、虚拟列表复用节点…），这些都会触发 DOM 变更 → `MutationObserver` 捕获 → 用 `requestAnimationFrame` 合并成一帧执行一次；
5. 每一轮改写都是**幂等**的：文本已经等于期望值时不再写 DOM，所以「改写 → 触发 mutation → 再改写」的回环会在第二轮自动终止，不会死循环；
6. 额外兜底：每 15 秒全量重扫一次（虚拟列表复用节点时 MutationObserver 未必能覆盖）。

### 3.3 配置怎么从服务端传到 webapp

插件的 `settings_schema`（管理员在系统控制台填的那些值）**不会**自动下发到普通用户的浏览器。因此服务端开了一个自有 REST 端点：

```
GET  <siteURL>/plugins/com.example.customers-plugin/api/v1/config
响应 { enabled, timeFormat, timeZone, applyTo, allowUserOverride, presets[] }
```

该路由由 Mattermost 服务器代理，只有携带有效会话（且带 `X-Requested-With: XMLHttpRequest`）的请求才会带 `Mattermost-User-ID` 请求头，否则返回 401。

### 3.4 用户偏好存在哪

用官方的 `registry.registerUserSettings()` 注册的用户设置会**自动**存进 preference：category 为 `pp_<pluginId>`，name 为设置项名。前端直接 `useSelector` 读 `state.entities.preferences.myPreferences['pp_<id>--<name>']` 就能拿到，无需再写服务端接口。

---

## 3.5 频道历史隔离是怎么做的（第二个功能，原理必读）

### 3.5.1 为什么必须这样做

先说结论：**Mattermost 10.12 的插件体系无法「按用户」在服务端过滤帖子**。我把能走的路都查了一遍：

| 方案 | 结论 |
| --- | --- |
| `MessageWillBePosted` / `MessageHasBeenPosted` | 只在**发帖**时触发，与读取无关 |
| `ServeHTTP` 钩子 | 官方文档明确：只有 `/plugins/{id}` 前缀的请求会路由到插件，**拦不到** `/api/v4/channels/{id}/posts` |
| `MessagesWillBeConsumed(posts)` 钩子（9.3+） | 看着正是所需，但有三个硬伤：① 签名里**没有用户上下文**，无法区分请求者；② 只能**替换**帖子、不能删除（省略的帖子仍会返回）；③ 依赖实验 feature flag `FeatureFlags.ConsumePostHook`，默认关闭 |
| webapp `registerPostTypeComponent` 等 | 只能「追加组件」，不能拦截或替换既有帖子 |

所以唯一可行的架构是：**服务端提供权威边界，前端按边界隐藏**。这也是「前端隐藏」方案里能做到最强的一种 —— 边界不可伪造。

### 3.5.2 数据流

```
用户加入频道
   └─ 服务端钩子 UserHasJoinedChannel ──► KV: join_<userId>_<channelId> = { joinedAt }
                                          （UserHasLeftChannel 时删除，重新加入会重新计时）

浏览器进入频道
   └─ GET /api/v1/history/boundary?channel_id=…
        └─ 服务端读 KV → 按配置算出 cutoffAt → 返回 { enabled, cutoffAt, joinedAt }
             └─ webapp history_gate 遍历 DOM 中的消息行
                  └─ redux 查 post.create_at < cutoffAt ?
                       └─ 是 → 写入一条 CSS 规则 [id="post_xxx"]{display:none !important}
```

### 3.5.3 DOM 约定（改版本时必须复查）

`webapp/channels/src/components/post/post_component.tsx` 里：

| 位置 | 元素 id |
| --- | --- |
| 中心频道 | `post_<postId>` |
| 右侧栏（线程/置顶/已保存） | `rhsPost_<postId>` |
| 搜索结果 | `searchResult_<postId>` |

日期分隔符是 `.Separator.BasicSeparator`；频道头部容器是 `#channel-header`；消息列表容器是 `#postListContent`（开启虚拟化时是 `#virtualizedPostListContent`）。

### 3.5.4 为什么用注入 CSS 规则而不是改节点样式

- React 重渲染**不会**撤销一条外部样式表规则，而内联样式可能被覆盖、节点也可能被重建；
- 消息列表是**虚拟化**的（`post_list_virtualized.tsx`），DOM 里通常只有几十行，规则体积很小；
- 隐藏是"幂等"的：规则内容没变就不写 DOM，不会和 MutationObserver 互相触发。

### 3.5.5 已知边界（诚实说明）

- 这是**前端可见性控制**，不是加密。用户打开浏览器开发者工具、或直接调用 Mattermost API，仍可拿到被隐藏的帖子。如果你的场景要求"绝对取不到"，只能靠**私有频道 + 定期归档 / 到期重建频道**，插件层面做不到。
- 插件**只记录安装之后发生的加入事件**。安装前就已在频道里的成员默认不受影响（配置 `存量成员如何处理 = 不限制`）。要让他们也生效，二选一：
  - 把配置改成 `以插件启用时间为边界`（所有无记录的成员统一以插件首次启用时间划线）；
  - 用管理接口精确回填（见下）。
- 若某成员被移出后又重新加入，边界会按**新的加入时间**重算。

### 3.5.6 管理接口：回填 / 清除某人的边界

```bash
# 设置：把 user_id 在 channel_id 的边界设为当前时间（或指定毫秒时间戳）
curl -X POST 'https://mm.example.com/plugins/com.example.customers-plugin/api/v1/history/boundary' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <管理员个人访问令牌>' \
  -H 'X-Requested-With: XMLHttpRequest' \
  -d '{"channelId":"<channel_id>","userId":"<user_id>","cutoffAt":0}'

# 清除：恢复该成员在此频道的完整可见性
curl -X POST '.../api/v1/history/boundary' \
  -H 'Content-Type: application/json' -H 'Authorization: Bearer <令牌>' \
  -H 'X-Requested-With: XMLHttpRequest' \
  -d '{"channelId":"<channel_id>","userId":"<user_id>","clear":true}'
```

`cutoffAt: 0` 表示"取当前时间"。需要调用者是**系统管理员**（`manage_system` 权限），否则返回 403。

---

## 4. 构建与安装

### 4.1 环境要求

- Go **1.24+**（本项目 `go.mod` 写的是 `go 1.24.6`，因为 `mattermost/mattermost/server/public v0.1.21` 需要；低于此版本会提示 toolchain 不匹配）
- Node.js **18+** / npm
- GNU make（Windows 下可用 Git Bash 或 `choco install make`）

### 4.2 一键构建

```bash
cd customers-plugin
make dist
```

产物：`dist/com.example.customers-plugin-0.2.0.tar.gz`

> **Windows 没有 make**：先装一个（`choco install make`，或 `scoop install make`）；装不了就直接跑等价脚本：
> ```bash
> bash scripts/build.sh                 # 构建 linux-amd64 + linux-arm64
> bash scripts/build.sh windows-amd64   # 只构建单个目标平台
> ```
> `scripts/build.sh` 与 `make dist` 的产物完全一致（含 `webapp/dist/main.js` 的正确目录层级）。

### 4.3 没有 make / 只想手动执行

```bash
# 服务端（重复执行下面的命令可覆盖多个平台）
cd server
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -o dist/plugin-linux-amd64

# 前端
cd ../webapp
npm install
npm run build
```

> **注意 `$GOPATH/go.env`（`go env -w`）**：如果你用 `go env -w GOOS=linux GOARCH=amd64` 持久化过交叉编译目标，直接 `go build` 会产出 Linux 二进制，而 `build/manifest`、`build/pluginctl` 这类**必须在宿主机上执行**的工具也会被交叉编译而无法运行。本项目已在这两个地方做了处理：`build/setup.mk` 与 `scripts/build.sh` 都会用 `GOHOSTOS`/`GOHOSTARCH` 覆盖，放心用。

### 4.4 部署

方式一（推荐，需要管理员令牌）：

```bash
export MM_SERVICESETTINGS_SITEURL=https://your-mm.example.com
export MM_ADMIN_TOKEN=xxxxxxxxxx
make deploy
```

方式二：系统控制台 → **插件 → 插件市场 → 上传插件**，选择 `dist/*.tar.gz`，上传后启用。
（若不允许上传，需在 `config.json` 中把 `PluginSettings.EnableUploads` 设为 `true`）

方式三：`make enable` / `make reset` / `make logs` 快速启用、重启、看日志。

### 4.5 开发模式

```bash
make MM_SERVICESETTINGS_ENABLEDEVELOPER=true dist   # 只编译当前平台
# 或热更新 webapp
cd webapp && npm run build:watch
```

---

## 5. 配置项

### 5.1 系统控制台（管理员）

系统控制台 → 插件 → **Customers Plugin**

| 键 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `Enabled` | bool | `true` | 总开关 |
| `TimeFormat` | text | `YYYY-MM-DD HH:mm` | 默认格式串 |
| `TimeZone` | text | 空 | 空 = 浏览器本地时区；否则填 IANA 时区名 |
| `ApplyTo` | dropdown | `post` | `post` 仅消息时间；`all` 覆盖页面所有 `<time>` |
| `AllowUserOverride` | bool | `true` | 是否允许用户自行覆盖 |
| `HistoryLockEnabled` | bool | `true` | 历史隔离总开关 |
| `HistoryMode` | dropdown | `since_join` | `since_join` 只看该成员加入之后；`recent_days` 所有人只看最近 N 天；`off` 不限制 |
| `HistoryDays` | text | `7` | 仅 `recent_days` 生效，正整数 |
| `LegacyMemberMode` | dropdown | `show_all` | 无加入记录的成员：`show_all` 不限制；`since_activation` 以插件启用时间为界 |
| `HideInSearch` | bool | `true` | 是否连搜索结果、右侧栏（线程/置顶/已保存）一起隐藏 |
| `HistoryNoticeEnabled` | bool | `true` | 是否在频道头部显示隐藏提示 |
| `HistoryNoticeText` | text | 见控制台 | 提示文案 |
| `ExemptSystemAdmins` | bool | `false` | 系统管理员是否豁免（便于排障） |

### 5.2 用户设置（当用户覆盖开启时）

设置 → 插件 → **Customers Plugin** → 时间显示

- **时间格式来源**：跟随系统默认 / 自定义格式 / 关闭自定义显示
- **自定义格式**：带实时预览的输入框
- **时区（可选）**：个人级时区覆盖

### 5.3 格式令牌

| 令牌 | 示例输出 | 令牌 | 示例输出 |
| --- | --- | --- | --- |
| `YYYY` | 2026 | `YY` | 26 |
| `MMMM` | September（中文环境：九月） | `MMM` | Sep / 9月 |
| `MM` | 09 | `M` | 9 |
| `DD` | 15 | `D` | 15 |
| `dddd` | 星期二 | `ddd` / `dd` | 周二 |
| `HH` | 09（24 小时，补零） | `H` | 9 |
| `hh` | 09（12 小时，补零） | `h` | 9 |
| `mm` / `m` | 42 | `ss` / `s` | 07 |
| `SSS` | 123 | `A` / `a` | AM / am |
| `Z` | +0800 | `ZZ` | +08:00 |
| `X` | 1789440120 | `x` | 1789440120123 |
| `[文本]` | 原样输出，如 `[年]` → 年 | | |

常用组合：

```
YYYY-MM-DD HH:mm          → 2026-09-15 09:42
YYYY-MM-DD HH:mm:ss       → 2026-09-15 09:42:07
YYYY年MM月DD日 HH:mm       → 2026年09月15日 09:42
dddd HH:mm                → 星期二 09:42
MM-DD HH:mm               → 09-15 09:42
```

> 月份/星期的名称由浏览器 `Intl` 按当前用户 locale 渲染，不需要维护翻译表。

---

## 6. 新增第二个功能时怎么做

插件骨架已经把「服务端配置 → REST 下发 → webapp 消费」这条路打通了，加功能只需：

1. `server/configuration.go` 增加字段并在 `sanitize()` 里校验；
2. `plugin.json` 的 `settings_schema.settings` 增加对应项；
3. 若前端需要，扩展 `server/api.go` 的 `publicConfig`；
4. webapp 侧在 `webapp/src/index.tsx` 里再注册一个组件，例如：
   - `registry.registerChannelHeaderButtonAction(...)`：频道头部加按钮
   - `registry.registerPostDropdownMenuAction(...)`：消息右键菜单加项
   - `registry.registerCustomRoute(...)`：加一个整页接口
   - `registry.registerWebSocketEventHandler(...)`：监听服务端事件

如果需要把插件 ID 改成自己的域名反写（推荐），改 `plugin.json` 的 `id` 后执行 `make apply`，会自动重写 `server/manifest.go` 与 `webapp/src/manifest.ts`。

---

## 7. 排错

| 现象 | 排查 |
| --- | --- |
| 时间没变 | ① 系统控制台里 `Enabled` 是否为 true；② 用户设置是否被设成「关闭自定义显示」；③ 浏览器控制台是否请求了 `/plugins/<id>/api/v1/config` 且返回 200 |
| 变一下又变回原样 | 说明 React 重渲染后没被再次覆盖，检查是否同时启用了别的改时间插件冲突；把服务端 `ApplyTo` 改成 `post` 试试 |
| 接口 401 | 请求没带会话；确认是 `credentials: 'include'` 且带 `X-Requested-With: XMLHttpRequest` |
| 时区不生效 | 填的是 IANA 名称（`Asia/Shanghai`），不是 `UTC+8`；无效值会自动回退到浏览器时区并在设置里给出警告 |
| 上传后报 min_server_version | 把 `plugin.json` 的 `min_server_version` 调到不高于你的版本号即可 |
| `unable to start plugin: ... unable to generate plugin checksum: open plugins/<id>/server/dist/plugin-linux-amd64: no such file or directory` | 包内二进制路径与 `plugin.json` 的 `server.executables` 声明不一致。必须是 `server/dist/plugin-<os>-<arch>`（注意 `dist` 这一层）。用 `tar -tzf dist/*.tar.gz` 核对；用本仓库的 `scripts/build.sh` 打包不会出现此问题，它结尾会自检 |
| 启动时 `permission denied`（或 `fork/exec ... permission denied`） | 包内二进制缺少可执行位。Windows 上 `chmod 0755` 对 tar 无效，请改用 `scripts/build.sh`（内部走 `scripts/pack.py` 显式写权限位）或在 Linux/macOS 上 `make dist` |
| `plugin.json` 找不到 / 包结构异常 | tar 的顶层目录必须且只能是插件 ID（如 `com.example.customers-plugin/`），不能多套一层 |
| 历史消息没被隐藏 | ① `HistoryLockEnabled` 是否为 true、`HistoryMode` 是否不是 `off`；② 该成员是否有加入记录（**插件安装前就加入的成员默认不受限**，见 3.5.5）；③ 浏览器控制台看 `/api/v1/history/boundary?channel_id=…` 是否返回 `cutoffAt > 0`；④ 刚加入频道时刷新一次页面 |
| `cutoffAt` 一直是 0 | 说明服务端没有该 (用户, 频道) 的加入记录。把成员移出再重新加入，或用管理接口回填 |
| 隐藏了但提示条没出现 | 提示条挂在 `#channel-header` 上；确认 `HistoryNoticeEnabled` 为 true 且确实有消息被隐藏（提示条只在隐藏生效时出现） |
| 日期分隔线还在 | 分隔线只在「其上所有消息都被隐藏」时才隐藏；如果只是部分隐藏则保留，属正常行为 |
| 滚动到顶部时一直在加载 | 被隐藏的行高度为 0，虚拟化列表可能反复请求更早的消息。服务端返回空页后会自然停止；若影响体验，可把 `HistoryMode` 改成 `recent_days` 减少隐藏数量 |

查看服务端日志：`make logs` 或 `make logs-watch`。

---

## 8. 参考文档

- 插件总览：<https://developers.mattermost.com/extend/plugins/>
- Webapp 插件 API：<https://developers.mattermost.com/extend/plugins/webapp/reference/>
- Server 插件 API：<https://developers.mattermost.com/extend/plugins/server/reference/>
- 官方模板：<https://github.com/mattermost/mattermost-plugin-starter-template>
- 开发机工作流：<https://developers.mattermost.com/integrate/plugins/developer-workflow>
