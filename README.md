# Customers Plugin（Mattermost 插件）

面向 **Mattermost 10.12.x** 的客户化定制插件，目前提供五个功能：

1. **接管聊天窗口的时间显示** —— 管理员在系统控制台统一配置显示格式（如 `2026-09-15 09:42`），用户也可以在自己的「设置」里按个人偏好覆盖。
2. **新成员历史消息隔离** —— 新加入频道的成员看不到其加入之前的历史消息。
3. **私信已读 / 未读标记** —— 私信里每条消息右上角显示「已讀」或「未讀」：别人发的看**你**有没有读过，你发的看**对方**有没有读过。
4. **批量删除消息** —— 管理员在控制台按条件（会话 / 发送者 / 关键词 / 时间范围）批量删除，也可在会话里勾选消息删除。
5. **产品导航** —— 全局头部右上角显示一个导航按钮（图标可自定义），点击展开分类与网站链接，每个链接可带自己的 logo。
![效果圖](./result.png)
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
| 合并消息时间 | 同一人连续发言被合并成一个消息块后，从第 2 条起鼠标悬停时会用**浮框**显示该条的完整时间（格式与上面一致） |

### 1.2 合并消息（连续发言）的浮框时间

Mattermost 会把同一个人在 5 分钟内连续发送的多条消息合并成一个块：**只有第 1 条**显示头像和时间，第 2 条及以后要到鼠标悬停时才在标题行里插一个时间 —— 而且那个时间是原生格式，不受本插件格式控制的影响感知（视觉上很容易被忽略）。

本插件改成：

| 能力 | 说明 |
| --- | --- |
| 悬停浮框 | 鼠标移到合并消息（第 2 条起）上，浮出一个小框显示该条的完整时间，格式与全局格式一致（如 `2026-09-22 09:30:15`） |
| 跟随鼠标 | 默认浮框跟着指针走；也可改成贴消息左侧或右上角 |
| 隐藏内联时间 | 默认把 Mattermost 悬停时插进标题行的那个时间隐藏，避免同一时间显示两次、也避免顶开版面 |
| 只认中心频道 | 只对中心频道消息流生效，右侧栏/搜索结果的时间本来就常驻显示，不动它们 |

### 1.3 新成员历史消息隔离

| 能力 | 说明 |
| --- | --- |
| 按加入时间隔离 | 服务端在 `UserHasJoinedChannel` 钩子里记录「谁在什么时候进了哪个频道」，前端据此隐藏更早的消息 |
| 服务端权威 | 边界只由服务端计算并通过 `GET /api/v1/history/boundary` 下发，前端不能自己编造 |
| 多视图覆盖 | 中心频道、右侧线程，可选搜索结果 / 置顶 / 已保存 |
| 管理员回填 | 老成员可通过管理接口 `POST /api/v1/history/boundary` 精确设置边界，不必先移出频道 |
| 提示条 | 频道头部可显示一条提示，说明更早的消息已被隐藏 |

### 1.4 私信已读 / 未读标记

只对**私信**生效（单人群私信 `D`、群私信 `G`），公开与私有频道不显示标记。

| 能力 | 说明 |
| --- | --- |
| 收到的消息 | 按「你」的已读位置判定：`create_at > myMembers[channelId].last_viewed_at` → 未读 |
| 发出的消息 | 按「对方」的已读位置判定：`create_at > peerLastViewedAt` → 对方还没读 |
| 显示 | 未读 = 黄色小圆圈 +「未讀」；已读 = 绿色小圆圈 +「已讀」，都在消息行右上角 |
| 群私信 | 取除自己外**最小**的已读位置，即所有对方都读过才算已读 |

> 自己发的消息若用「自己」的已读位置判定，发出瞬间就是已读，毫无意义 —— 所以判定按作者分流，这是本功能的核心规则。

### 1.5 批量删除消息

两个入口，共用同一套服务端权限校验：

| 入口 | 谁能用 | 做什么 |
| --- | --- | --- |
| 系统控制台 → 插件 → Customers Plugin → **批量删除消息** | 系统管理员 | 选会话 + 可选（发送者 / 关键词 / 起止时间）→ 先预览条数 → 二次确认后删除 |
| 频道头 🗑 按钮 → 勾选消息 | 系统管理员、频道管理员、以及能删自己消息的用户 | 消息行左上角出现复选框，底部工具条提供「全选当前页 / 清空 / 删除选中 / 退出」 |

| 能力 | 说明 |
| --- | --- |
| 默认关闭 | 删除是硬删除、不可恢复，`BulkDeleteEnabled` 默认为 `false`，必须显式开启 |
| 单次上限 | 默认 500 条（`BulkDeleteMaxPosts` 可配，硬顶 10000），避免误操作波及过大 |
| 权限 | 逐条交给 Mattermost 判定，无权限的计入 `denied` 返回，不静默跳过 |
| 删除节奏 | 每条之间 sleep 10ms，避免一次性冲刷上千条 WebSocket 广播 |

### 1.6 产品导航

全局头部右上角（`@提及`、`已保存`、`设置` 那一排按钮里）多一个导航按钮，点击弹出下拉面板，按分类列出网站链接。

| 能力 | 说明 |
| --- | --- |
| 按钮图标 | 控制台填图片 URL（`ProductNavIconUrl`），留空则用插件内置的九宫格图标 |
| 分类 | 控制台里可视化增删、上下移动顺序 |
| 链接 | 每个分类下可加多个链接，各自填名称、地址、logo 图片 URL（logo 留空则显示名称首字） |
| 打开方式 | 点击链接在新标签页打开，带 `rel="noopener noreferrer"` |
| 关闭方式 | 再点按钮、点击面板外、按 Esc、点链接后自动关闭 |
| 空数据 | 一个条目都没配时**按钮自动隐藏**，所以开启开关本身不会改变界面 |
| 保存前校验 | 名称或地址没填、地址不是 `https://` 开头（也不是 `/` 开头的站点相对路径）的行会**在保存前被点名拦下**，不会"保存了却消失" |

> 条目存在插件的 KV 存储里，由 `GET /api/v1/navigation` 下发给所有登录用户；只有系统管理员能改（`POST` 或 `PUT /api/v1/navigation`，服务端两个都收）。

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
│   ├── api.go               # 自有 REST 接口：config、history/boundary、read/peer、posts/*、channels
│   ├── history.go           # 加入时间 KV 存储 + 历史边界计算
│   ├── bulk_delete.go       # 批量删除：按条件遍历收集 + 逐条权限校验
│   ├── navigation.go        # 产品导航：分类/链接 KV 存储 + 地址清洗 + REST
│   ├── api_test.go
│   ├── history_test.go
│   ├── bulk_delete_test.go
│   └── navigation_test.go
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
        ├── grouped_time.ts                  # 合并消息（连续发言）悬停浮框时间引擎
        ├── read_status.ts                   # 私信已读/未读徽标引擎
        ├── bulk_select.ts                   # 会话内勾选删除引擎 + 按钮与工具条共享的 store
        ├── bulk_delete_api.ts               # 批量删除接口封装（query / purge / delete / channels）
        ├── product_nav.ts                   # 产品导航引擎：注入头部按钮 + 下拉面板
        ├── product_nav_api.ts               # 产品导航接口封装（GET / PUT navigation）
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
            ├── read_status_controller.tsx   # 已读/未读控制器（root component）
            ├── bulk_delete_bar.tsx          # 勾选模式的浮动工具条（root component）
            ├── bulk_delete_panel.tsx        # 系统控制台的批量删除面板（custom setting）
            ├── product_nav_controller.tsx   # 产品导航控制器（root component）
            ├── product_nav_panel.tsx        # 系统控制台的产品导航编辑面板（custom setting）
            ├── icons.tsx                    # 内联 SVG 图标（垃圾桶）
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
响应 { enabled, timeFormat, timeZone, applyTo, allowUserOverride, presets[],
       history{...}, groupedTime{...}, readStatus{enabled}, bulkDelete{enabled, maxPosts},
       productNav{enabled, iconUrl} }
```

后面几个是各功能自己的配置段。**旧版本服务端不会下发新字段**，所以前端的 `resolve*()` 一律把它们当作「未配置」处理：历史隔离、浮框时间与产品导航沿用默认值开启，已读标记与批量删除则**保持关闭**（会往界面上加东西 / 有破坏性的功能，不默认打开）。

> 产品导航之所以敢默认开启，是因为它**没有条目就不显示按钮** —— 旧服务端不下发 `productNav` 时前端也拿不到条目，界面不会有任何变化。

该路由由 Mattermost 服务器代理，只有携带有效会话（且带 `X-Requested-With: XMLHttpRequest`）的请求才会带 `Mattermost-User-ID` 请求头，否则返回 401。

### 3.4 用户偏好存在哪

用官方的 `registry.registerUserSettings()` 注册的用户设置会**自动**存进 preference：category 为 `pp_<pluginId>`，name 为设置项名。前端直接 `useSelector` 读 `state.entities.preferences.myPreferences['pp_<id>--<name>']` 就能拿到，无需再写服务端接口。

### 3.4.1 合并消息浮框时间（`webapp/src/grouped_time.ts`）

DOM 事实（10.12 实测，`post_component.tsx`）：

- 合并块里第 2 条起的消息带类名 **`same--root`**（`hasSameRoot()` 为真），同时 `hideProfilePicture` 为真 → `<PostTime>` **只在 `hover` 为真时才渲染**，即默认 DOM 里根本没有 `<time>`；
- 所以不能靠「改写已有 `<time>`」来做，必须自己拿时间：**消息 id → redux `state.entities.posts.posts[id].create_at`**；
- 消息行 id 约定：中心 `post_<id>`、右侧栏 `rhsPost_<id>`、搜索 `searchResult_<id>`；中心列表容器是 `#postListContent`（开启虚拟化时为 `#virtualizedPostListContent`）。

引擎做的事：

1. 全局委托一个 `mousemove`，用 `closest('[id^="post_"]')` 找到消息行；
2. 判定**只认 `same--root`**（它是 10.12 里「块内第 2 条起」的统一标记：连续 root 同作者的第 2 条起、以及线程内联回复的第 2 条起都带它），且必须在中心列表容器内；注意线程**第一条**回复是 `other--root`（`hasSameRoot()` 对 `isFirstReply` 直接返回 false），所以块首保留内联时间、不弹浮框；
3. 用 `requestAnimationFrame` 把移动合并成一帧处理（快速划过不会刷爆主线程）；
4. 只有一个浮框元素，复用并改位置；`pointer-events: none` 保证不吃点击和 hover；滚动 / 鼠标离开窗口 / 窗口失焦时立即隐藏；
5. 贴边时把浮框收进视口；
6. `hideInline` 为真时注入一条样式规则隐藏原生悬浮时间：
   `#postListContent .post.same--root .post__header time.post__time{display:none !important;}`（只隐藏时间，不隐藏标题行里的悬浮操作栏）。

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

### 3.5.5 隐藏到底要作用在哪个元素上（最重要的一节）

**结论：必须让「虚拟列表测量的那一行容器」整个塌陷，不能只藏里面的 `<div id="post_xxx">`。**

Mattermost 的消息列表是虚拟化的，每个列表项都套一层 `<div class="item_measurer">`
（`dynamic_virtualized_list/list_item.tsx`），行高是按 **`itemId → 高度`** 缓存在
`_listMetaData.itemSizeMap` 里的。`ListItem` 挂载后测的就是这个 wrapper 的 `offsetHeight`，
之后由 size observer 跟随变化上报。

于是「把 `post_xxx` 设成 `display:none`」会发生什么：

```
.item_measurer  ← 它还在，高度由残留的 padding / wrapper 决定，远大于 0
  └ div.post-row__padding
      └ #post_xxx  ← 只有它被隐藏
```

虚拟列表把这份「非零但很小」的高度记进 `itemSizeMap`，每个隐藏历史行都贡献一份。等这些行滚出视口后，
它们退化成「高度为 `itemSizeMap` 记录值」的**占位 div**——于是频道里堆着一串看不见内容却占着位置的
空洞。**这就是「频道一片空白、要上下滚一滚才正常」**。

所以现在的做法是给 **`.item_measurer`**（没有它时退化到 post 行本身）打 `data-customers-history-hidden`，
整行 `display:none`。行容器没有 id、也没有稳定 class 可选，所以用 data 属性 + 属性选择器 —— 顺带
**避开了 React 会在重渲染时覆盖 `className`** 这个老问题。这一修在同一处也解决了日期分隔线：
分隔线同样要连同它所在的整行一起藏。

配套的两个时序要求（缺一个都不行）：

1. **必须在 `list_item.tsx` 测量之前落地。** 否则测到的是正常高度，`itemSizeMap` 被污染，
   之后虽然会被 size observer 慢慢纠正（表现为"滚几下就好了"），但那一屏已经错了。
   `MutationObserver` 回调跑在 microtask 里，早于 React 的 passive effects、也早于绘制，**直接在回调里同步 sync**
   才能同时满足「测量前」和「绘制前」。一次 React commit 的所有插入本来就在同一个 MO 回调里，不会退化成一行一扫描。
2. **边界还没取回时留白、不一刀切隐藏。** 该频道的行先 `visibility:hidden`：内容看不见，但**行高保持不变**，
   列表既不泄露历史、也不会因为高度突变而错位。边界一到就切成 `display:none`。
   想要旧行为可以把 `边界未取回时消息行的处理` 改成 `照常显示`。

切频道时的网络往返也要消掉：启动时用 **`POST /api/v1/history/boundaries`** 把当前用户所有已知频道的
边界一次拉全（去重、上限 200 个频道），频道集合变化时再增量补拉，切换频道基本都命中缓存。

还要强调一个语义：**批量接口里缺失的频道 = 未知，不是不限制**。服务端只在确实算出来了才写进
`cutoffs`（算失败的会整个略过），前端因此继续保持留白，不会因为一次失败就把历史放出来。

### 3.5.6 系统消息为什么整条漏网（合并的用户活动行）

「X 加入了频道」这类系统消息，DOM 里的行 id **不是真实帖子 id**：

```
post_user-activity-<id1>_<id2>...     ← 连续的系统消息被合并成一行
post_user-activity-<id1>              ← 哪怕只有一条，也带这个前缀
```

出处（`mattermost-redux/lib/utils/post_list.js`）：

- `makeCombineUserActivityPosts()` 把连续的用户活动帖子改写成
  `COMBINED_USER_ACTIVITY`（= `user-activity-`）+ postId，同组后续帖子用 `_` 追加在后面；
  关键是它**对单独一条也照改**，所以只要列表里出现过系统消息，系统消息就全都带前缀。
- `makeGenerateCombinedPost()` 再用这些真实 id 现场合成一个帖子对象
  （`type: system_combined_user_activity`），**合成结果不会写进 redux**。

于是 `entities.posts.posts['user-activity-xxx']` 永远查不到，门拿不到 `create_at`
就直接放过整行 —— 这就是「加入频道前的系统消息没被隐藏」。

修法在 `history_gate.ts`：拿到行 id 先 `expandPostIds()` 拆回真实 id 列表，逐个查 meta：

- **任一条早于边界 → 整行隐藏。** 合并行会把它们一起渲染出来，只藏一半等于没藏；
  而且合并行自己显示的时间戳就是组里**最早**那条，与这个判定一致。
- 全在边界之后 → 显示。
- 一条都查不到 → 不动（不猜，与普通消息同一原则）。

### 3.5.7 已知边界（诚实说明）

- 这是**前端可见性控制**，不是加密。用户打开浏览器开发者工具、或直接调用 Mattermost API，仍可拿到被隐藏的帖子。如果你的场景要求"绝对取不到"，只能靠**私有频道 + 定期归档 / 到期重建频道**，插件层面做不到。
- 插件**只记录安装之后发生的加入事件**。安装前就已在频道里的成员默认不受影响（配置 `存量成员如何处理 = 不限制`）。要让他们也生效，二选一：
  - 把配置改成 `以插件启用时间为边界`（所有无记录的成员统一以插件首次启用时间划线）；
  - 用管理接口精确回填（见下）。
- 若某成员被移出后又重新加入，边界会按**新的加入时间**重算。

### 3.5.8 管理接口：回填 / 清除某人的边界

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

### 3.5.9 为什么"滚到最顶部"最容易出问题

现象：新成员把滚动条拉到频道最顶部，加入后的那几条消息不见了，上面只剩"频道起点"和一片空白。
**"频道起点信息"不是原因，是信号灯** —— 它只在 `atOldestPost` 为真时渲染，而我们把历史行塌成 0 之后
`totalMeasuredSize` 永远小于视口高度，`DynamicVirtualizedList` 就会一路往回翻页翻到频道最开头，
于是"起点信息"和"空白"总是同时出现。

真正的机制（对照 release-10.12 源码）：

| 环节 | 事实 |
| --- | --- |
| 谁在测高 | `list_item.tsx`：`ListItem` 挂载时用 `.item_measurer` 的 `offsetHeight` 测高，之后由共享 `ResizeObserver` 上报 |
| 塌了之后谁来记 | `index.jsx` 的 `_listMetaData.itemSizeMap`（按 itemId 存）；行滚出渲染窗口后退化成 `<div style="height:缓存值">` 占位盒子，**无 class 无 id，外部 CSS 够不着** |
| 为什么会记错 | ① `display:none` 的元素没有盒子，`ResizeObserver` 不会上报；② 上报还是 **200ms debounce**，行提前卸载会被 `cancel()`；③ 顶部翻页时的滚动补偿读的是**塌陷前**的 `scrollHeight`，补偿量偏大 |

0.6.6 的处理：

1. **隐藏规则从 `display:none` 改成强制 0 高**（保留一个零高度的盒子 + `visibility:hidden`）。
   挂载测高本来就是 0；关键是盒子还在，共享 `ResizeObserver` 一定会观测到并上报 0，
   `itemSizeMap` 也就不会再残留塌陷前的高度。
2. **顶部锚定补偿**：只在滚动容器停在顶部（`scrollTop <= 4`）且第一条可见消息不在视口里时，
   把它拉回视野。既不会打断正在滚动的用户，也不会反复触发（拉回来之后就满足"已可见"）。
3. 顺带：分隔线扫描遇到第一条可见消息就停，虚拟化下 `.innerList` 动辄几百个子节点，原来每次 sync 都全扫。

排查现场时，控制台粘贴 `scripts/diagnose-history-top.js`：它会告诉你可见行到底在不在 DOM 里
（`rowsVisible`）、第一条可见行上方堆了多少像素空白（`blankAboveFirstVisiblePx`）、
占位盒子合计占了多少（`phantomPlaceholderPx`）。

### 3.5.10 为什么"第一次进去是好的，刷新或切回来就坏了"

现象：强制刷新（忽略缓存）时隔离正常；普通刷新、或者切到别的频道再切回来，又变回一片空白。

**这不是两个 bug，是同一个"塌陷前被测过一次"的问题换了个时机出现。** 上表的第 ③ 条漏了一个前提：
行什么时候会被"按全高测量"？只有一种情况 —— **边界还没取回来**（`pending` 状态刻意保留了行高，
既不想泄露历史也不想让滚动条跳）。

| 时机 | 渲染 vs 边界谁先到 | 结果 |
| --- | --- | --- |
| 冷启动 | 静态资源慢，插件 bundle 也慢，边界请求和帖子请求几乎同时到 | 边界常常赶得上，行一插进来就是 0 高 |
| 普通刷新 / 切回频道 | 静态资源命中缓存，帖子（或 redux 里已有的帖子）**同步就渲染完了**，边界请求落在后面 | 整屏行先按全高测一遍，再被我们塌掉；200ms debounce 还没上报，行就因为翻页/重渲染卸载了 → `cancel()` → 旧高度永久留在 `itemSizeMap` |

0.6.7 的处理（三条，逐条对应上面这张表）：

1. **边界在首帧之前就必须已知**：`putBoundary()` 把每个用户的边界镜像进 `localStorage`
   （`cutoff=0` 的频道**不落盘**，否则"未知"会被固化成"不限制"），启动时 `hydrateBoundaries()`
   同步读回来。读回来的条目一律标记为**陈旧**，所以界面先用旧值渲染、后台再重新校验（SWR），
   管理员改了配置也能自己纠正。
2. **取边界改成 stale-while-revalidate**：`ensureBoundary()` 先用已有值（哪怕过期）渲染，再去网络上要新的。
   以前是"没有新鲜值就等"，等待期间全是 `pending` 行。
3. **视口归位**：从"只在顶部拉回"推广成**只要视口里一条可见消息都没有就归位**。
   这是个永远不会误伤的判断 —— 塌成 0 的行没有高度可滚进去，所以"视口里没有可见消息"
   只可能是缓存高度出了问题。可见消息永远是最新的那一段（列表底部），所以直接去底部；
   额外加了 800ms 的手势静默，正在滚的人绝不会被拽走。

### 3.5.11 0.6.8 的根治：过滤发生在数据层，而不是渲染之后

0.6.6 / 0.6.7 修的都是"渲染后隐藏"这条路上的坑，但这条路本身有一个赢不了的对手：
**虚拟列表的行高是在渲染时测的**。只要还有"先渲染、再隐藏"的时序缝隙（未知边界、翻页、
重渲染），被测过一次的行高就永远留在 `itemSizeMap` 里。

0.6.8 换了打法 —— **让那些消息根本不被渲染**。`post_stream_filter.ts` 补丁全局 `fetch`
（`@mattermost/client` 的 `doFetch` 调用的是全局 `fetch`，调用时才解析，补丁可以拦截），
对 `GET /api/v4/channels/<id>/posts*` 的响应在进 redux 之前过滤：

- `create_at < cutoffAt` 的帖子直接从 `order` / `posts` 里删掉（保留「你被加入频道」
  的系统消息 —— 它在加入瞬间创建，是成员应该看到的加入后第一行）；
- 删过历史且页面是降序时，把 `prev_post_id` 置空。webapp 判断 `atOldestPost` 看的就是
  `prev_post_id === ''`（不是 `has_next`），于是列表认为自己已到最旧，**不会再往后翻页**
  去请求注定会被丢掉的历史页；
- 「频道起点信息」（`#channelIntro`）由 DOM 门单独收掉（它没有 post id，不走在帖子扫描里）；
- 边界未知时，posts 请求会先等一次边界接口（3 秒超时，失败则原样透传，交给 DOM 门兜底）；
- 插件自身的 `/plugins/...` 请求豁免，边界请求不会递归进补丁。

效果：受限成员看到的就是「你被加入频道」+ 加入后的消息，顶部没有空盒子、没有起点信息，
强制刷新、普通刷新、切频道再切回来全都一样 —— 因为 redux 里从一开始就只有他能看的消息。
DOM 门（3.5.7–3.5.10 的全部机制）保留为兜底，正常情况下不再触发。

### 3.5.12 0.6.9 清理：兜底只留它真正需要的东西

数据层过滤上线并验收后，DOM 门里有一批代码只服务于"和测高竞速"那个时代，0.6.9 删掉：

| 删掉的 | 它当年解决什么 | 为什么现在多余 |
| --- | --- | --- |
| `topScrollDelta()` + `TOP_EPSILON` / `TOP_PADDING` / `EDGE` | 停在顶部时把第一条可见消息**最小位移**拉回视野 | 位移量的精细调节是为了不打断阅读；而"视口里没有可见消息"这个状态本身就是缓存坏了，最小位移和跳到底部对用户没有区别 |
| `planViewportRecovery` 的 `delta` 模式（三选一） | 顶部最小位移 / 中间按方向拉 / 没有可见消息跳底部 | 只剩"有重叠就不动，否则去底部"一条规则：可见消息永远在列表末尾，方向是确定的 |
| `schedule()` 间接层 | 早年是 debounce，后来退化成 `sync()` 的空壳 | 直接在 MutationObserver 回调里 `sync()`，时序说明挪到注册处 |

保留的：MO 回调里同步 sync、整行（`.item_measurer`）塌陷为 0 高、`pending` 留白、
`channelIntro` 收掉、`forceVisible` 豁免、800ms 手势静默。前四项是过滤失效（边界取不回来）
时唯一的兜底，最后一项防止兜底本身和正在滚动的人打架。

---

## 3.6 已读 / 未读标记是怎么做的（第三个功能）

### 3.6.1 判定按作者分流

| 消息 | 看谁的已读位置 | 从哪里取 |
| --- | --- | --- |
| 别人发给我的 | 我自己的 | redux：`entities.channels.myMembers[channelId].last_viewed_at` |
| **我发出去的** | **对方的** | 插件接口 `GET /api/v1/read/peer` |

### 3.6.2 为什么对方的已读位置必须走服务端

redux 里只有 `myMembers`（**自己的**成员记录）。`membersInChannel` 存着别人的成员记录，但它 ① 不保证已加载；② 对方查看会话时不会推送更新到你的浏览器 —— 拿它做判定会得到过期值。

所以服务端加了一个接口：

```
GET  <siteURL>/plugins/com.example.customers-plugin/api/v1/read/peer?channel_id=…
响应 { "channelId": "…", "peerLastViewedAt": 1789440120123 }
```

- 实现：`p.API.GetChannelMembers(channelID, 0, 100)` 拿到成员列表 → 排除请求者 → 取**最小**的 `LastViewedAt`（群私信因此要所有人都读过才算已读）；
- 请求者不是该会话成员 → `403`；非私信频道 → 返回 `0`（不暴露任何东西）。

前端 controller 用 `Map<channelId, {at, fetchedAt}>` 缓存，4 秒节流轮询当前会话，值变化才触发重扫。**位置未知时不打标，不猜。**

### 3.6.3 徽标为什么插在消息行上

- 不能插 `.post__header`：那是 React 管的，hover 时会重建，插进去会闪；
- 定位用的 `position:relative` 走 **inline style**，不能用 class —— React 会连同 `className` 一起覆盖；
- 用 `dataset.readState` 记状态，只有状态变化才重建节点，所以「未读 → 已读」和反向都能同步更新文字与颜色。

---

## 3.7 批量删除是怎么做的（第四个功能）

### 3.7.1 接口

| 接口 | 作用 |
| --- | --- |
| `POST /api/v1/posts/query` | 按条件预览（统计条数、返回前 10 条样本），不删 |
| `POST /api/v1/posts/purge` | 按条件删除 |
| `POST /api/v1/posts/delete` | 按显式 `postIds` 删除（会话勾选走这条） |
| `GET  /api/v1/channels` | 控制台面板的会话下拉数据 |

请求体：`{ channelId, userId, keyword, timeFrom, timeTo, limit }` 或 `{ postIds: [...] }`（后者优先）。

### 3.7.2 为什么不用 `SearchPostsInTeam`

插件 API 里有 `SearchPostsInTeam(teamID, paramsList)`，参数天然支持关键词 / 作者 / 频道 / 日期，看起来正合适。但它内部按自己的分页取结果，**插件拿不到完整集合**，删不全也不知道漏了多少。

所以改成 `GetPostsForChannel(channelID, page, perPage)` 分页（200/页）遍历 + 本地过滤。由此带来一个必须处理的正确性细节：

> 遍历是从最新往回走，遇到 `createAt < timeFrom` 就能停 —— **前提是这一页确实是按时间倒序**。所以先用 `isDescending()` 检测顺序，只有在确认倒序时才允许提前退出，否则继续翻页，避免漏删。

### 3.7.3 权限为什么逐条交给 Mattermost

不自己判断「是不是管理员」，而是问服务器：

```go
HasPermissionTo(actorID, PermissionManageSystem)                            // 系统管理员：全放行
HasPermissionToChannel(actorID, channelID, PermissionDeletePost)            // 自己的消息
HasPermissionToChannel(actorID, channelID, PermissionDeleteOthersPosts)     // 别人的消息
```

好处是「频道管理员能不能删别人的消息」完全由服务器的权限方案决定（高级权限开没开、角色怎么配），插件不用硬编码，也不会和服务器的判定不一致。没权限的消息计入 `denied` 返回给调用方，**不静默跳过**。

### 3.7.4 前端两个入口的接线方式

- 控制台面板：`registry.registerAdminConsoleCustomSetting('BulkDeletePanel', Component)` —— 收的是 **React 组件**（不是 iframe URL），key 必须存在于 `settings_schema.settings`（`type: "custom"`）；
- 频道头按钮：`registerChannelHeaderButtonAction(icon, action, ...)` 的回调**没有参数**，没法往工具条传 state，所以按钮和工具条之间靠 `bulk_select.ts` 里的模块级 store（`subscribe/get/set`）通信。

---

## 3.8 产品导航是怎么做的（第五个功能）

### 3.8.1 为什么不用 `registerAppBarComponent`

插件 API 里有 `registerAppBarComponent(iconUrl, action, tooltip, supportedProductIds)`，看起来正合适，但它属于 **App Bar**，需要传 `ProductScope`（`boards` / `playbooks` 等），且在 Channels 里默认不开 —— 用它等于把入口交给另一套产品开关。用户要的是「全局头部右上角」，所以直接往头部容器里注入按钮。

DOM 事实（10.12 实测）：`global_header.tsx` 渲染 `<GlobalHeaderContainer id='global-header'>`，其中 `right_controls/right_controls.tsx` 渲染 `id={'RightControlsContainer'}`，里面是 `@提及`、`已保存`、`设置` 等按钮。导航按钮 `insertBefore(container.firstChild)`，落在这排按钮的最前面，仍在右上角。

### 3.8.2 数据为什么存在 KV 而不是插件配置

- 条目数量不定、可增删排序，塞进 `settings_schema` 的一个 text 框里既难用也难校验；
- 写操作要限管理员、读操作要给所有人 —— 自有 REST 端点最自然。

```
GET  /api/v1/navigation          # 所有登录用户：读条目（不受功能开关影响，管理员关闭时也要能编辑）
PUT  /api/v1/navigation          # 仅系统管理员（manage_system）：整体替换
请求/响应 { "categories": [ { "id", "name", "links": [ { "id", "name", "url", "iconUrl" } ] } ] }
```

### 3.8.3 两个地方都做 URL 清洗

链接地址会进每个用户页面的 `href` 和 `src`，所以服务端存之前、前端渲染之前**各洗一次**：

- 只接受 `http(s)://` 与站点相对路径（`/admin_console/...`）；
- `//host`（协议相对，会跳出站点）与 `/\host` 一律拒绝；
- 含空白或控制字符的一律拒绝 —— 这是 `java\nscript:alert(1)` 绕过前缀检查的常用手法；
- 服务端另有限制：30 个分类 / 每类 50 条链接 / 名称 64 字 / 文档 32 KB。

前端渲染时再做一次同样的判断，所以即便有人手工改了 KV，也插不进 `javascript:` 链接。

### 3.8.4 面板与关闭行为

面板是纯 DOM（不是 React 组件）—— 头部由 React 管，没法往里挂组件，纯 DOM 也更好测。关闭时机：再点按钮、点击面板外（`click` 捕获阶段判断 target 是否在按钮/面板内）、按 Esc、点链接后。空条目时按钮主动移除自己，MutationObserver + 3 秒全量重扫保证 React 重建头部后按钮能复活。

### 3.8.5 每行的链接数可在插件设置里改

设置项 **`ProductNavLinksPerRow`**（数字，1–12，默认 5）：每个分类一行显示多少个链接，
超出的换到下一行。面板宽度跟着这个数字自动调整，改完保存、用户刷新页面即生效。

链接容器用 **CSS grid**（`repeat(N, minmax(0,1fr))`），不是 `flex-wrap`：

- `flex-wrap` 的行数取决于每个瓦片的**固有宽度**，名称长短一变，每行个数就飘 —— 之前瓦片写死
  `width:88px`、面板 `300px`，扣掉内边距只剩 272px，装得下 2 个（88×2+6）装不下 3 个（88×3+12=276），
  所以看起来"只能排 2 个"；
- 改成 grid 后每行固定 N 个，瓦片 `width:100%` 由列宽决定，名称长短不再影响排布。

面板宽度由列数反推，保证 N 个瓦片一定放得下：
`宽度 = 2×14（内边距） + N×56（最小瓦片） + (N-1)×6（间距）`，5 列即 332px。

**越界值回默认而不是夹到边界**：填 0、负数、大于 12 或非数字，一律按 5 处理 —— 夹到 12 会让
「填错了」看不出来（还以为是自己想要的）。服务端 `sanitizeProductNav()` 与前端
`normalizeLinksPerRow()` 各做一次，两边规则一致。

运行时改这个值不重启引擎：`ProductNavEngine.setLinksPerRow()` 就地重写样式表，打开着的面板
会按新宽度重建，链接不会丢。

瓦片变窄后名称一行放不下，所以名称限高**两行**（`-webkit-line-clamp:2` + `max-height` 兜底），
完整名称仍在 `title` 里。

### 3.8.6 服务端下发的一定是数组，不是 `null`

踩过的坑：Go 的 **nil slice 会被 `encoding/json` 写成 `null`**。某个分类里的链接全部被清洗规则丢弃时，`Links` 就是 nil，响应变成 `{"categories":[{"id":"c","name":"内部","links":null}]}`，前端 `category.links.map(...)` 当场抛
`TypeError: Cannot read properties of null (reading 'map')`，而且发生在 `Promise.finally` 里，表现为「保存好像也没报错，但页面卡住了」。

所以现在是三道保险：

1. 服务端 `normalizeNavigation()` 预分配 `Categories: []NavCategory{}` 与每个分类的 `Links: []NavLink{}`，空文档写出来是 `{"categories":[]}`；
2. 前端 `normalizeNavDocument()` 把 `categories` / `links` 为 `null`、缺失、甚至数组里混了 `null` 元素的情况都收拾干净再往下走；
3. 所有遍历统一写成 `(category.links || [])`。

**新增任何遍历导航数据的代码，都要走 `normalizeNavDocument()` 或 `|| []`**，别直接 `.map`。

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

产物：`dist/com.example.customers-plugin-<version>.tar.gz`（当前版本见 `plugin.json` 的 `version`）

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

### 4.6 测试

```bash
# 服务端（Go）
GOOS=windows GOARCH=amd64 go test ./server/...

# 前端引擎（jsdom，需要 webapp 已 npm install）
NODE_PATH="C:/Users/cheny/.workbuddy/binaries/node/workspace/node_modules" \
  node scripts/test-grouped-time.js     # 合并消息浮框：25 项
NODE_PATH="C:/Users/cheny/.workbuddy/binaries/node/workspace/node_modules" \
  node scripts/test-read-status.js      # 私信已读/未读徽标：40 项
NODE_PATH="C:/Users/cheny/.workbuddy/binaries/node/workspace/node_modules" \
  node scripts/test-bulk-select.js      # 会话内勾选删除：31 项
NODE_PATH="C:/Users/cheny/.workbuddy/binaries/node/workspace/node_modules" \
  node scripts/test-history-gate.js     # 历史隔离：整行塌陷 / 留白 / 同步时机 / 系统消息：53 项
NODE_PATH="C:/Users/cheny/.workbuddy/binaries/node/workspace/node_modules" \
  node scripts/test-product-nav.js      # 产品导航按钮与面板：82 项

# 类型与风格
cd webapp && npm run check-types && npm run lint
```

四个脚本都是同一套路：先把对应 `.ts` 编译到临时目录，再在 jsdom 里搭一个和 10.12 同构的 DOM。

| 脚本 | 覆盖 |
| --- | --- |
| `test-grouped-time.js` | 识别合并块、跟随鼠标与贴边收口、注入隐藏内联时间的样式、块首条 / 右侧栏不显示、取不到时间不显示、关闭后彻底清理 |
| `test-read-status.js` | **收到的消息按我的位置判定 / 发出的消息按对方的位置判定**、推进任一侧的已读位置只影响对应一侧、未知位置时不打标且只请求一次、黄绿主题色、双向切换、停止后清理 |
| `test-bulk-select.js` | 复选框注入与幂等、勾选/取消、全选/清空、虚拟列表新行自动补框、重扫不丢选中状态、停止后清理、按钮与工具条共享的 store |
| `test-history-gate.js` | 隐藏标记打在被测量的 `.item_measurer` 整行上（不是内部 post div）、边界未取回时留白且顺手补拉、边界到达后从留白切到隐藏、`pendingPolicy=show`、MO 回调里同步处理（不等下一帧）、日期分隔线只藏"其上全隐藏"的、提示条、`hideInSearch=false` 只管中心频道、**系统消息（`user-activity-` 合并行）拆回真实 id 后判定**、停止后彻底清理 |
| `test-product-nav.js` | 无条目时不显示按钮、按钮插在 `#RightControlsContainer` 最前面且幂等、自定义图标与非法图标回退、面板按分类渲染、`javascript:` 链接被过滤、`target=_blank` + `noopener`、logo 缺失时显示名称首字、Esc / 点击外部 / 点击链接关闭、打开时更新数据重建面板、头部重建后复活、停止后彻底清理、**保存前校验（空白行放过 / 缺名称缺地址 / 缺 `https://` 拦截）** |

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
| `GroupedTimeEnabled` | bool | `true` | 合并消息（第 2 条起）悬停时用浮框显示该条时间 |
| `GroupedTimePosition` | dropdown | `cursor` | 浮框位置：`cursor` 跟随鼠标；`left` 消息左侧；`right` 消息右上角 |
| `GroupedTimeHideInline` | bool | `true` | 隐藏 Mattermost 悬停时插进标题行的内联时间，避免重复显示 |
| `ReadStatusEnabled` | bool | `true` | 私信消息右上角显示「已讀 / 未讀」徽标（频道消息不显示） |
| `BulkDeleteEnabled` | bool | `false` | 批量删除总开关。**默认关闭**，删除不可恢复，请确认后再开 |
| `BulkDeleteMaxPosts` | number | `500` | 单次请求最多删除多少条（硬上限 10000） |
| `BulkDeletePanel` | custom | — | 控制台里的批量删除面板，由前端组件渲染（不是普通设置项） |
| `ProductNavEnabled` | bool | `true` | 产品导航总开关。没有条目时按钮自动隐藏，所以默认开启也不会改变界面 |
| `ProductNavIconUrl` | text | 空 | 导航按钮的图标图片 URL（也可填站点相对路径）；留空用内置九宫格图标。只接受 http(s) 与站点相对路径 |
| `ProductNavLinksPerRow` | number | 5 | 每个分类一行显示几个链接（1–12）。留空/0/越界一律按 5 处理；面板宽度随之自动调整 |
| `ProductNavPanel` | custom | — | 控制台里的产品导航编辑面板：分类与链接的可视化增删排序 |
| `HistoryLockEnabled` | bool | `true` | 历史隔离总开关 |
| `HistoryMode` | dropdown | `since_join` | `since_join` 只看该成员加入之后；`recent_days` 所有人只看最近 N 天；`off` 不限制 |
| `HistoryDays` | text | `7` | 仅 `recent_days` 生效，正整数 |
| `LegacyMemberMode` | dropdown | `show_all` | 无加入记录的成员：`show_all` 不限制；`since_activation` 以插件启用时间为界 |
| `HideInSearch` | bool | `true` | 是否连搜索结果、右侧栏（线程/置顶/已保存）一起隐藏 |
| `HistoryPendingPolicy` | dropdown | `blank` | 边界还在取回时：`blank` 内容留白但保留行高（不泄露、滚动条不跳，推荐）；`show` 先照常显示（可能一瞬可见历史） |
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

## 6. 新增下一个功能时怎么做

插件骨架已经把「服务端配置 → REST 下发 → webapp 消费」这条路打通了，加功能只需：

1. `server/configuration.go` 增加字段并在 `sanitize()` 里校验；
2. `plugin.json` 的 `settings_schema.settings` 增加对应项；
3. 若前端需要，扩展 `server/api.go` 的 `publicConfig`；
4. webapp 侧在 `webapp/src/index.tsx` 里再注册一个组件，例如：
   - `registry.registerRootComponent(...)`：挂一个不可见组件，用 MutationObserver 改 DOM（时间、历史隔离、已读标记、产品导航四个功能都这么干）
   - `registry.registerChannelHeaderButtonAction(...)`：频道头部加按钮（回调**无参数**，跨组件通信要用模块级 store）
   - `registry.registerAdminConsoleCustomSetting(key, Component)`：控制台设置项换成自定义 React 组件
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
| 历史消息没被隐藏 | ① `HistoryLockEnabled` 是否为 true、`HistoryMode` 是否不是 `off`；② 该成员是否有加入记录（**插件安装前就加入的成员默认不受限**，见 3.5.7）；③ 浏览器控制台看 `/api/v1/history/boundary?channel_id=…` 是否返回 `cutoffAt > 0`；④ 刚加入频道时刷新一次页面 |
| 加入频道前的**系统消息**（X 加入了频道 / X 离开了频道）没被隐藏 | 0.6.4 及更早没有处理 `user-activity-` 合并行（行 id 不是真实帖子 id，redux 里查不到）。升级即可；原理见 3.5.6 |
| 切换频道时有一瞬间能看到加入前的消息 | 0.6.4 之前的实现只藏了 `<div id="post_xxx">`，虚拟列表仍按外层 wrapper 的高度给它留位置。升级即可。若升级后仍有：① 控制台看 `POST /api/v1/history/boundaries` 是否在启动时成功返回（失败时切频道就只能靠留白兜底）；② 检查 `边界未取回时消息行的处理` 是否被改成了 `照常显示` |
| 切换频道时聊天区一片空白，要滚一下才正常 | 同上（`itemSizeMap` 里存了被隐藏行的残留高度）。升级到 0.6.4：**隐藏必须作用在 `.item_measurer` 整行上** |
| 上下滚动时消息不显示、来回滚动才出来 | 同上：行滚出视口后变成「按缓存高度撑开的占位 div」，那一刻 DOM 里根本没有 `#post_xxx` 可供隐藏，只能靠整行塌陷 + size observer 纠正 |
| 产品导航一个分类里一行只排得下 2 个链接 | 见 3.8.5。原来是 `flex-wrap` + 写死 88px 瓦片，300px 面板只放得下 2 个。0.6.9 起改成 grid，0.6.10 起每行个数由设置项 `ProductNavLinksPerRow`（1–12，默认 5）控制 |
| 滚到频道最顶部时加入后的消息不见了 | 见 3.5.9。0.6.6 起：① 隐藏规则从 `display:none` 改成强制 0 高（保留盒子，共享 ResizeObserver 才会上报塌陷后的 0）；② 停在顶部且第一条可见消息不在视口里时自动把它拉回视野。0.6.7 起：③ 只要视口里没有可见消息就归位（带 800ms 手势静默）。0.6.8 起数据层过滤（见 3.5.11），历史消息根本不会被渲染 |
| 强制刷新正常、普通刷新或切回频道就失效 | 见 3.5.10。0.6.7 起边界会镜像到 `localStorage` 并在首帧前读回 + 后台重新校验；0.6.8 起数据层过滤彻底消除时序竞态（见 3.5.11） |
| 消息行是空白的、不显示内容 | 该频道的边界还没取回来，正在留白。通常是 `POST /api/v1/history/boundaries` 失败（见上面的 404/401）或服务端算边界报错，看服务端日志 |
| `cutoffAt` 一直是 0 | 说明服务端没有该 (用户, 频道) 的加入记录。把成员移出再重新加入，或用管理接口回填 |
| 隐藏了但提示条没出现 | 提示条挂在 `#channel-header` 上；确认 `HistoryNoticeEnabled` 为 true 且确实有消息被隐藏（提示条只在隐藏生效时出现） |
| 日期分隔线还在 | 分隔线只在「其上所有消息都被隐藏」时才隐藏；如果只是部分隐藏则保留，属正常行为 |
| 滚动到顶部时一直在加载 | 被隐藏的行高度为 0，虚拟化列表可能反复请求更早的消息。服务端返回空页后会自然停止；若影响体验，可把 `HistoryMode` 改成 `recent_days` 减少隐藏数量 |
| 合并消息悬停没有浮框 | ① 只有**同一人 5 分钟内连续发送**、且处于合并块**第 2 条及以后**的消息才有（第 1 条本来就有常驻时间）；② 控制台 `GroupedTimeEnabled` 是否为 true；③ 用户在设置里把「时间格式来源」设成「关闭自定义显示」时整个功能（含浮框）都关掉；④ 只在中心频道生效，右侧栏/搜索结果不处理 |
| 浮框里的时间格式不对 | 浮框与消息时间共用同一个格式与时区；改的是用户设置或控制台的 `TimeFormat` / `TimeZone`，不是浮框自己的配置 |
| 悬停时标题行那个原生时间还在 | `GroupedTimeHideInline` 被关掉了，或页面没刷新（样式是插件启动后注入的，上传新版本后要 Ctrl+F5） |
| 私信里没有已读/未读徽标 | ① `ReadStatusEnabled` 是否为 true；② **只有私信**（`D`/`G`）才显示，公开与私有频道一律不显示；③ 自己发的消息要等**对方**打开过这个会话才有值，在此之前不打标；④ 看控制台 `/api/v1/read/peer?channel_id=…` 是否返回非 0 的 `peerLastViewedAt` |
| 自己发的消息一直显示「未讀」 | 对方还没打开过这个会话。对方的已读位置只在对方进入会话时才推进，属正常行为 |
| 频道头没有批量删除按钮 | 按钮只在 `BulkDeleteEnabled` 为 **true** 时注册（否则点了也会被 403）。改完设置要保存并 Ctrl+F5 |
| 批量删除接口返回 403 | ① `BulkDeleteEnabled` 是否开启；② 删除别人的消息需要 `delete_others_posts`（系统管理员或有该权限的频道管理员）；③ 响应里的 `denied` 会告诉你有多少条因为无权限被跳过 |
| 预览条数是 0 | 检查 `channelId` 是否选对、时间范围是否用本地时间（面板里填的是本地时间，会转成毫秒时间戳）、关键词大小写不敏感但必须是消息正文的子串 |
| 右上角没有产品导航按钮 | ① `ProductNavEnabled` 是否为 true；② **必须至少配置一条链接**（没有条目时按钮会主动隐藏）；③ 改完设置要保存并 Ctrl+F5；④ 看控制台 `/api/v1/navigation` 是否返回了非空的 `categories` |
| 导航保存后用户端没变化 | 用户端要刷新页面才会重新拉 `/api/v1/navigation`；按钮与面板是插件启动后注入的，上传新版本后同样要 Ctrl+F5 |
| 某条链接保存后消失了 | 服务端只保留能渲染的条目：地址为空、地址不是 http(s)/站点相对路径、或名称为空的链接会被丢弃。检查地址是否写成了 `example.com`（缺 `https://`） |
| 链接的 logo 不显示 | logo 用的是外部图片地址，用户浏览器必须能访问到它；加载失败会自动回退成名称首字的色块 |
| 导航面板保存报 400 | 文档超过 32 KB（30 个分类 × 每类 50 条链接的上限之内不该发生），或请求体不是合法 JSON。面板会把服务端返回的原文一并显示出来 |
| 导航面板保存报 401 | 登录会话失效，刷新页面重新登录再保存 |
| 导航面板保存报 403 | 当前账号没有 `manage_system` 权限。只有系统管理员能改产品导航；读（`GET`）所有人都可以 |
| 导航面板保存报 404 | 服务端没有 `/api/v1/navigation`。通常是插件没升级到 0.6.x，或升级后没有重新启用 —— 系统控制台 → 插件 → 找到本插件 → **禁用再启用** |
| 导航面板保存报 405 | 请求方法被拦。服务端同时接受 `POST` 与 `PUT`，若仍报 405 说明是站点前面的**反向代理只允许 GET/POST**，检查代理配置 |
| 导航面板加载失败、保存按钮置灰 | `GET /api/v1/navigation` 没成功，此时保存一定会失败，所以直接禁用。点「重新加载」重试；若仍失败按上面的 404 处理 |
| 保存后控制台报 `Cannot read properties of null (reading 'map')` | 旧版本（0.6.0/0.6.1）的服务端会把「链接被全部丢弃的分类」写成 `"links": null`。升到 **0.6.2** 即可；原理见 3.8.5 |

查看服务端日志：`make logs` 或 `make logs-watch`。

---

## 8. 参考文档

- 插件总览：<https://developers.mattermost.com/extend/plugins/>
- Webapp 插件 API：<https://developers.mattermost.com/extend/plugins/webapp/reference/>
- Server 插件 API：<https://developers.mattermost.com/extend/plugins/server/reference/>
- 官方模板：<https://github.com/mattermost/mattermost-plugin-starter-template>
- 开发机工作流：<https://developers.mattermost.com/integrate/plugins/developer-workflow>
