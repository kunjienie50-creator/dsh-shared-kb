# dsh-shared-kb 交接与后续开发指南

> 给在 Hub 那台电脑上继续开发/升级的人看。目标：拿到这份文档就能跑起来、改得动、发得出去。
> 当前版本 **0.2.2**，最后更新 2026-10-30。

---

## 0. 一句话现状

| 项 | 状态 |
|---|---|
| 插件代码 | https://github.com/kunjienie50-creator/dsh-shared-kb（main，v0.2.2） |
| 安装包 | GitHub Release `v0.2.2`，附件 `dsh-shared-kb-0.2.2.tgz` |
| dshmarket 上架 | PR **#10560** 已开，CI 已通过（`Submission gate` / `check` 均 success），等维护者合并 |
| npm | **未发布**（没有 npm token，不阻塞上架；市场会走 GitHub 源码安装） |
| Hub | 跑在 Windows 桌面机 `desktop-hrgqhrm`，公网入口 `https://desktop-hrgqhrm.tailad1fc2.ts.net`（Tailscale Funnel） |
| 数据 | Hub 机器上的 `.dsh-shared-kb` 目录（`config.json` + `docs/` + `raw/`） |

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
│ skb_* 工具（9 个）       │──HTTP────▶│  config.json  成员/令牌     │
│ 自动规范化（调用模型）   │            │  docs/*.json  成文+版本     │
└────────────────────────┘            │  raw/*.json+bin 原始素材    │
                                      │  audit.jsonl  管理流水      │
                                      └─────────────────────────────┘
```

### 文件职责

| 文件 | 职责 |
|---|---|
| `hub.js` | 零依赖服务端：鉴权、上传、去重、搜索、版本、成员管理、`/install/*.tgz` 分发 |
| `index.js` | DSH 宿主插件：Config、9 个工具、同源页面路由、上传后自动规范化、技能自动安装、系统提示词 |
| `client.js` | 侧栏入口 + 主页面（上传/搜索/阅读/管理页），纯 JS + React，无构建步骤 |
| `skills/shared-kb/` | 规范化技能（团队版 inbox-triage：十类、≤10 字总结、置信度、要点、回执） |
| `skills/upstream/` | 你的另外三个技能原样副本（`long-dialogue-knowledge`、`controversy-analysis`、`idea-synthesis`），插件首次加载时自动装到 `~/.dsh/skills/` |
| `install/` | 双击启动 Hub 的脚本 |
| `dist/` | 给 Hub 分发的安装包（`/install/` 路由从这里取） |
| `release/` | 上架说明与目录条目模板 |

### Hub 数据格式

```
docs/<id>.json   { id,title,summary,category,confidence,tags[],points[],author,
                   rawId,sha256,createdAt,updatedAt,version,markdown,versions[] }
raw/<id>.json    { id,name,title,tags[],author,bytes,sha256,status,skipReason,createdAt }
raw/<id>.bin     原始字节（不可变）
config.json      { name, members:[{name,role,token,createdAt}] }
audit.jsonl      增删成员、删素材等管理操作
```

`status`：`new`（待整理）→ `archived`（已成文）/ `skipped`（标记无用）。

### Hub API（除 `/health`、`/install/*` 外都要 `Authorization: Bearer <token>`）

```
GET  /health
GET  /api/status
GET  /api/list?category=&tag=&limit=&offset=
GET  /api/search?q=&category=&limit=
GET  /api/doc?id=
GET  /api/inbox?status=new|all
GET  /api/raw?id=
POST /api/upload                 # 裸文件体；x-filename/x-title/x-tags（URI 编码）
POST /api/docs                   # {title,markdown,category,summary,confidence,tags,points,rawId,id?}
POST /api/docs/delete            # 管理员或作者
POST /api/raw/skip               # 管理员
POST /api/raw/delete             # 管理员，且该素材未成文
GET  /api/members
POST /api/members                # 管理员
POST /api/members/remove         # 管理员
POST /api/members/rotate         # 管理员
GET  /api/stats
GET  /install/<file>.tgz
```

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
# 只改宿主插件：插件页禁用→启用
# 改页面：刷新浏览器页面（Ctrl+R）
```

测试清单（每次发版前）：

- [ ] `curl.exe /health` 正常
- [ ] 页面能打开、能搜到已有文档
- [ ] 上传一个文本文件 → 自动成文（或进待整理）
- [ ] 同一文件再传一次 → `duplicate:true`
- [ ] 下载原始素材 → 文件名不是 `raw.bin`
- [ ] 管理页：加成员 → 出邀请码；换令牌 → 旧码失效
- [ ] 普通成员看不到「管理」按钮

---

## 5. 版本升级与发布（照抄）

### 5.1 改版本号（三个地方 + 脚本）

1. `package.json` → `"version"`
2. `hub.js` → `const VERSION = '0.2.x'`
3. `install/启动知识库.command` / `.bat`、`README.md`、`release/PUBLISHING.md` 里的 tarball 文件名 `dsh-shared-kb-0.2.x.tgz`

### 5.2 重新打安装包

```powershell
Remove-Item dist\*.tgz
tar -czf dist/dsh-shared-kb-0.2.x.tgz -s ",^,package/," package.json index.js client.js hub.js cordis.patch.yml locale icon.svg skills README.md install LICENSE
```

> macOS / Windows 自带的是 bsdtar，支持 `-s`；Linux 的 GNU tar 改成 `--transform='s,^,package/,'`。
> 解包检查：`tar -tzf dist\dsh-shared-kb-0.2.x.tgz | findstr cordis`

### 5.3 提交并推送

```powershell
git add -A
git commit -m "feat: ... (0.2.x)"
git push origin main
```

### 5.4 建 GitHub Release（市场/朋友安装用）

网页最省事：仓库 → Releases → Draft a new release：

- Tag：`v0.2.x`（新建）
- 附件：上传 `dist\dsh-shared-kb-0.2.x.tgz`
- 发布

或者有 `gh` 时：

```powershell
gh release create v0.2.x dist\dsh-shared-kb-0.2.x.tgz --title v0.2.x --notes "..."
```

### 5.5 让已装的人升级

DSH 里移除旧插件 → 重新安装新版本 → 刷新页面。**升级已安装包必须重新安装**（HMR 不会替换已加载的客户端模块）。

### 5.6 上架信息要不要改

只有「插件名/描述/仓库地址」变了才需要改目录条目；普通版本升级不用动 PR。若确需改：

1. 在 fork 的 `add-dsh-shared-kb` 分支改 `data/plugins/kunjienie50-creator__dsh-shared-kb.yml`
2. push，PR 会自动更新并重跑 CI

---

## 6. 分发渠道（按可靠性排序）

1. **Hub 自带安装包**：把 `dist/dsh-shared-kb-0.2.x.tgz` 放到 Hub 的 `dist/` 目录，重启 Hub，成员用  
   `https://desktop-hrgqhrm.tailad1fc2.ts.net/install/dsh-shared-kb-0.2.x.tgz`
2. **GitHub Release 直链**：`https://github.com/.../releases/download/v0.2.x/dsh-shared-kb-0.2.x.tgz`（国内可能慢）
3. **GitHub 仓库 spec**：`github:kunjienie50-creator/dsh-shared-kb`（需要 git）
4. **npm**（未发布）：`dsh-shared-kb`，发布后市场安装最顺

> 当前坑：Hub 的 `dist/` 里还是 `0.2.0`，而 0.2.0 有页面接口 bug（白屏）。**发朋友前务必把 0.2.2+ 的包放进 Hub 的 dist**。

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
- [ ] **Hub 的 dist 是 0.2.0**：换成 0.2.2+ 再发给朋友
- [ ] **自动规范化未在真实页面完整验证**：代码路径有失败兜底（进待整理），但建议亲手传几个 PDF/截图确认
- [ ] **PDF/Word/扫描件**：不会自动抽取，靠 agent 用 office/OCR 技能转文本后入库
- [ ] **没有在线状态**：管理页只有成员名单，不显示谁在线；「没人加入」是正常现象
- [ ] **规模**：文档存 JSON、搜索是内存扫描，5~20 人够用；上千篇建议换 SQLite FTS5
- [ ] **上架 PR 等合并**：CI 已过，维护者 review 后合并，市场约 1 天内出现
- [ ] **GitHub token**：之前用过的那枚建议吊销；以后用 `gh auth login` 或新建短有效期 PAT
- [ ] **客户端改动需刷新**：页面改动不会热更，装/升级后都要刷新（升级已安装包要重装）

---

## 11. 故障排查

| 现象 | 先查 |
|---|---|
| 页面空白 / 一直「未连接」 | 插件是否 0.2.1+（含 `webServer` 硬依赖）；DSH 是否刚重启过（⌘Q 重开）；页面红色错误里的接口地址 |
| 401 / 403 | 令牌是否被换过；邀请码里的地址是否是当前对外地址；Funnel 是否开着 |
| 下载名是 `raw.bin` | 插件是否 0.2.2+ |
| Hub 进程崩了 | 数据不会丢；重启 `node hub.js ...`；看端口占用；`config.json` 是否完好 |
| 邀请码连不上 | `curl <Hub地址>/health`；局域网/Tailscale/Funnel 三者选对；防火墙放行 8787 |
| 成员说看不到库 | 插件是否装成功；是否刷新；是否用了别人的邀请码（身份会串） |

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
