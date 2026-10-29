# 上架到 dshmarket 的完整步骤

dshmarket 只展示 **awesome-dsh-plugin** 这个目录里的插件。所以「上架」= 两件事：

1. 有一个公开的 GitHub 仓库（插件代码），最好再发一个 npm 包；
2. 去 `awesome-dsh-plugin` 仓库提一个 PR，加**一个 YAML 文件**。

目录合并后，dshmarket 通常一天内自动出现，朋友在本地 DSH 的插件市场里搜「共享知识库」就能装。

> 硬性门槛：GitHub 仓库要**创建满 1 天**，并加 `dsh-plugin` topic。所以最快是「今天建仓库 → 明天提 PR」。

---

## 进度

- ✅ GitHub 仓库已建好并推送：https://github.com/kunjienie50-creator/dsh-shared-kb
- ✅ `dsh-plugin` topic 已加；已验证 `github:kunjienie50-creator/dsh-shared-kb` 能安装
- ⏳ npm：等待 token（可选）
- ⏳ 目录 PR：仓库需满 1 天，已排期 2026-10-30 14:40（fork 的 `add-dsh-shared-kb` 分支已就绪）

## 1. 建 GitHub 仓库（已完成）

仓库名建议 `dsh-shared-kb`，公开。

```bash
cd dsh-shared-kb
git init
git add .
git commit -m "feat: team shared knowledge base plugin"
git branch -M main
git remote add origin https://github.com/kunjienie50-creator/dsh-shared-kb.git
git push -u origin main
```

推上去后，在仓库页面：

- **About → Topics** 加 `dsh-plugin`；
- 确认仓库根有 `package.json`（已声明 `dsh.bundle`）和 `cordis.patch.yml`。

然后把 `package.json` 里三处 `OWNER` 换成你的用户名：

```json
"repository": { "url": "https://github.com/kunjienie50-creator/dsh-shared-kb.git" },
"homepage": "https://github.com/kunjienie50-creator/dsh-shared-kb#readme",
"bugs": { "url": "https://github.com/kunjienie50-creator/dsh-shared-kb/issues" }
```

## 2. 发 npm（强烈建议）

发了 npm，市场安装时不用从源码构建，也不会卡 `allowBuilds` 审批。

```bash
npm login                      # 浏览器里登录/注册
npm publish --access public    # 包名 dsh-shared-kb（已确认未被占用）
```

发布前确认 `package.json` 没有 `"private": true`（本目录已经去掉）。

## 3. 提目录 PR

1. Fork `https://github.com/awesome-dsh-plugin/awesome-dsh-plugin`
2. 新建文件 `data/plugins/<你的GitHub用户名>__dsh-shared-kb.yml`：

```yaml
url: https://github.com/kunjienie50-creator/dsh-shared-kb
name: kunjienie50-creator/dsh-shared-kb
category: tools
description:
  en: 'Team shared knowledge base: one member runs a zero-dependency Hub, everyone else installs this plugin and joins with one invite code; uploads are normalized to ten categories with a summary, confidence and points, and every member’s agent can search them.'
  zh: '团队共享知识库：一个人在自己电脑跑零依赖 Hub，其他人装插件后粘一个邀请码即可加入；上传素材按十类 + 摘要 + 置信度 + 要点统一整理，所有人的 AI 都能检索。'
```

（现成模板在 `release/awesome-entry.yml`，把 `OWNER` 换掉即可。）

3. 提交 PR。CI 会检查仓库年龄、manifest、YAML 格式；通过后维护者会读一遍代码再合并。

## 4. 合并之后

朋友在 dshmarket 里搜索「共享知识库」安装，打开侧栏粘你生成的邀请码。

---

## 在那之前，朋友今天就能用

Hub 自带安装包地址，任何成员都能在 **插件 → 添加** 里直接粘贴：

```
http://<你的Hub地址>:8787/install/dsh-shared-kb-0.2.2.tgz
```

装完打开「共享知识库」，粘邀请码即可。和市场上装的效果完全一样，只是不在目录里展示。

## 需要我代做时

把下面任意一种给我，我可以直接执行：

- GitHub Personal Access Token（`repo` 权限），我用 API 建仓库、推代码、提 PR；
- npm Automation token（`NPM_TOKEN`），我发布 npm 包；
- 或者你按上面步骤自己点，我随时帮你核对报错。

Token 只用于这一次发布，用完请立刻在账号里吊销。
