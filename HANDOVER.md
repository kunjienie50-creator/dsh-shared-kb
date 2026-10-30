# dsh-shared-kb 交接与后续开发指南

> 给在 Hub 那台电脑上继续开发/升级的人看。目标：拿到这份文档就能跑起来、改得动、发得出去。
> 当前版本 **0.3.0**，最后更新 2026-10-30（v0.3.0 是在 Hub 那台 Windows 机上升级的，§14 记录了这次踩到的坑）。

---

## 0. 一句话现状

| 项 | 状态 |
|---|---|
| 插件代码 | https://github.com/kunjienie50-creator/dsh-shared-kb（main，v0.3.0） |
| 安装包 | `dist/dsh-shared-kb-0.3.0.tgz`（137 KB，GitHub Release `v0.3.0` 待建） |
| dshmarket 上架 | PR **#10560** 已开，CI 已通过（`Submission gate` / `check` 均 success），等维护者合并 |
| npm | **未发布**（没有 npm token，不阻塞上架；市场会走 GitHub 源码安装） |
| Hub | 跑在 Windows 桌面机 `desktop-hrgqhrm`，公网入口 `https://desktop-hrgqhrm.tailad1fc2.ts.net`（Tailscale Funnel） |
| 数据 | Hub 机器上的 `.dsh-shared-kb` 目录（`config.json` + `state.json` + `docs/` + `comments/` + `raw/`） |
| 本机私有库 | 每台成员机各自的 `~/.dsh/shared-kb-private`（默认值，可用插件 Config 的 `privateDir` 改；**永不上传**） |

**不要在文档或仓库里写 token。** 成员令牌在 Hub 的 `config.json`，本机连接配置在 `~/.dsh/shared-kb.json`。

---

## 1. 资产清单

| 东西 | 位置 |
|---|---|
| 源码仓库 | `github.com/kunjienie50-creator/dsh-shared-kb` |
| 目录 PR | `github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/10560` |
| 目录条目文件 | fork `kunjienie50-creator/awesome-dsh-plugin` 分支 `add-dsh-shared-kb` → `data/plugins/kunjienie50-creator__dsh-shared-kb.yml` |
| 开发工作区（Mac） | `/Users/ikun/Desktop/dsh/dsh-shared-kb` |
| Hub 数据（Windows） | `%USERPROFILE%\.dsh-shared-kb` |
| 本机插件配置 | `%USERPROFILE%\.dsh\shared-kb.json` |
| 启动脚本 | `install/启动知识库.command`（macOS）/ `install/启动知识库.bat`（Windows） |
| 发布说明 | `release/PUBLISHING.md` |

---

## 2. 架构

```
成员的 DSH（插件）                      Hub 那台电脑
┌────────────────────────┐            ┌─────────────────────────────┐
│ 侧栏「共享知识库」页面   │            │ hub.js  :8787               │
│ skb_* 工具（15 个）       │──HTTP────▶│  config.json  成员/令牌     │
│ 自动规范化（调用模型）   │            │  state.json  已读/收藏/已读 │
│ 私有库（本机文件）       │            │  docs/*.json  成文+版本     │
└────────────────────────┘            │  raw/*.json+bin 原始素材    │
                                      │  audit.jsonl  管理流水      │
                                      └─────────────────────────────┘
```

### 文件职责

| 文件 | 职责 |
|---|---|
| `hub.js` | 零依赖服务端：鉴权、上传、去重、搜索、版本、重要置顶、收藏夹、评论、周报、审计、成员管理、`/install/*.tgz` 分发 |
| `index.js` | DSH 宿主插件：Config、15 个工具、同源页面路由、上传后自动规范化、技能自动安装、系统提示词、**本机私有库**（`require('./hub.js')` 复用 `Store`）、批量下载 zip（零依赖 STORE writer） |
| `client.js` | 侧栏入口 + 主页面（上传/搜索/阅读/批量/管理/周报），纯 JS + React，无构建步骤 |
| `skills/shared-kb/` | 规范化技能（团队版 inbox-triage：十类、≤10 字总结、置信度、要点、回执；含私有库/待整理/标重要口径） |
| `skills/upstream/` | 你的另外三个技能原样副本（`long-dialogue-knowledge`、`controversy-analysis`、`idea-synthesis`），插件首次加载时自动装到 `~/.dsh/skills/` |
| `install/` | 双击启动 Hub 的脚本 |
| `dist/` | 给 Hub 分发的安装包（`/install/` 路由从这里取） |
| `release/` | 上架说明与目录条目模板 |

### Hub 数据格式

```
docs/<id>.json   { id,title,summary,category,confidence,tags[],points[],author,
                   rawId,sha256,createdAt,updatedAt,version,markdown,versions[],
                   important,recommend,importantAt,importantBy,scope? }
raw/<id>.json    { id,name,title,tags[],author,bytes,sha256,status,skipReason,createdAt,pending? }
raw/<id>.bin     原始字节（不可变）
comments/<docId>.json   [{id,author,body,createdAt}]
config.json      { name, members:[{name,role,token,createdAt}] }
state.json       { <成员名>: { collections[], ackedImportant[], readDocs[],
                              weeklySeenAt, mentionSeenAt } }
audit.jsonl      增删成员、删素材、标重要等管理操作
```

`status`：`new`（待整理）→ `archived`（已成文）/ `skipped`（标记无用）。`pending:true` 表示「先不整理」直接存下的素材。

> `state.json` 是 v0.3 新增的：已读、置顶确认、收藏夹、周报/@ 已读都以**成员名**为键存在 Hub 侧，所以换设备也同步。私有库不走这套，本机的已读只影响本机。

### Hub API（除 `/health`、`/install/*` 外都要 `Authorization: Bearer <token>`）

```
GET  /health
GET  /api/status                 # 含 importantUnread / mentionsUnread / weeklyDue
GET  /api/list?category=&tag=&author=&important=only|exclude&collection=&sort=&limit=&offset=
GET  /api/search?q=&category=&author=&important=&compact=1&limit=
GET  /api/recall?q=&limit=       # 多篇摘要+要点聚合成 digest（省上下文的捷径）
GET  /api/doc?id=
GET  /api/doc/open?id=           # 记已读（取消置顶的前置条件）
GET  /api/history?id=
GET  /api/inbox?status=new|all&author=
GET  /api/raw?id=
POST /api/upload                 # 裸文件体；x-filename/x-title/x-tags/x-important/x-recommend/x-pending
POST /api/docs                   # {title,markdown,category,summary,confidence,tags,points,rawId,id?,
                                 #  important?,recommend?,baseVersion?}；只改元数据不涨版本
POST /api/docs/delete            # 管理员或作者
POST /api/docs/restore           # 回滚到某个版本
POST /api/docs/batch-delete      # {ids[]}；非管理员只能删自己的；顶层恒 ok:true，逐条看 results
POST /api/raw/skip               # 管理员
POST /api/raw/delete             # 管理员或上传者，且该素材未成文
GET  /api/important              # 未读重要资料（没读过的不能 ack → 409 needRead）
POST /api/important/ack
GET  /api/collections            # 我的收藏夹
POST /api/collections            # {action: create|rename|remove|add|remove-doc, ...}
GET  /api/comments?docId=
POST /api/comments               # {docId,body}；body 里 @成员名 会进对方的 @ 未读
POST /api/comments/delete        # 作者或管理员
GET  /api/mentions
POST /api/mentions/seen
GET  /api/weekly                 # 本周简报（due 只在 /api/status 里）
POST /api/weekly/seen
GET  /api/members
POST /api/members                # 管理员
POST /api/members/remove         # 管理员
POST /api/members/rotate         # 管理员
GET  /api/stats                  # 含 important / comments
GET  /api/audit                  # 管理员
GET  /install/<file>.tgz
```

**本机私有库**不经过 Hub：`index.js` 在 `~/.dsh/shared-kb-private` 起一个本地 `Store`（`require('./hub.js')` 复用），对外是 `/shared-kb/api/private/*`（`status/list/doc/docs/docs-delete/history/comments/raw`），并把 `/list`、`/search`、`/inbox`、`/raw`、`/raw/delete`、`/raw/skip`、`/raw/touch` 做成「本机命中走本机，否则代理 Hub」。私有文档 id 前缀固定 `priv_`，路由靠它分流——**新增私有写入路径必须用 `privatePut()`/`privateId()` 生成 id**，否则分流失效、文档会跑到公开库去。

---

## 3. 在 Hub 机上把开发环境跑起来

前置：

- Node.js **20+**（Hub 只用内置模块）
- git
- 同一台机器上装 DSH（要改页面就必须有地方看效果）

### 3.1 拉代码

```powershell
cd %USERPROFILE%\Desktop
git clone https://github.com/kunjienie50-creator/dsh-shared-kb.git
cd dsh-shared-kb
npm install        # 只为 @deepseek-ai/schemastery；hub.js 本身零依赖
```

> 在 Hub 那台 Windows 机上 `npm install` 会因 npm 缓存目录权限报 `EPERM`，**可以跳过**：`hub.js` 零依赖，`index.js` 里的 `@deepseek-ai/schemastery` 由 DSH 宿主解析，加载失败时还有回退查找。

### 3.2 先备份现有数据（重要）

```powershell
Copy-Item -Recurse "$env:USERPROFILE\.dsh-shared-kb" "$env:USERPROFILE\.dsh-shared-kb.bak-$(Get-Date -Format yyyyMMdd-HHmm)"
```

### 3.3 启动 Hub（用现有数据）

```powershell
node hub.js --data "$env:USERPROFILE\.dsh-shared-kb" --port 8787 --host 0.0.0.0 `
  --url https://desktop-hrgqhrm.tailad1fc2.ts.net
```

或者双击 `install\启动知识库.bat`（会顺带打印管理员邀请码）。

验证：

```powershell
curl.exe http://127.0.0.1:8787/health
node hub.js --data "$env:USERPROFILE\.dsh-shared-kb" --list-members
```

### 3.4 在本机 DSH 里装开发版

改代码时用**本地目录**安装，不要用 GitHub 版，否则改动不生效：

1. DSH → 插件页 → 添加 → 选本地目录（或让 agent 调 `plugin_manager install_bundle target=<仓库绝对路径>`）
2. 装完刷新页面；改 `client.js` 后也需要刷新
3. 改 `index.js`（宿主）后，禁用再启用插件，或重新安装

> 同一个 profile 里已有 GitHub 版时，先移除再装本地目录，避免两份同名包。

---

## 4. 日常开发循环

```powershell
# 改完先做语法检查（三个文件都要过）
node --check hub.js
node --check index.js
node --check client.js

# 只改 Hub：重启 hub.js 即可，数据不动
# 只改宿主插件：插件页禁用→启用（或让 agent 调 plugin_manager set_plugin enabled=false/true）
# 改页面：刷新浏览器页面（Ctrl+R）
```

### 4.1 Hub 那台机上有个看门狗（省事，但要知道它在）

`kb-hub-watch.ps1` 每 15 秒检查 8787 有没有人监听，没有就用**仓库里最新的 `hub.js`** 以指定参数拉起。所以：

```powershell
# 改完 hub.js，杀掉进程，等 ≤15 秒它就用新代码起来了
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*hub.js*' } | ForEach-Object { taskkill /PID $_.ProcessId /F }
Start-Sleep -Seconds 18
curl.exe http://127.0.0.1:8787/health     # 看 version 是不是新的
```

> 反过来的坑：你以为「没重启」，其实看门狗早用新代码重启了；或者端口被一个**旧代码**的进程占着，看门狗看端口有人就不再拉起——`/health` 报的 version 不对就是这种情况，杀掉再用 `/health` 核对。

### 4.2 改 `client.js` 的两个硬性要求

1. **必须整份包进 IIFE**（`;(function () { ... })()`）。宿主把多个插件的 `client.js` 拼进同一个 script 响应，顶层留 `const API` / `let React` 这类标识符会和别的插件撞名，报 `Identifier 'React' has already been declared`，整页白屏。
2. **不要用 `window.prompt`**。DSH 桌面端是 Electron，`window.prompt` 不可用；`window.confirm` 能用但跟页面风格不搭。用 `client.js` 里自带的 `ask()` / `askConfirm()`（内部渲染 `AskHost`）。
3. CSS 里别用 `--dsw-alias-bg-base`：上了自定义皮肤的机器上它的值可能是 `transparent`，页面会透出壁纸。用 `.skb-wrap` 上定义的 `--skb-surface`。

改完 `node --check client.js` 过了也只是语法对；真正的验证是刷新页面后看 Console 有没有 `slot entry crashed` / React 报错。

### 4.3 想看页面效果但没登录态

DSH Web 是签名 cookie 鉴权（cookie 名 `dsh-auth-` + base64url(sha256(host))，值 `v1.<b64url(payload)>.<b64url(HMAC)>`）。**自己按文档推签名有坑，试过四种组合全 401**：直接从浏览器 DevTools 里把当前 cookie 抄出来，塞进脚本的 `headers.cookie` 打宿主接口即可（有效期一般一天）。浏览器自动化用 `bsk_*` 工具，注入 `document.cookie` 后 reload 就能进 GUI。

测试清单（每次发版前）：

- [ ] `curl.exe /health` 正常，且 version 是新的
- [ ] 页面能打开、能搜到已有文档
- [ ] 上传一个文本文件 → 自动成文（或进待整理）
- [ ] 同一文件再传一次 → `duplicate:true`
- [ ] 下载原始素材 → 文件名不是 `raw.bin`
- [ ] 管理页：加成员 → 出邀请码；换令牌 → 旧码失效
- [ ] 普通成员看不到「管理」按钮
- [ ] `node smoke-hub.mjs`（工作区根目录，不在仓库里）全绿
- [ ] 页面：标重要（推荐语 <10 字被拒）→ 别人看到红色提醒 → 没读过不能取消置顶
- [ ] 页面：收藏夹建/改名/删、评论 + `@名字`、历史版本对比与回滚
- [ ] 页面：批量下载得到一个 zip、批量删除后列表刷新
- [ ] 页面：上传时选「仅自己可见」→ 只在私有库、`/list?scope=public` 里看不到

---

## 5. 版本升级与发布（照抄）

### 5.1 改版本号（三个地方 + 脚本）

1. `package.json` → `"version"`
2. `hub.js` → `const VERSION = '0.3.x'`
3. `install/启动知识库.command` / `.bat`、`README.md`、`release/PUBLISHING.md` 里的 tarball 文件名 `dsh-shared-kb-0.3.x.tgz`
4. `dist/` 里的 tgz 文件名（Hub 的 `/install/<file>.tgz` 直接读这里，旧名不删会一直发旧包）

### 5.2 重新打安装包

```powershell
Remove-Item dist\*.tgz
# 先在临时目录摆成 package/ 再打（Windows 自带 bsdtar 不支持 -s，见下面的坑）
$stage = Join-Path $env:TEMP "skb-stage"
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
$pkg = Join-Path $stage 'package'; New-Item -ItemType Directory -Path $pkg -Force | Out-Null
foreach ($i in 'package.json','index.js','client.js','hub.js','cordis.patch.yml','icon.svg','README.md','LICENSE') { Copy-Item $i $pkg }
foreach ($d in 'locale','skills','install') { Copy-Item $d (Join-Path $pkg $d) -Recurse }
tar -czf dist/dsh-shared-kb-0.3.x.tgz -C $stage package
Remove-Item $stage -Recurse -Force
```

> **坑（v0.3.0 实测）**：Windows 自带的 `tar.exe` 是 bsdtar，但这个版本**不支持 `-s` 换前缀**，会直接报 `tar.exe: -s is not supported by this version of bsdtar`。所以用上面的「先 stage 再打」；Linux 的 GNU tar 可以用 `--transform='s,^,package/,'`，macOS 的 bsdtar 支持 `-s`。
> 解包检查：`tar -tzf dist\dsh-shared-kb-0.3.x.tgz`，应有 `package/` 前缀、约 52~54 条；中文名的 `install/启动知识库.*` 会带 `PaxHeader/` 条目，正常。
> 别拿 0.2.2 那个包当参照——它是 macOS 打的，塞了几十个别名 `._*` 和 `PaxHeader` 垃圾（117 条），条目数多少不代表内容多少。

### 5.3 提交并推送

```powershell
git add -A
git commit -m "feat: ... (0.3.x)"
git push origin main
```

### 5.4 建 GitHub Release（市场/朋友安装用）

网页最省事：仓库 → Releases → Draft a new release：

- Tag：`v0.3.x`（新建）
- 附件：上传 `dist\dsh-shared-kb-0.3.x.tgz`
- 发布

或者有 `gh` 时：

```powershell
gh release create v0.3.x dist\dsh-shared-kb-0.3.x.tgz --title v0.3.x --notes "..."
```

### 5.5 让已装的人升级

DSH 里移除旧插件 → 重新安装新版本 → 刷新页面。**升级已安装包必须重新安装**（HMR 不会替换已加载的客户端模块）。

### 5.6 上架信息要不要改

只有「插件名/描述/仓库地址」变了才需要改目录条目；普通版本升级不用动 PR。若确需改：

1. 在 fork 的 `add-dsh-shared-kb` 分支改 `data/plugins/kunjienie50-creator__dsh-shared-kb.yml`
2. push，PR 会自动更新并重跑 CI

---

## 6. 分发渠道（按可靠性排序）

1. **dshmarket（目标渠道，等目录 PR 合并）**：合并后市场里搜「共享知识库」直接装。条目在
   `awesome-dsh-plugin` 的 `data/plugins/kunjienie50-creator__dsh-shared-kb.yml`，带 `tarball:` 指向
   `releases/latest/download/dsh-shared-kb.tgz`（**版本无关的文件名**，见 `release/PUBLISHING.md` 的说明）。
2. **Hub 自带安装包**：把 `dist/dsh-shared-kb-0.3.x.tgz` 放到 Hub 的 `dist/` 目录，重启 Hub，成员用  
   `https://desktop-hrgqhrm.tailad1fc2.ts.net/install/dsh-shared-kb-0.3.x.tgz`  
   （在 DSH 的「插件 → 添加插件」里粘这个 URL 即可，会显示为「压缩包」）
3. **GitHub Release 直链**：`https://github.com/.../releases/download/v0.3.x/dsh-shared-kb-0.3.x.tgz`（国内可能慢）
4. **GitHub 仓库 spec**：`github:kunjienie50-creator/dsh-shared-kb`（需要 git）
5. **npm**（未发布）：`dsh-shared-kb`，本机 `npm whoami` 是 `ENEEDAUTH`，要发得先 `npm login`

> 2026-10-30 已把 Hub 的 `dist/` 换成 `dsh-shared-kb-0.3.0.tgz`，`/install/` 这条链路可用。**`dist/` 里别留旧版本包**，成员可能按老链接装到 0.3.x（0.2.0 有白屏 bug）。

> ⚠️ **别在 Hub 自己这台机器上用「插件 → 添加插件 → URL」装本仓库的包**。本机 profile 的
> `node_modules/dsh-shared-kb` 是指向仓库的 **Junction**，npm 会把仓库当成安装目标，`npm pack`
> 阶段会删掉 `.git/` 里的 `HEAD`/`config`/`index`/`hooks/`（`objects/` 和 `refs/` 能幸存）。2026-10-30
> 踩过一次，恢复命令在 `DEV-SETUP.md`「别在本机 profile 里装 URL 安装包」那节。本机要升级就
> `remove_bundle` 再装本地目录，或者干脆只做 `set_plugin enabled=false/true` 重载。

---

## 7. 成员、邀请码、管理员

- 成员由管理员**预先创建**，邀请码 = `skb1.` + base64(`{u:Hub地址, t:令牌, n:名字}`)
- 邀请码不是一次性的，等同该成员的密码；私发，不要发群
- 泄露就「换令牌」，旧码立即失效
- 生成邀请码前，先把「管理 → 对外地址」设成成员真正能访问的地址；改地址后必须重新生成
- 重新打印某人的邀请码：

```powershell
node hub.js --data "$env:USERPROFILE\.dsh-shared-kb" --invite 名字 --url https://desktop-hrgqhrm.tailad1fc2.ts.net
```

- 其他 CLI：`--add-member 名字 [--admin]`、`--remove-member 名字`、`--rotate 名字`、`--list-members`、`--rename "新库名"`

---

## 8. 网络：Funnel / Tailscale / 局域网

| 方式 | 谁能访问 | 说明 |
|---|---|---|
| `http://10.210.138.54:8787` | 同一办公室网络 | 最快；IP 可能变 |
| `http://100.77.33.48:8787` | 装了 Tailscale 的设备 | 你自己的两台机器 |
| `https://desktop-hrgqhrm.tailad1fc2.ts.net` | 公网任何人（凭令牌） | 朋友零安装；国内可能慢 |

Funnel 开关（在 Hub 那台 Windows 上）：

```powershell
tailscale funnel --bg 8787     # 开
tailscale funnel status        # 看
tailscale funnel reset         # 关（Tailscale 内网访问不受影响）
```

彻底禁用：Tailscale 后台 → Access controls 删掉 `funnel` 节点属性。

安全：Funnel 是公网入口，只有令牌保护；不要把 8787 再额外映射到公网，令牌泄露就换。

---

## 9. 改规范化规则（最容易改错的地方）

规则存在**两处**，必须同步改：

1. `skills/shared-kb/SKILL.md` —— agent 主动整理时读的规范
2. `index.js` 里的 `NORMALIZE_SYSTEM` —— 页面上传后自动整理用的提示词

分类枚举也在两处：

- `hub.js` → `CATEGORIES`
- `index.js` → `CATEGORIES`（客户端从 `/api/status` 读，不用改 client）

其他约定：

- `summary` 由 `clampSummary()` 截到 10 字
- 同文件靠 sha256 去重；同标题 + 同分类会 409（避免重复成文）
- `points` 2~4 条、`confidence` 高/中/低，都是可选字段，缺省也能用

---

## 10. 已知问题与 TODO

- [ ] **npm 未发布**：想发就 `npm login` + `npm publish --access public`（`dsh-shared-kb` 名字可用）
- [x] **Hub 的 dist 是 0.2.0** → 2026-10-30 已换成 `dsh-shared-kb-0.3.0.tgz`，`/install/` 实测 200 / 137311 字节
- [ ] **自动规范化未在真实页面完整验证**：代码路径有失败兜底（进待整理），但建议亲手传几个 PDF/截图确认
- [ ] **PDF/Word/扫描件**：不会自动抽取，靠 agent 用 office/OCR 技能转文本后入库
- [ ] **没有在线状态**：管理页只有成员名单，不显示谁在线；「没人加入」是正常现象
- [ ] **规模**：文档存 JSON、搜索是内存扫描，5~20 人够用；上千篇建议换 SQLite FTS5
- [ ] **上架 PR 等合并**：`awesome-dsh-plugin/awesome-dsh-plugin#10560`，`check` 与 `Submission gate` 已 SUCCESS，条目内容已升级到 v0.3.0 并加 `tarball:`；维护者合并后市场约 1 天内出现
- [ ] **零基础用户装完是死路**：市场安装的人没有 Hub，页面会停在「填邀请码 / 手动配置」。要么有人给他邀请码，要么做「本机一键起 Hub（仅自己用）」的 solo 模式 —— 这是上架后最该补的一块
- [ ] **icon 没做**：目录条目不写 `icon:` 就回退作者头像；要的话准备一张 GitHub 托管的 png（`icon-180.png` 之类）再加 `icon:` 字段
- [ ] **GitHub token**：之前用过的那枚建议吊销；以后用 `gh auth login` 或新建短有效期 PAT
- [ ] **客户端改动需刷新**：页面改动不会热更，装/升级后都要刷新（升级已安装包要重装）
- [ ] **宿主侧没有回归脚本**：`smoke-hub.mjs` 只测 `hub.js`；`index.js` 的 zip 打包、私有库、`/normalize` 目前只靠工作区里的 `.probe-*.mjs` 手工跑
- [ ] **群发通知仍是拉取式**：重要资料和 @ 靠打开页面时读 `/api/status`，没有推送（不想引 WebSocket）
- [ ] **排序只有三种**：`updated` / `created` / `important`；没有「按热度/评论数」
- [ ] **向量检索**：**明确不做**（理由见 README §八）；真到几千篇再作为 `--embed` 可选模块

---

## 11. 故障排查

| 现象 | 先查 |
|---|---|
| 页面空白 / 一直「未连接」 | 插件是否 0.2.1+（含 `webServer` 硬依赖）；DSH 是否刚重启过（⌘Q 重开）；页面红色错误里的接口地址 |
| 整页白屏且 Console 有 `slot entry crashed` / React error #31 | `client.js` 里有对象被当 React 子节点渲染了（典型是 `{ ...(cond ? {} : {}) }` 这种残留）；看报错行号附近 |
| 白屏 + `Identifier 'React' has already been declared` | `client.js` 没包进 IIFE，顶层标识符跟别的插件撞了 |
| 页面透出壁纸照片、字看不清 | 该机器皮肤把 `--dsw-alias-bg-base` 设成了 `transparent`；用 `--skb-surface` |
| 弹窗点了没反应（原本是 prompt） | Electron 没有 `window.prompt`；用自带的 `ask()` |
| 401 / 403 | 令牌是否被换过；邀请码里的地址是否是当前对外地址；Funnel 是否开着 |
| 下载名是 `raw.bin` | 插件是否 0.2.2+ |
| 批量删除提示「Hub 返回 200」 | 0.3.x 的老 bug；v0.3 已把顶层 `ok` 固定为 true，逐条原因在 `results` |
| 取消置顶按钮点了报错 | 服务端 409 `needRead`：还没读过这篇，先点进去读 |
| Hub 进程崩了 | 数据不会丢；重启 `node hub.js ...`；看端口占用；`config.json` 是否完好（**注意别被存成带 BOM**） |
| 成员表突然空了、所有令牌 401 | `config.json` 被写成带 BOM 的版本，0.2.2 会解析失败并重建空成员表（v0.3 已修 `readJson` 去 BOM）。用备份恢复 `config.json` |
| 邀请码连不上 | `curl <Hub地址>/health`；局域网/Tailscale/Funnel 三者选对；防火墙放行 8787 |
| 成员说看不到库 | 插件是否装成功；是否刷新；是否用了别人的邀请码（身份会串） |
| 上传者下拉里少人 / 只有几个人 | 0.3.x 的老 bug（只统计当前页）；v0.3 改为读整库 `authors()` |

---

## 12. 备份与迁移

```powershell
# 备份（停不停服都行，建议停）
Copy-Item -Recurse "$env:USERPROFILE\.dsh-shared-kb" "D:\backup\dsh-shared-kb-$(Get-Date -Format yyyyMMdd)"
```

恢复：停 Hub → 用备份覆盖数据目录 → 启动。`config.json` 含所有令牌，备份文件要保管好。

迁移到新机器：拷数据目录 + 仓库 + `hub.js`，改 `--url` / 对外地址，重新生成邀请码（地址变了旧码失效）。

---

## 13. 交接清单

- [ ] GitHub 仓库权限（`kunjienie50-creator`）
- [ ] awesome-dsh-plugin fork 与 PR #10560 的后续跟进
- [ ] Hub 机器 + 数据目录 + 备份
- [ ] Tailscale 账号（Funnel / 内网 IP）
- [ ] npm 账号（如果要发 npm）
- [ ] 本机 `~/.dsh/shared-kb.json` 里当前成员的令牌
- [ ] 所有旧 token 轮换一遍（GitHub PAT、成员令牌）

---

## 14. v0.3.0 做了什么、踩了什么（2026-10-30，Windows 机上升级）

### 14.1 新功能

| 需求 | 实现 |
|---|---|
| 按上传者 / 重要性强筛 | `/api/list` 的 `author`、`important=only\|exclude`；页面两个 select |
| 分类赋予后可改 | 详情页分类下拉 → `POST /api/docs` 只带 `category`，**局部提交不涨版本、不清空 tags/points** |
| 重要 issue 专栏 + 防滥发 | `important` + 必填 `recommend`（10~200 字，两端都校验）；`/api/important` 置顶栏；`ack` 前必须 `doc/open` 过，否则 409 `needRead` |
| 个人收藏夹（多分类） | `state.json` 里按成员存 `collections[]`；`/api/collections` 增删改 + 放入/移出 |
| 每周总结弹窗 | `/api/weekly` 出报告，`/api/status.weeklyDue` 决定弹不弹，`weekly/seen` 关掉 |
| 直接存待整理 + 整理按钮 | 上传带 `pending`（不调模型）；待整理列表里逐条「AI 整理」→ `POST /normalize` |
| 上传前选公开 / 仅自己可见 | 上传弹窗单选 `scope`；私有走本机 `Store`，id `priv_`，永不上传 |
| 批量上传 / 删除 / 下载 | 上传支持多选；`/batch-delete` 逐条结果；`/batch/download` 在宿主侧打成 zip（零依赖 STORE writer） |
| 删除权限 | 文档：作者或管理员；素材：上传者或管理员 |
| 评论 / @ / 冲突 / 版本对比 | `comments/<docId>.json`、`@成员名` 精确匹配进 mentions、`baseVersion` 冲突 409 回带 `latest`、`diffLines` 行级 LCS 对比 + 回滚 |

顺带还做了：`skb_recall`（多篇摘要聚合成 digest）、`skb_search(compact)` 只回目录、审计日志页、`summary` 两处截断统一为 10 字（`SUMMARY_MAX`）、`readJson` 去 BOM 防丢成员表、`authors` 改成整库统计。

### 14.2 这次踩过的坑（按难受程度排）

1. **PowerShell 读写中文会毁文件**：`(Get-Content x -Raw) -replace ... | Set-Content x` 会按 ANSI/GBK 解码再写回，中文变成 U+FFFD 替换字符（汉字被替换成乱码方块）。**改中文文本一律用 node / edit 工具**；已经毁的用 `git checkout --` 还原后用 node 重写。
2. **`Get-Content config.json -Raw | ConvertFrom-Json` 会因 GBK 解码失败**报「传入的对象无效」，导致令牌读空、所有请求 403。探测脚本一律写成 `.mjs` 用 node 跑。
3. **`client.js` 必须整份 IIFE 包裹**，否则顶层 `const/let` 与其它插件撞名，报 `Identifier 'React' has already been declared`，整页白屏。
4. **React 子节点不能是对象**：留一行 `{ ...(cond ? {} : {}) }` 就 `Minified React error #31`，而且报错位置是插槽层，很难连回源码——只能靠 Console 里的 `slot entry crashed in 'main'` 定位。
5. **`--dsw-alias-bg-base` 在自定义皮肤下是 `transparent`**，整页透出壁纸。用自己定义的 `--skb-surface` 兜底。
6. **Electron 没有 `window.prompt`**，全部改自建 `ask()` / `AskHost`。
7. **Windows 自带 bsdtar 不支持 `-s`**，打包要先 stage 成 `package/` 目录（见 §5.2）。
8. **HMR 会把半截文件推给浏览器**，报 `Unexpected end of input`；`node --check` 能过就不是代码问题，刷新一次即可。
9. **DSH Web 签名 cookie 自己推不出来**（四种组合全 401），只能从浏览器 DevTools 抄现成的。
10. **改 `index.js` 后必须重载插件**（`plugin_manager set_plugin enabled=false` → `true`）；改 `client.js` 只需刷新页面。

### 14.3 这一版的验证状况

- `smoke-hub.mjs`（工作区根目录，不在仓库里）：**66 项全绿**，覆盖鉴权、去重、文件名、inbox、成文、409 重名、summary 截断、收藏夹、评论/@、周报、重要置顶与 `needRead`、版本冲突、批量删除语义、权限矩阵、审计。
- `.probe-private.mjs`：私有库端到端 **19/19**（上传 → 不调模型 → 合并列表 → 下载 → 成文 → 搜索 → 评论 → 批量删 → 清理）。
- `.probe-guards.mjs`：公开库守卫 **10/10**（短推荐语 400、批量空/不存在 id、未知路由 404 等）。
- 浏览器实测：列表/详情/周报/收藏夹/评论/历史/上传弹窗/批量条/批量 zip 都点过，测试数据已清干净。
