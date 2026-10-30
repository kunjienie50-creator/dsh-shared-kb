'use strict'

/**
 * dsh-shared-kb — Client half
 *
 * 侧栏「共享知识库」入口 + 中栏整页：
 *  - 首次使用只填一个「邀请码」（或把手动配置折起来）；
 *  - 上传（点击/拖拽/多选）、公开 or 仅自己可见、「先不整理」、手动标重要（强制推荐语）；
 *  - 筛选：分类 / 上传者 / 重要性 / 归属（共享·私有）/ 收藏夹 / 排序；
 *  - 重要资料醒目提醒 + 读完才能取消置顶；收藏夹；周报弹窗；@我；评论；历史版本对比与恢复；
 *  - 批量下载（宿主打 zip）/ 批量删除（非管理员只能删自己的）；
 *  - 管理员视图：库统计、成员增删/轮换、邀请码、文档与素材清理、审计日志。
 * 数据走宿主同源路由 /shared-kb/api。
 */

// 整份文件包进 IIFE：宿主会把多个插件的 client.js 合并成同一个 <script> 响应，
// 顶层 `let/const` 会在合并作用域里与其它插件撞名（典型症状：
// SyntaxError: Identifier 'React' has already been declared）。
;(function () {
  let React = null

function h(type, props, ...children) {
  return React.createElement(type, props, ...children)
}

const API = (() => {
  try {
    const base = (typeof document !== 'undefined' && document.baseURI) || (typeof location !== 'undefined' ? location.href : '/')
    return new URL('shared-kb/api', new URL('.', base)).pathname.replace(/\/+$/, '')
  } catch { return '/shared-kb/api' }
})()

const ZH = {
  panel: '共享知识库', panelTitle: '团队共享知识库 — 上传 / 检索 / 管理',
  title: '共享知识库', subtitle: '随手丢进来，统一整理，所有人的 AI 都能查',
  searchPlaceholder: '搜索标题、要点、正文…', search: '搜索', clear: '清空',
  upload: '上传素材', uploading: '处理中…', refresh: '刷新', loading: '加载中…',
  empty: '还没有资料。点「上传素材」把第一份放进来。', emptySearch: '没有匹配的资料。',
  inbox: '待整理', inboxEmpty: '没有待整理的素材', docs: '已入库',
  author: '作者', updated: '更新', tags: '标签', version: '版本', points: '要点',
  category: '分类', all: '全部', confidence: '可信度',
  delete: '删除', cancel: '取消', save: '保存', close: '关闭', confirm: '确定', back: '返回',
  confirmDelete: '确定删除这篇文档？', deleted: '已删除', saved: '已保存',
  admin: '管理员', members: '成员', docsTable: '文档管理', rawList: '原始素材', noData: '暂无数据',
  stats: '库统计', invite: '邀请码', copy: '复制', copied: '已复制',
  skip: '跳过', deleteRaw: '删除素材', skipReason: '跳过原因',
  noPermission: '没有权限', download: '下载', edit: '编辑', cancelEdit: '取消编辑',
  retry: '重试', skipAll: '跳过全部', status: '状态',
  // ---- v0.3.0
  important: '重要', importantDoc: '重要资料', markImportant: '标为重要', unmarkImportant: '取消重要',
  recommend: '推荐语', recommendPlaceholder: '写清为什么值得所有人看（至少 10 字）…',
  recommendTooShort: '推荐语至少 10 个字', recommendRequired: '标为重要必须手写推荐语',
  importantBanner: '有 {n} 篇重要资料还没读', goRead: '去读', ackImportant: '取消置顶',
  ackNeedRead: '请先打开阅读，读完才能取消置顶', acked: '已取消置顶',
  recommendBy: '由 {by} 推荐', filterAuthor: '上传者', filterImportant: '重要性',
  importantOnly: '只看重要', importantExclude: '排除重要', anyAuthor: '全部上传者',
  collections: '收藏夹', newCollection: '新建收藏夹', collectionName: '收藏夹名',
  addToCollection: '加入收藏夹', removeFromCollection: '移出', inCollection: '已收藏',
  collectionEmpty: '还没有收藏夹', rename: '重命名', removeCollection: '删除收藏夹',
  collect: '收藏', collected: '已收藏',
  weekly: '本周报告', weeklyTitle: '本周知识库简报', weeklyNew: '新增', weeklyUpdated: '更新',
  weeklyImportant: '新标重要', weeklyAuthors: '贡献者', weeklyCategories: '分类分布',
  weeklyPrivate: '本机私有新增', weeklyMarkSeen: '知道了', weeklyLater: '稍后',
  private: '仅自己可见', privateTab: '私有库', privateHint: '只存在这台电脑上，不会上传服务器',
  scope: '归属', scopePublic: '团队共享', scopePrivate: '仅自己可见', scopeAll: '全部',
  pendingUpload: '先不整理（存为待整理）', pendingHint: '直接存着，稍后点「整理」再让 AI 处理',
  normalize: '整理', normalizing: '整理中…', normalized: '已整理入库',
  uploadTitle: '上传素材', uploadFiles: '选择文件（可多选）', dropHere: '松手即上传',
  batchMode: '批量', exitBatch: '退出批量', selected: '已选 {n} 项',
  batchDownload: '批量下载', batchDelete: '批量删除', selectAll: '全选', selectNone: '取消全选',
  deleteOwnOnly: '非管理员只能删除自己创建的文档',
  comments: '评论', commentPlaceholder: '写评论，@成员名 可提醒对方…', commentEmpty: '还没有评论',
  post: '发表', commentDeleted: '评论已删除', mention: '@ 我的',
  mentions: '提到我的', noMentions: '暂时没有新的提及',
  history: '历史版本', historyEmpty: '没有历史版本', compare: '对比', restore: '恢复此版本',
  restoreConfirm: '恢复到这个版本？当前内容会存为一个历史版本。', restored: '已恢复',
  current: '当前版本', diffAdded: '新增', diffRemoved: '删除',
  conflict: '保存冲突', conflictHint: '这篇文章已被别人改过。你可以先看最新版再合并。',
  viewLatest: '查看最新版', overwrite: '覆盖提交',
  editDoc: '编辑正文', titleField: '标题', summaryField: '摘要（≤10 字）', tagsField: '标签（逗号分隔）',
  pointsField: '要点（每行一条）', markdownField: '正文 Markdown', summaryLong: '摘要建议不超过 10 个字',
  sort: '排序', sortUpdated: '按更新', sortCreated: '按创建', sortImportant: '按重要性',
  rawOf: '来源素材', openRaw: '查看原始素材',
  audit: '审计日志', noToken: '还没连接知识库', setupTitle: '连接团队知识库',
  setupHint: '把管理员发给你的邀请码粘贴进来，一步完成。',
  invitePlaceholder: '粘贴邀请码（skb1. 开头）或令牌', invalidInvite: '邀请码无效',
  manual: '手动配置', hubUrl: 'Hub 地址', token: '成员令牌', memberName: '我的名字',
  connect: '连接', connected: '已连接', notConnected: '未连接',
  autoNormalize: '上传后自动整理', privateCount: '私有文档',
  total: '共 {n} 篇', loadMore: '加载更多', retryText: '加载失败', tokenMasked: '令牌',
}

const EN = {
  panel: 'Shared KB', panelTitle: 'Team shared knowledge base — upload / search / manage',
  title: 'Shared knowledge base', subtitle: 'Drop it in, AI normalizes it, everyone can query',
  searchPlaceholder: 'Search title, points, body…', search: 'Search', clear: 'Clear',
  upload: 'Upload', uploading: 'Working…', refresh: 'Refresh', loading: 'Loading…',
  empty: 'Nothing here yet. Upload the first item.', emptySearch: 'No matching items.',
  inbox: 'Pending', inboxEmpty: 'No pending raw items', docs: 'Documents',
  author: 'Author', updated: 'Updated', tags: 'Tags', version: 'Version', points: 'Points',
  category: 'Category', all: 'All', confidence: 'Confidence',
  delete: 'Delete', cancel: 'Cancel', save: 'Save', close: 'Close', confirm: 'OK', back: 'Back',
  confirmDelete: 'Delete this document?', deleted: 'Deleted', saved: 'Saved',
  admin: 'Admin', members: 'Members', docsTable: 'Documents', rawList: 'Raw items', noData: 'No data',
  stats: 'Stats', invite: 'Invite code', copy: 'Copy', copied: 'Copied',
  skip: 'Skip', deleteRaw: 'Delete raw', skipReason: 'Reason',
  noPermission: 'No permission', download: 'Download', edit: 'Edit', cancelEdit: 'Cancel',
  retry: 'Retry', skipAll: 'Skip all', status: 'Status',
  important: 'Important', importantDoc: 'Important', markImportant: 'Mark important', unmarkImportant: 'Unmark',
  recommend: 'Recommendation', recommendPlaceholder: 'Why should everyone read this? (≥10 chars)…',
  recommendTooShort: 'At least 10 characters', recommendRequired: 'A recommendation is required',
  importantBanner: '{n} important item(s) unread', goRead: 'Read', ackImportant: 'Unpin',
  ackNeedRead: 'Open and read it first', acked: 'Unpinned',
  recommendBy: 'Recommended by {by}', filterAuthor: 'Author', filterImportant: 'Importance',
  importantOnly: 'Important only', importantExclude: 'Exclude important', anyAuthor: 'All authors',
  collections: 'Collections', newCollection: 'New collection', collectionName: 'Collection name',
  addToCollection: 'Add to collection', removeFromCollection: 'Remove', inCollection: 'Saved',
  collectionEmpty: 'No collections yet', rename: 'Rename', removeCollection: 'Delete collection',
  collect: 'Save', collected: 'Saved',
  weekly: 'Weekly', weeklyTitle: 'Weekly knowledge brief', weeklyNew: 'New', weeklyUpdated: 'Updated',
  weeklyImportant: 'Newly important', weeklyAuthors: 'Contributors', weeklyCategories: 'By category',
  weeklyPrivate: 'New local private', weeklyMarkSeen: 'Got it', weeklyLater: 'Later',
  private: 'Private', privateTab: 'Private', privateHint: 'Stays on this computer only',
  scope: 'Scope', scopePublic: 'Team', scopePrivate: 'Only me', scopeAll: 'All',
  pendingUpload: 'Save without normalizing', pendingHint: 'Store as-is, normalize later',
  normalize: 'Normalize', normalizing: 'Normalizing…', normalized: 'Normalized',
  uploadTitle: 'Upload', uploadFiles: 'Choose files (multiple)', dropHere: 'Drop to upload',
  batchMode: 'Batch', exitBatch: 'Exit batch', selected: '{n} selected',
  batchDownload: 'Download', batchDelete: 'Delete', selectAll: 'Select all', selectNone: 'Select none',
  deleteOwnOnly: 'You can only delete your own documents',
  comments: 'Comments', commentPlaceholder: 'Comment, @name to notify…', commentEmpty: 'No comments yet',
  post: 'Post', commentDeleted: 'Comment deleted', mention: '@ me',
  mentions: 'Mentions', noMentions: 'No new mentions',
  history: 'History', historyEmpty: 'No history', compare: 'Compare', restore: 'Restore',
  restoreConfirm: 'Restore this version? Current content becomes a history version.', restored: 'Restored',
  current: 'Current', diffAdded: 'added', diffRemoved: 'removed',
  conflict: 'Save conflict', conflictHint: 'Someone else changed this document. Review the latest, then merge.',
  viewLatest: 'View latest', overwrite: 'Overwrite',
  editDoc: 'Edit body', titleField: 'Title', summaryField: 'Summary', tagsField: 'Tags (comma)',
  pointsField: 'Points (one per line)', markdownField: 'Markdown', summaryLong: 'Summary should be ≤10 chars',
  sort: 'Sort', sortUpdated: 'Updated', sortCreated: 'Created', sortImportant: 'Importance',
  rawOf: 'Raw file', openRaw: 'Open raw file',
  audit: 'Audit log', noToken: 'Not connected', setupTitle: 'Connect to team knowledge base',
  setupHint: 'Paste the invite code from your admin.',
  invitePlaceholder: 'Invite code (skb1.…) or token', invalidInvite: 'Invalid invite code',
  manual: 'Manual setup', hubUrl: 'Hub URL', token: 'Member token', memberName: 'My name',
  connect: 'Connect', connected: 'Connected', notConnected: 'Disconnected',
  autoNormalize: 'Auto-normalize uploads', privateCount: 'Private docs',
  total: '{n} total', loadMore: 'Load more', retryText: 'Failed to load', tokenMasked: 'Token',
}

// ---------------------------------------------------------------- helpers

function fill(template, vars) {
  return String(template).replace(/\{(\w+)\}/g, (match, key) => (vars && vars[key] !== undefined ? String(vars[key]) : match))
}

function formatTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  const now = Date.now()
  const delta = now - date.getTime()
  if (delta < 60 * 1000) return '刚刚'
  if (delta < 60 * 60 * 1000) return `${Math.floor(delta / 60000)} 分钟前`
  if (delta < 24 * 60 * 60 * 1000) return `${Math.floor(delta / 3600000)} 小时前`
  if (delta < 30 * 24 * 60 * 60 * 1000) return `${Math.floor(delta / 86400000)} 天前`
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function fmtBytes(n) {
  const value = Number(n) || 0
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function parseInvite(code) {
  const text = String(code || '').trim()
  if (!text) return null
  if (text.startsWith('skb1.')) {
    try {
      const json = atob(text.slice(5).replace(/-/g, '+').replace(/_/g, '/'))
      const data = JSON.parse(json)
      if (data && data.t) return { hubUrl: data.u || '', token: data.t, member: data.n || '' }
    } catch { return null }
  }
  if (/^[A-Za-z0-9_-]{16,}$/.test(text)) return { token: text }
  return null
}

function splitLines(text) {
  return String(text || '').split(/\r?\n/)
}

/** 行级 diff（LCS），用于历史版本对比。超过 1200 行退化为整段替换，避免开销爆炸。 */
function diffLines(oldText, newText) {
  const a = splitLines(oldText)
  const b = splitLines(newText)
  if (a.length > 1200 || b.length > 1200) {
    return [...a.map((text) => ({ type: 'del', text })), ...b.map((text) => ({ type: 'add', text }))]
  }
  const n = a.length
  const m = b.length
  const width = m + 1
  const dp = new Int32Array((n + 1) * width)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * width + j] = a[i] === b[j]
        ? dp[(i + 1) * width + (j + 1)] + 1
        : Math.max(dp[(i + 1) * width + j], dp[i * width + (j + 1)])
    }
  }
  const out = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ type: 'same', text: a[i] }); i += 1; j += 1 }
    else if (dp[(i + 1) * width + j] >= dp[i * width + (j + 1)]) { out.push({ type: 'del', text: a[i] }); i += 1 }
    else { out.push({ type: 'add', text: b[j] }); j += 1 }
  }
  while (i < n) { out.push({ type: 'del', text: a[i] }); i += 1 }
  while (j < m) { out.push({ type: 'add', text: b[j] }); j += 1 }
  return out
}

function inline(text, keyPrefix) {
  const nodes = []
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|!\[[^\]]*\]\([^)]+\)|\[[^\]]+\]\([^)]+\))/g
  let last = 0
  let match
  let index = 0
  while ((match = pattern.exec(text))) {
    if (match.index > last) nodes.push(text.slice(last, match.index))
    const token = match[0]
    const key = `${keyPrefix}-i${index}`
    index += 1
    if (token.startsWith('**')) nodes.push(h('strong', { key }, token.slice(2, -2)))
    else if (token.startsWith('`')) nodes.push(h('code', { key, className: 'skb-inline-code' }, token.slice(1, -1)))
    else if (token.startsWith('![')) {
      const alt = token.slice(2, token.indexOf(']'))
      const src = token.slice(token.indexOf('](') + 2, -1)
      nodes.push(h('img', { key, src, alt, style: { maxWidth: '100%', borderRadius: 8 } }))
    } else {
      const label = token.slice(1, token.indexOf(']'))
      const href = token.slice(token.indexOf('](') + 2, -1)
      nodes.push(h('a', { key, href, target: '_blank', rel: 'noreferrer' }, label))
    }
    last = match.index + token.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

function Markdown({ text }) {
  const lines = splitLines(text)
  const blocks = []
  let index = 0
  let key = 0
  while (index < lines.length) {
    const line = lines[index]
    if (/^```/.test(line)) {
      const buf = []
      index += 1
      while (index < lines.length && !/^```/.test(lines[index])) { buf.push(lines[index]); index += 1 }
      index += 1
      blocks.push(h('pre', { key: `b${key++}`, className: 'skb-code' }, h('code', null, buf.join('\n'))))
      continue
    }
    if (!line.trim()) { index += 1; continue }
    const head = /^(#{1,4})\s+(.*)$/.exec(line)
    if (head) {
      const level = Math.min(head[1].length + 1, 5)
      blocks.push(h(`h${level}`, { key: `b${key++}`, className: 'skb-h' }, ...inline(head[2], `k${key}`)))
      index += 1
      continue
    }
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line)
      const rows = []
      const task = []
      while (index < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[index])) {
        const raw = lines[index].replace(/^\s*([-*+]|\d+\.)\s+/, '')
        const check = /^\[( |x|X)\]\s*(.*)$/.exec(raw)
        if (check) task.push({ done: check[1].toLowerCase() === 'x', text: check[2] })
        else rows.push(raw)
        index += 1
      }
      if (rows.length) {
        const tag = ordered ? 'ol' : 'ul'
        blocks.push(h(tag, { key: `b${key++}` }, ...rows.map((row, i) => h('li', { key: i }, ...inline(row, `l${key}-${i}`)))))
      }
      if (task.length) {
        blocks.push(h('div', { key: `b${key++}`, className: 'skb-tasks' }, ...task.map((item, i) => h('div', {
          key: i, className: 'skb-task' + (item.done ? ' done' : ''),
        }, h('span', { className: 'skb-check' }, item.done ? '☑' : '☐'), h('span', null, ...inline(item.text, `t${key}-${i}`))))))
      }
      continue
    }
    if (/^>/.test(line)) {
      const buf = []
      while (index < lines.length && /^>/.test(lines[index])) { buf.push(lines[index].replace(/^>\s?/, '')); index += 1 }
      blocks.push(h('blockquote', { key: `b${key++}`, className: 'skb-quote' }, ...inline(buf.join(' '), `q${key}`)))
      continue
    }
    const buf = []
    while (index < lines.length && lines[index].trim() && !/^(#{1,4}\s|```|>|\s*([-*+]|\d+\.)\s)/.test(lines[index])) {
      buf.push(lines[index])
      index += 1
    }
    blocks.push(h('p', { key: `b${key++}` }, ...inline(buf.join(' '), `p${key}`)))
  }
  return h('div', { className: 'skb-markdown' }, ...blocks)
}

// ---------------------------------------------------------------- styles

// ---------------------------------------------------------------- 内建对话框
// Electron 等宿主不实现 window.prompt / window.confirm，且原生弹窗与页面风格不符，
// 所以这里自己做一套：ask() 返回 Promise，AskHost 渲染在页面根节点上。

let TT = (key) => key
let askPush = null

function ask(opts) {
  return new Promise((resolve) => {
    if (!askPush) { resolve(null); return }
    askPush({ ...opts, resolve })
  })
}

async function askConfirm(message, title) {
  const result = await ask({ title: title || TT('confirm'), message, confirmOnly: true })
  return result === true
}

function AskHost() {
  const [req, setReq] = React.useState(null)
  const [value, setValue] = React.useState('')
  React.useEffect(() => {
    askPush = (request) => { setReq(request); setValue(request.value || '') }
    return () => { askPush = null }
  }, [])
  if (!req) return null
  const finish = (result) => { const request = req; setReq(null); request.resolve(result) }
  const accept = () => finish(req.confirmOnly ? true : value)
  return h('div', {
    className: 'skb-mask',
    style: { zIndex: 90 },
    onMouseDown: (event) => { if (event.target === event.currentTarget) finish(req.confirmOnly ? false : null) },
  },
    h('div', { className: 'skb-modal', style: { width: 'min(460px,100%)' } },
      h('div', { className: 'skb-modal-head' }, h('h3', null, req.title || '')),
      h('div', { className: 'skb-modal-body' },
        req.message ? h('div', { style: { lineHeight: 1.75, marginBottom: 10 } }, req.message) : null,
        req.confirmOnly ? null : (req.multiline
          ? h('textarea', {
            className: 'skb-textarea', autoFocus: true, placeholder: req.placeholder || '', value,
            onChange: (event) => setValue(event.target.value),
          })
          : h('input', {
            className: 'skb-input', style: { width: '100%' }, autoFocus: true,
            placeholder: req.placeholder || '', value,
            onChange: (event) => setValue(event.target.value),
            onKeyDown: (event) => { if (event.key === 'Enter') accept() },
          })),
        req.note ? h('div', { style: { marginTop: 8, fontSize: 12, opacity: .72, lineHeight: 1.6 } }, req.note) : null,
      ),
      h('div', { className: 'skb-modal-foot' },
        h('button', { className: 'skb-btn', onClick: () => finish(req.confirmOnly ? false : null) }, TT('cancel')),
        h('button', { className: 'skb-btn primary', onClick: accept }, TT('confirm')),
      ),
    ),
  )
}

const CSS = `
/* 本插件自己的表面色：主题里的 --dsw-alias-bg-base 在自定义皮肤/壁纸下可能是 transparent，
   直接用会让页面和弹窗透出背景图，所以这里固定一层有实体感的表面色。 */
.skb-wrap{--skb-surface:var(--dsw-alias-bg-layer-1,#fff);--skb-surface-soft:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-layer-1,#f6f6f4));position:relative;height:100%;display:flex;flex-direction:column;min-height:0;background:var(--skb-surface,#fff);color:var(--dsw-alias-label-primary,#1a1a1a)}
.skb-page{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--skb-surface,#fff);color:var(--dsw-alias-label-primary,#1a1a1a)}
.skb-head{display:flex;align-items:center;gap:12px;padding:14px 20px;border-bottom:1px solid var(--dsw-alias-border-secondary,#e6e6e6)}
.skb-head h1{font-size:15px;font-weight:600;margin:0}
.skb-sub{font-size:12px;color:var(--dsw-alias-label-secondary,#666)}
.skb-head .skb-meta{margin-left:auto;display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary,#666);flex-wrap:wrap}
.skb-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-success,#2e9e5b);display:inline-block;margin-right:5px}
.skb-dot.off{background:var(--dsw-alias-label-secondary,#999)}
.skb-pill{display:inline-flex;align-items:center;gap:4px;height:24px;padding:0 9px;border-radius:999px;border:1px solid var(--dsw-alias-border-primary,#d9d9d9);background:var(--dsw-alias-bg-secondary,#f5f5f5);font-size:11.5px;cursor:pointer;color:inherit}
.skb-pill.hot{background:rgba(220,58,58,.12);border-color:rgba(220,58,58,.4);color:#c62828}
.skb-pill.info{background:rgba(31,111,235,.12);border-color:rgba(31,111,235,.35);color:var(--dsw-alias-state-info,#1f6feb)}
.skb-toolbar{display:flex;gap:8px;padding:10px 20px;align-items:center;flex-wrap:wrap}
.skb-input,.skb-select{height:32px;padding:0 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-primary,#d9d9d9);background:var(--skb-surface,#fff);color:inherit;font-size:13px;outline:none}
.skb-input{flex:1;min-width:160px}
.skb-input:focus,.skb-textarea:focus{border-color:var(--dsw-alias-state-info,#3b82f6)}
.skb-textarea{width:100%;min-height:70px;padding:8px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-primary,#d9d9d9);background:var(--skb-surface,#fff);color:inherit;font-size:13px;font-family:inherit;resize:vertical;outline:none}
.skb-textarea.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;min-height:220px}
.skb-btn{height:32px;padding:0 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-primary,#d9d9d9);background:var(--dsw-alias-bg-secondary,#f5f5f5);color:inherit;font-size:13px;cursor:pointer;white-space:nowrap}
.skb-btn:hover{background:var(--dsw-alias-bg-tertiary,#ececec)}
.skb-btn.primary{background:var(--dsw-alias-state-info,#1f6feb);border-color:transparent;color:#fff}
.skb-btn.danger{color:var(--dsw-alias-state-danger,#d33);border-color:var(--dsw-alias-state-danger,#d33)}
.skb-btn.small{height:26px;padding:0 8px;font-size:12px;border-radius:6px}
.skb-btn.ghost{background:transparent;border-color:transparent}
.skb-btn:disabled{opacity:.5;cursor:default}
.skb-body{flex:1;min-height:0;display:flex;border-top:1px solid var(--dsw-alias-border-secondary,#e6e6e6)}
.skb-side{width:380px;min-width:300px;max-width:46%;border-right:1px solid var(--dsw-alias-border-secondary,#e6e6e6);display:flex;flex-direction:column;min-height:0}
.skb-list{flex:1;overflow:auto;padding:8px}
.skb-item{display:flex;gap:8px;width:100%;text-align:left;padding:9px 10px;border-radius:8px;border:1px solid transparent;background:transparent;color:inherit;cursor:pointer;margin-bottom:3px}
.skb-item:hover{background:var(--dsw-alias-bg-secondary,#f5f5f5)}
.skb-item.active{background:var(--dsw-alias-bg-tertiary,#ececec);border-color:var(--dsw-alias-border-primary,#d9d9d9)}
.skb-item.req{opacity:.55}
.skb-item-main{flex:1;min-width:0}
.skb-item-title{font-size:13px;font-weight:550;line-height:1.4;margin-bottom:3px;word-break:break-word}
.skb-item-sub{font-size:11.5px;color:var(--dsw-alias-label-secondary,#777);display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.skb-star{color:#e0a000;font-size:12px;line-height:1.4}
.skb-star.dim{color:var(--dsw-alias-border-primary,#ccc)}
.skb-tag{display:inline-block;padding:1px 6px;border-radius:999px;background:var(--dsw-alias-bg-tertiary,#eee);font-size:11px;color:var(--dsw-alias-label-secondary,#666)}
.skb-cat{display:inline-block;padding:1px 7px;border-radius:6px;background:rgba(31,111,235,.12);color:var(--dsw-alias-state-info,#1f6feb);font-size:11px;margin-right:6px;white-space:nowrap}
.skb-priv{display:inline-block;padding:1px 7px;border-radius:6px;background:rgba(150,90,220,.14);color:#7c3aed;font-size:11px;margin-right:6px}
.skb-main{flex:1;min-width:0;overflow:auto;padding:20px 28px 40px}
.skb-doc-title{font-size:20px;font-weight:650;margin:4px 0 8px;line-height:1.35}
.skb-doc-meta{font-size:12px;color:var(--dsw-alias-label-secondary,#777);display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px;align-items:center}
.skb-actions{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 14px;padding-bottom:14px;border-bottom:1px solid var(--dsw-alias-border-secondary,#e6e6e6)}
.skb-markdown{font-size:13.5px;line-height:1.75}
.skb-markdown p{margin:0 0 10px}
.skb-h{margin:18px 0 8px;line-height:1.4}
.skb-markdown h1{font-size:20px}.skb-markdown h2{font-size:16px}.skb-markdown h3{font-size:14.5px}.skb-markdown h4{font-size:13.5px}
.skb-markdown ul,.skb-markdown ol{margin:0 0 10px;padding-left:22px}
.skb-code{background:var(--dsw-alias-bg-secondary,#f5f5f5);border-radius:8px;padding:10px 12px;overflow:auto;font-size:12.5px;margin:0 0 12px}
.skb-inline-code{background:var(--dsw-alias-bg-secondary,#f5f5f5);border-radius:4px;padding:1px 5px;font-size:12.5px}
.skb-quote{margin:0 0 12px;padding:4px 12px;border-left:3px solid var(--dsw-alias-border-primary,#d9d9d9);color:var(--dsw-alias-label-secondary,#666)}
.skb-tasks{margin:0 0 10px}
.skb-task{display:flex;gap:8px;font-size:13px;line-height:1.7}
.skb-task.done{opacity:.6;text-decoration:line-through}
.skb-empty{padding:40px 20px;text-align:center;font-size:13px;color:var(--dsw-alias-label-secondary,#777)}
.skb-tabs{display:flex;gap:4px;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-secondary,#e6e6e6);flex-wrap:wrap}
.skb-tabs button{height:26px;padding:0 10px;border-radius:999px;border:1px solid transparent;background:transparent;color:inherit;font-size:12px;cursor:pointer}
.skb-tabs button.active{background:var(--dsw-alias-bg-tertiary,#ececec);border-color:var(--dsw-alias-border-primary,#d9d9d9)}
.skb-tabs .skb-count{font-size:10.5px;opacity:.7;margin-left:3px}
.skb-hint{padding:28px;max-width:560px;margin:0 auto;font-size:13px;line-height:1.7;color:var(--dsw-alias-label-secondary,#666)}
.skb-hint h2{color:var(--dsw-alias-label-primary,#111);font-size:16px;margin:0 0 8px}
.skb-toast{position:sticky;bottom:10px;margin:0 20px 12px;padding:9px 12px;border-radius:8px;background:var(--dsw-alias-bg-tertiary,#ececec);font-size:12.5px;border:1px solid var(--dsw-alias-border-primary,#d9d9d9);white-space:pre-wrap}
.skb-toast.err{border-color:var(--dsw-alias-state-danger,#d33);color:var(--dsw-alias-state-danger,#d33)}
.skb-drop{position:absolute;inset:0;background:rgba(31,111,235,.08);border:2px dashed var(--dsw-alias-state-info,#1f6feb);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:14px;z-index:5;pointer-events:none}
.skb-form{display:grid;gap:8px;margin-top:14px}
.skb-label{font-size:12px;color:var(--dsw-alias-label-secondary,#666)}
.skb-check{display:flex;gap:7px;align-items:flex-start;font-size:12.5px;line-height:1.5;cursor:pointer}
.skb-check input{margin-top:3px}
.skb-code-box{display:flex;gap:8px;align-items:flex-start;margin-top:8px}
.skb-code-box textarea{flex:1;min-height:54px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;padding:8px;border-radius:8px;border:1px solid var(--dsw-alias-border-primary,#d9d9d9);background:var(--dsw-alias-bg-secondary,#f5f5f5);color:inherit;resize:vertical;word-break:break-all}
.skb-admin{padding:18px 24px;overflow:auto;flex:1}
.skb-admin h2{font-size:15px;margin:20px 0 10px}
.skb-admin h2:first-child{margin-top:0}
.skb-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px}
.skb-card{border:1px solid var(--dsw-alias-border-secondary,#e6e6e6);border-radius:10px;padding:10px 12px;font-size:12px;color:var(--dsw-alias-label-secondary,#666)}
.skb-card b{display:block;font-size:18px;color:var(--dsw-alias-label-primary,#111);margin-top:4px}
.skb-table{width:100%;border-collapse:collapse;font-size:12.5px}
.skb-table th,.skb-table td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--dsw-alias-border-secondary,#e6e6e6);vertical-align:top}
.skb-table th{color:var(--dsw-alias-label-secondary,#777);font-weight:500}
.skb-row-actions{display:flex;gap:6px;flex-wrap:wrap}
.skb-foot{padding:8px 20px;font-size:11.5px;color:var(--dsw-alias-label-secondary,#888);border-top:1px solid var(--dsw-alias-border-secondary,#e6e6e6)}
/* 重要资料横幅 */
.skb-banner{border-bottom:1px solid rgba(220,58,58,.25);background:rgba(220,58,58,.07);padding:8px 20px}
.skb-banner-head{display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:600;color:#c62828;margin-bottom:6px}
.skb-banner-item{display:flex;gap:10px;align-items:flex-start;padding:7px 10px;border-radius:8px;background:var(--skb-surface,#fff);border:1px solid rgba(220,58,58,.22);margin-bottom:6px}
.skb-banner-main{flex:1;min-width:0}
.skb-banner-title{font-size:13px;font-weight:600;cursor:pointer;word-break:break-word}
.skb-banner-title:hover{text-decoration:underline}
.skb-banner-rec{font-size:12px;color:var(--dsw-alias-label-secondary,#666);line-height:1.5;margin-top:2px;white-space:pre-wrap}
.skb-banner-actions{display:flex;gap:6px;align-items:center;flex-shrink:0}
/* 弹窗 */
.skb-mask{--skb-surface:var(--dsw-alias-bg-layer-1,#fff);--skb-surface-soft:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-layer-1,#f6f6f4));position:fixed;inset:0;background:rgba(0,0,0,.42);display:flex;align-items:center;justify-content:center;z-index:60;padding:24px}
.skb-modal{background:var(--skb-surface,#fff);color:inherit;border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.28);width:min(620px,100%);max-height:88vh;display:flex;flex-direction:column;overflow:hidden}
.skb-modal.wide{width:min(900px,100%)}
.skb-modal-head{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--dsw-alias-border-secondary,#e6e6e6)}
.skb-modal-head h3{margin:0;font-size:14.5px;font-weight:600}
.skb-modal-body{padding:16px 18px;overflow:auto;flex:1;min-height:0;font-size:13px}
.skb-modal-foot{padding:12px 18px;border-top:1px solid var(--dsw-alias-border-secondary,#e6e6e6);display:flex;gap:8px;justify-content:flex-end;align-items:center;flex-wrap:wrap}
.skb-x{margin-left:auto;border:none;background:transparent;color:inherit;font-size:18px;cursor:pointer;line-height:1;padding:2px 6px;opacity:.6}
.skb-x:hover{opacity:1}
/* 区块 */
.skb-section{margin-top:18px;padding-top:14px;border-top:1px solid var(--dsw-alias-border-secondary,#e6e6e6)}
.skb-section h4{margin:0 0 10px;font-size:13px;font-weight:600}
.skb-chips{display:flex;gap:6px;flex-wrap:wrap}
.skb-chip{font-size:11.5px;padding:2px 8px;border-radius:999px;background:var(--dsw-alias-bg-secondary,#f5f5f5);border:1px solid var(--dsw-alias-border-secondary,#e6e6e6);color:var(--dsw-alias-label-secondary,#666);cursor:pointer}
.skb-chip.on{background:rgba(31,111,235,.14);border-color:rgba(31,111,235,.4);color:var(--dsw-alias-state-info,#1f6feb)}
/* 评论 */
.skb-cmt{padding:9px 0;border-bottom:1px solid var(--dsw-alias-border-secondary,#f0f0f0)}
.skb-cmt-head{display:flex;gap:8px;font-size:11.5px;color:var(--dsw-alias-label-secondary,#777);margin-bottom:3px;align-items:center}
.skb-cmt-body{font-size:13px;line-height:1.6;white-space:pre-wrap;word-break:break-word}
.skb-cmt-body .skb-at{color:var(--dsw-alias-state-info,#1f6feb)}
/* 批量 */
.skb-batchbar{display:flex;align-items:center;gap:8px;padding:8px 20px;background:rgba(31,111,235,.08);border-bottom:1px solid rgba(31,111,235,.25);font-size:12.5px;flex-wrap:wrap}
.skb-cb{width:15px;height:15px;margin-top:2px;flex-shrink:0;cursor:pointer}
/* diff */
.skb-diff{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.6;border:1px solid var(--dsw-alias-border-secondary,#e6e6e6);border-radius:8px;overflow:auto;max-height:46vh}
.skb-diff div{padding:0 10px;white-space:pre-wrap;word-break:break-word}
.skb-diff .add{background:rgba(46,158,91,.14)}
.skb-diff .del{background:rgba(211,51,51,.13);text-decoration:line-through;opacity:.75}
.skb-diff .same{color:var(--dsw-alias-label-secondary,#777)}
.skb-vers{display:flex;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid var(--dsw-alias-border-secondary,#f0f0f0);font-size:12.5px;flex-wrap:wrap}
.skb-vers .v{font-weight:600;width:44px}
.skb-vers .t{color:var(--dsw-alias-label-secondary,#777);font-size:11.5px}
/* 收藏夹 */
.skb-col{display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:8px;cursor:pointer;font-size:12.5px}
.skb-col:hover{background:var(--dsw-alias-bg-secondary,#f5f5f5)}
.skb-col.active{background:var(--dsw-alias-bg-tertiary,#ececec)}
.skb-col .n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.skb-col .c{font-size:11px;color:var(--dsw-alias-label-secondary,#777)}
/* 上传结果 */
.skb-res{font-size:12.5px;line-height:1.7;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-bg-secondary,#f5f5f5);margin-bottom:8px}
.skb-res.err{background:rgba(211,51,51,.1);color:var(--dsw-alias-state-danger,#c33)}
.skb-res.ok{background:rgba(46,158,91,.1)}
.skb-bar{height:4px;border-radius:2px;background:var(--dsw-alias-border-secondary,#e6e6e6);overflow:hidden;margin-top:6px}
.skb-bar i{display:block;height:100%;background:var(--dsw-alias-state-info,#1f6feb)}
`

function makeT(ctx) {
  let t = null
  try {
    const locale = ctx.get('locale')
    if (locale) {
      try { locale.register('sharedKb', 'zh', ZH); locale.register('sharedKb', 'en', EN) } catch { /* already registered */ }
      t = locale.bind('sharedKb')
    }
  } catch { t = null }
  return (key, vars) => {
    let text = null
    if (t) {
      try { const value = t(key); if (value && value !== key) text = value } catch { /* fallthrough */ }
    }
    if (!text) {
      let active = 'zh'
      try { active = ctx.get('locale').getLocale().active } catch { /* ignore */ }
      text = (String(active).startsWith('zh') ? ZH : EN)[key] || key
    }
    return vars ? fill(text, vars) : text
  }
}

// ---------------------------------------------------------------- small parts

function Star({ on }) {
  return h('span', { className: 'skb-star' + (on ? '' : ' dim'), title: on ? '重要资料' : '' }, '★')
}

function Toast({ toast, onClose }) {
  if (!toast) return null
  return h('div', {
    className: 'skb-toast' + (toast.error ? ' err' : ''),
    onClick: onClose,
    style: { cursor: 'pointer' },
  }, toast.text)
}

function Modal({ title, onClose, children, footer, wide }) {
  return h('div', { className: 'skb-mask', onMouseDown: (e) => { if (e.target === e.currentTarget) onClose() } },
    h('div', { className: 'skb-modal' + (wide ? ' wide' : '') },
      h('div', { className: 'skb-modal-head' },
        h('h3', null, title),
        h('button', { className: 'skb-x', onClick: onClose, title: '关闭' }, '×'),
      ),
      h('div', { className: 'skb-modal-body' }, children),
      footer ? h('div', { className: 'skb-modal-foot' }, footer) : null,
    ),
  )
}

function emptyState(text) {
  return h('div', { className: 'skb-empty' }, text)
}

// ---------------------------------------------------------------- upload dialog

function UploadDialog({ t, collections, onClose, onDone }) {
  const [files, setFiles] = React.useState([])
  const [scope, setScope] = React.useState('public')
  const [pending, setPending] = React.useState(false)
  const [important, setImportant] = React.useState(false)
  const [recommend, setRecommend] = React.useState('')
  const [tags, setTags] = React.useState('')
  const [results, setResults] = React.useState([])
  const [busy, setBusy] = React.useState(false)
  const fileRef = React.useRef(null)
  const recLen = [...recommend.trim()].length
  const canSubmit = files.length > 0 && !busy && (!important || recLen >= 10)

  const submit = async () => {
    if (!canSubmit) return
    setBusy(true)
    const out = []
    for (const file of files) {
      setResults([...out, { name: file.name, status: 'up', pct: 0 }])
      try {
        const qs = new URLSearchParams({ name: file.name, title: file.name })
        if (tags.trim()) qs.set('tags', tags.trim())
        if (scope === 'private') qs.set('scope', 'private')
        if (pending) qs.set('pending', '1')
        if (important) { qs.set('important', '1'); qs.set('recommend', recommend.trim()) }
        const res = await fetch(`${API}/upload?${qs}`, { method: 'POST', body: file })
        const data = await res.json()
        if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`)
        out.push({
          name: file.name,
          status: 'ok',
          text: data.duplicate
            ? (data.doc ? `重复文件，已归档为《${data.doc.title}》` : '重复文件（还没整理）')
            : (data.doc ? `已入库：${data.doc.category} · ${data.doc.summary || data.doc.title}` : (data.pending ? '已存为待整理' : '已上传')),
          error: data.error || '',
          id: data.doc ? data.doc.id : '',
        })
      } catch (error) {
        out.push({ name: file.name, status: 'err', text: String((error && error.message) || error) })
      }
      setResults([...out])
    }
    setBusy(false)
    setFiles([])
    onDone()
  }

  return h(Modal, { title: t('uploadTitle'), onClose: busy ? () => {} : onClose },
    h('div', { className: 'skb-form' },
      h('div', { className: 'skb-label' }, t('uploadFiles')),
      h('input', {
        ref: fileRef, type: 'file', multiple: true,
        onChange: (e) => setFiles([...(e.target.files || [])]),
      }),
      files.length ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary,#666)' } },
        files.map((f) => f.name).join('、')) : null,

      h('div', { className: 'skb-label', style: { marginTop: 6 } }, t('scope')),
      h('div', { className: 'skb-chips' },
        h('button', {
          className: 'skb-chip' + (scope === 'public' ? ' on' : ''),
          onClick: () => setScope('public'),
        }, '☁ ' + t('scopePublic')),
        h('button', {
          className: 'skb-chip' + (scope === 'private' ? ' on' : ''),
          onClick: () => setScope('private'),
        }, '🔒 ' + t('scopePrivate')),
      ),
      scope === 'private' ? h('div', { style: { fontSize: 11.5, color: '#7c3aed' } }, t('privateHint')) : null,

      h('label', { className: 'skb-check' },
        h('input', { type: 'checkbox', checked: pending, onChange: (e) => setPending(e.target.checked) }),
        h('span', null, t('pendingUpload'), h('div', { style: { fontSize: 11.5, opacity: .75 } }, t('pendingHint'))),
      ),

      h('label', { className: 'skb-check' },
        h('input', { type: 'checkbox', checked: important, onChange: (e) => setImportant(e.target.checked) }),
        h('span', null, '★ ' + t('markImportant')),
      ),
      important ? h('div', null,
        h('div', { className: 'skb-label' }, `${t('recommend')}（${recLen}/10+）`),
        h('textarea', {
          className: 'skb-textarea',
          placeholder: t('recommendPlaceholder'),
          value: recommend,
          maxLength: 200,
          onChange: (e) => setRecommend(e.target.value),
        }),
        recLen > 0 && recLen < 10 ? h('div', { style: { color: 'var(--dsw-alias-state-danger,#d33)', fontSize: 11.5 } }, t('recommendTooShort')) : null,
      ) : null,

      h('div', { className: 'skb-label', style: { marginTop: 6 } }, t('tags') + '（可选）'),
      h('input', { className: 'skb-input', value: tags, onChange: (e) => setTags(e.target.value), placeholder: '合同, 2026' }),

      results.length ? h('div', { style: { marginTop: 10 } }, results.map((r, i) => h('div', {
        key: i, className: 'skb-res' + (r.status === 'err' ? ' err' : r.status === 'ok' ? ' ok' : ''),
      }, h('b', null, r.name), ' — ', r.status === 'up' ? t('uploading') : r.text,
        r.error ? h('div', { style: { fontSize: 11.5, opacity: .8 } }, r.error) : null))) : null,
    ),
    h('button', { className: 'skb-btn', onClick: onClose, disabled: busy }, t('close')),
    h('button', { className: 'skb-btn primary', onClick: submit, disabled: !canSubmit },
      busy ? t('uploading') : t('upload')),
  )
}

// ---------------------------------------------------------------- weekly dialog

function WeeklyDialog({ t, report, onClose, onSeen }) {
  const r = report || {}
  const cats = Object.entries(r.byCategory || {}).filter(([, n]) => n > 0)
  const authors = Object.entries(r.byAuthor || {}).sort((a, b) => b[1] - a[1])
  return h(Modal, { title: '📊 ' + t('weeklyTitle'), onClose },
    h('div', { className: 'skb-grid' },
      h('div', { className: 'skb-card' }, t('weeklyNew'), h('b', null, r.newCount || 0)),
      h('div', { className: 'skb-card' }, t('weeklyUpdated'), h('b', null, r.updatedCount || 0)),
      h('div', { className: 'skb-card' }, t('weeklyImportant'), h('b', null, r.importantCount || 0)),
      r.privateThisWeek ? h('div', { className: 'skb-card' }, t('weeklyPrivate'), h('b', null, r.privateThisWeek)) : null,
    ),
    cats.length ? h('div', { className: 'skb-section' },
      h('h4', null, t('weeklyCategories')),
      ...cats.map(([name, n]) => h('div', { key: name, style: { fontSize: 12.5, padding: '2px 0' } }, `${name} · ${n}`))) : null,
    authors.length ? h('div', { className: 'skb-section' },
      h('h4', null, t('weeklyAuthors')),
      ...authors.map(([name, n]) => h('div', { key: name, style: { fontSize: 12.5, padding: '2px 0' } }, `${name} · ${n}`))) : null,
    (r.importantDocs || []).length ? h('div', { className: 'skb-section' },
      h('h4', null, '★ ' + t('importantDoc')),
      ...r.importantDocs.map((d) => h('div', { key: d.id, style: { fontSize: 12.5, padding: '3px 0' } },
        h('b', null, d.title),
        h('div', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary,#666)' } }, d.recommend || ''),
      ))) : null,
    (r.newDocs || []).length ? h('div', { className: 'skb-section' },
      h('h4', null, t('weeklyNew')),
      ...r.newDocs.map((d) => h('div', { key: d.id, style: { fontSize: 12.5, padding: '2px 0' } },
        `${d.important ? '★ ' : ''}${d.title} · ${d.author || ''} · ${d.category || ''}`))) : null,
    h('div', { style: { marginTop: 12, fontSize: 11.5, color: 'var(--dsw-alias-label-secondary,#888)' } },
      `统计区间：${formatTime(r.since)} → 现在`),
    h('button', { className: 'skb-btn', onClick: onClose }, t('weeklyLater')),
    h('button', { className: 'skb-btn primary', onClick: onSeen }, t('weeklyMarkSeen')),
  )
}

// ---------------------------------------------------------------- comments

function Comments({ t, docId, status, onToast }) {
  const [items, setItems] = React.useState(null)
  const [text, setText] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  const load = async () => {
    try {
      const res = await fetch(`${API}/comments?id=${encodeURIComponent(docId)}`)
      const data = await res.json()
      setItems(data.items || [])
    } catch { setItems([]) }
  }
  React.useEffect(() => { load() }, [docId])

  const send = async () => {
    if (!text.trim() || busy) return
    setBusy(true)
    try {
      const res = await fetch(`${API}/comments`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: docId, text: text.trim() }),
      })
      const data = await res.json()
      if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`)
      setText('')
      await load()
    } catch (error) { onToast(true, String((error && error.message) || error)) }
    setBusy(false)
  }

  const remove = async (commentId) => {
    if (!await askConfirm('删除这条评论？')) return
    try {
      const res = await fetch(`${API}/comments/delete`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: docId, commentId }),
      })
      const data = await res.json()
      if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`)
      await load()
      onToast(false, t('commentDeleted'))
    } catch (error) { onToast(true, String((error && error.message) || error)) }
  }

  const me = (status && status.member && status.member.name) || ''
  const isAdmin = status && status.member && status.member.role === 'admin'

  return h('div', { className: 'skb-section' },
    h('h4', null, `${t('comments')}${items ? `（${items.length}）` : ''}`),
    !items || !items.length ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary,#777)' } }, t('commentEmpty'))
      : items.map((c) => h('div', { key: c.id, className: 'skb-cmt' },
        h('div', { className: 'skb-cmt-head' },
          h('b', null, c.author),
          h('span', null, formatTime(c.at)),
          (isAdmin || c.author === me) ? h('button', {
            className: 'skb-btn ghost small', style: { marginLeft: 'auto' }, onClick: () => remove(c.id),
          }, '×') : null,
        ),
        h('div', { className: 'skb-cmt-body' }, ...inline(c.text, c.id)),
      )),
    h('div', { style: { display: 'flex', gap: 8, marginTop: 10, alignItems: 'flex-start' } },
      h('textarea', {
        className: 'skb-textarea', style: { minHeight: 54 },
        placeholder: t('commentPlaceholder'), value: text,
        onChange: (e) => setText(e.target.value),
        onKeyDown: (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send() },
      }),
      h('button', { className: 'skb-btn primary', onClick: send, disabled: busy || !text.trim() }, t('post')),
    ),
    h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary,#888)', marginTop: 4 } },
      'Ctrl/⌘ + Enter 发送；@成员名 会提醒对方'),
  )
}

// ---------------------------------------------------------------- history

function HistoryPanel({ t, docId, onToast, onRestored }) {
  const [data, setData] = React.useState(null)
  const [diff, setDiff] = React.useState(null)

  const load = async () => {
    try {
      const res = await fetch(`${API}/history?id=${encodeURIComponent(docId)}`)
      const body = await res.json()
      if (!res.ok || body.ok === false) throw new Error(body.error || `HTTP ${res.status}`)
      setData(body)
    } catch (error) { onToast(true, String((error && error.message) || error)) }
  }
  React.useEffect(() => { load() }, [docId])

  const restore = async (version) => {
    if (!await askConfirm(t('restoreConfirm'))) return
    try {
      const res = await fetch(`${API}/restore`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: docId, version }),
      })
      const body = await res.json()
      if (!res.ok || body.ok === false) throw new Error(body.error || `HTTP ${res.status}`)
      onToast(false, t('restored'))
      await load()
      onRestored()
    } catch (error) { onToast(true, String((error && error.message) || error)) }
  }

  if (!data) return h('div', { className: 'skb-section' }, h('h4', null, t('history')), h('div', { style: { fontSize: 12 } }, t('loading')))

  const versions = data.versions || []
  return h('div', { className: 'skb-section' },
    h('h4', null, `${t('history')}（${versions.length}）`),
    h('div', { className: 'skb-vers' },
      h('span', { className: 'v' }, `v${(data.current && data.current.version) || 1}`),
      h('span', null, t('current')),
      h('span', { className: 't' }, formatTime(data.current && data.current.updatedAt)),
    ),
    !versions.length ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary,#777)' } }, t('historyEmpty'))
      : versions.map((v) => h('div', { key: v.version, className: 'skb-vers' },
        h('span', { className: 'v' }, `v${v.version}`),
        h('span', { className: 't' }, `${formatTime(v.updatedAt)} · ${v.author || ''} · ${fmtBytes(v.bytes)}`),
        h('button', { className: 'skb-btn small', onClick: () => setDiff({ v, lines: diffLines(v.markdown, data.current.markdown) }) }, t('compare')),
        h('button', { className: 'skb-btn small', onClick: () => restore(v.version) }, t('restore')),
      )),
    diff ? h('div', { style: { marginTop: 10 } },
      h('div', { style: { fontSize: 12, marginBottom: 6, display: 'flex', gap: 10, alignItems: 'center' } },
        h('b', null, `v${diff.v.version} → ${t('current')}`),
        h('span', { style: { color: '#2e9e5b' } }, `+${diff.lines.filter((l) => l.type === 'add').length}`),
        h('span', { style: { color: '#d33' } }, `-${diff.lines.filter((l) => l.type === 'del').length}`),
        h('button', { className: 'skb-btn small', onClick: () => setDiff(null) }, t('close')),
      ),
      h('div', { className: 'skb-diff' }, ...diff.lines.map((line, i) => h('div', { key: i, className: line.type },
        `${line.type === 'add' ? '+ ' : line.type === 'del' ? '- ' : '  '}${line.text}`))),
    ) : null,
  )
}

// ---------------------------------------------------------------- collections picker

function CollectMenu({ t, doc, collections, onToast, onChanged }) {
  const [open, setOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  if (!doc) return null
  const mine = new Set(doc.inCollections || [])

  const toggle = async (col) => {
    setBusy(true)
    try {
      const action = mine.has(col.id) ? 'remove-doc' : 'add'
      const res = await fetch(`${API}/collections`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, collectionId: col.id, ids: [doc.id] }),
      })
      const data = await res.json()
      if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`)
      await onChanged()
    } catch (error) { onToast(true, String((error && error.message) || error)) }
    setBusy(false)
  }

  const create = async () => {
    const name = await ask({ title: t('collectionName') })
    if (!name || !name.trim()) return
    try {
      const res = await fetch(`${API}/collections`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'create', name: name.trim() }),
      })
      const data = await res.json()
      if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`)
      await onChanged()
      setOpen(true)
    } catch (error) { onToast(true, String((error && error.message) || error)) }
  }

  return h('span', { style: { position: 'relative', display: 'inline-block' } },
    h('button', { className: 'skb-btn small', onClick: () => setOpen(!open), disabled: busy },
      mine.size ? `★ ${t('collected')}（${mine.size}）` : '☆ ' + t('collect')),
    open ? h('div', {
      style: {
        position: 'absolute', top: 30, left: 0, zIndex: 30, minWidth: 200,
        background: 'var(--skb-surface,#fff)', border: '1px solid var(--dsw-alias-border-primary,#d9d9d9)',
        borderRadius: 10, boxShadow: '0 10px 30px rgba(0,0,0,.16)', padding: 6,
      },
    },
      !collections.length ? h('div', { style: { fontSize: 12, padding: '6px 8px', color: 'var(--dsw-alias-label-secondary,#777)' } }, t('collectionEmpty')) : null,
      collections.map((col) => h('div', {
        key: col.id, className: 'skb-col', onClick: () => toggle(col),
      },
        h('span', null, mine.has(col.id) ? '☑' : '☐'),
        h('span', { className: 'n' }, col.name),
        h('span', { className: 'c' }, col.count),
      )),
      h('div', { style: { borderTop: '1px solid var(--dsw-alias-border-secondary,#e6e6e6)', marginTop: 4, paddingTop: 4 } },
        h('div', { className: 'skb-col', onClick: create }, '＋ ' + t('newCollection'))),
    ) : null,
  )
}

// ---------------------------------------------------------------- doc view

function DocView({ t, doc, status, collections, onToast, onRefresh, onOpenDoc }) {
  const [editing, setEditing] = React.useState(false)
  const [form, setForm] = React.useState(null)
  const [busy, setBusy] = React.useState(false)
  const [conflict, setConflict] = React.useState(null)
  const [panels, setPanels] = React.useState({ comments: false, history: false })
  const isAdmin = status && status.member && status.member.role === 'admin'
  const me = status && status.member && status.member.name
  const isPrivate = String(doc.id).startsWith('priv_')

  React.useEffect(() => {
    setEditing(false)
    setConflict(null)
    setForm(null)
    setPanels({ comments: false, history: false })
  }, [doc.id])

  const canEdit = !isPrivate
  const canDelete = isAdmin || doc.author === me || isPrivate

  const startEdit = () => {
    setForm({
      title: doc.title || '',
      summary: doc.summary || '',
      tags: (doc.tags || []).join(', '),
      points: (doc.points || []).join('\n'),
      markdown: doc.markdown || '',
    })
    setEditing(true)
  }

  const commit = async (payload) => {
    setBusy(true)
    try {
      const res = await fetch(`${API}/commit`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (res.status === 409 && data.conflict) {
        setConflict({ latest: data.latest, payload })
        setBusy(false)
        return
      }
      if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`)
      setEditing(false)
      setConflict(null)
      onToast(false, t('saved'))
      await onRefresh(doc.id)
    } catch (error) { onToast(true, String((error && error.message) || error)) }
    setBusy(false)
  }

  const saveEdit = () => {
    if (!form) return
    return commit({
      id: doc.id,
      title: form.title,
      summary: form.summary,
      tags: form.tags.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
      points: splitLines(form.points).map((s) => s.trim()).filter(Boolean),
      markdown: form.markdown,
      category: doc.category,
      baseVersion: doc.version,
    })
  }

  const changeCategory = (category) => commit({ id: doc.id, category, baseVersion: doc.version })

  const markImportant = async () => {
    if (doc.important) {
      if (!await askConfirm('取消这篇的重要标记？（会从所有人的置顶提醒里移除）')) return
      return commit({ id: doc.id, important: false, baseVersion: doc.version })
    }
    const recommend = await ask({ title: t('recommend'), multiline: true, note: t('recommendPlaceholder') })
    if (recommend === null) return
    if ([...recommend.trim()].length < 10) { onToast(true, t('recommendTooShort')); return }
    return commit({ id: doc.id, important: true, recommend: recommend.trim(), baseVersion: doc.version })
  }

  const remove = async () => {
    if (!await askConfirm(t('confirmDelete'))) return
    try {
      const res = await fetch(`${API}/delete`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: doc.id }),
      })
      const data = await res.json()
      if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`)
      onToast(false, t('deleted'))
      await onRefresh('')
    } catch (error) { onToast(true, String((error && error.message) || error)) }
  }

  const ack = async () => {
    try {
      const res = await fetch(`${API}/important/ack`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: doc.id }),
      })
      const data = await res.json()
      if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`)
      onToast(false, t('acked'))
      await onRefresh(doc.id)
    } catch (error) { onToast(true, String((error && error.message) || error)) }
  }

  return h('div', null,
    h('div', { className: 'skb-doc-meta' },
      h('span', null, h('span', { className: isPrivate ? 'skb-priv' : 'skb-cat' }, isPrivate ? '🔒 ' + t('private') : doc.category)),
      doc.important && !isPrivate ? h('span', { style: { color: '#c62828' } }, '★ ' + t('importantDoc')) : null,
      doc.author ? h('span', null, `${t('author')}：${doc.author}`) : null,
      h('span', null, `${t('updated')}：${formatTime(doc.updatedAt)}`),
      h('span', null, `${t('version')} v${doc.version || 1}`),
      doc.confidence ? h('span', null, `${t('confidence')}：${doc.confidence}`) : null,
      doc.bytes ? h('span', null, fmtBytes(doc.bytes)) : null,
    ),

    doc.summary ? h('div', { style: { fontSize: 13, color: 'var(--dsw-alias-label-secondary,#666)', marginBottom: 8 } }, doc.summary) : null,

    doc.important && doc.recommend ? h('div', {
      style: {
        margin: '0 0 14px', padding: '10px 12px', borderRadius: 10,
        background: 'rgba(220,58,58,.07)', border: '1px solid rgba(220,58,58,.25)',
      },
    },
      h('div', { style: { fontSize: 11.5, color: '#c62828', fontWeight: 600, marginBottom: 3 } },
        `★ ${fill(t('recommendBy'), { by: doc.importantBy || '同事' })}`),
      h('div', { style: { fontSize: 12.5, lineHeight: 1.6, whiteSpace: 'pre-wrap' } }, doc.recommend),
    ) : null,

    h('div', { className: 'skb-actions' },
      canEdit ? h('button', { className: 'skb-btn small', onClick: editing ? () => { setEditing(false); setForm(null) } : startEdit },
        editing ? t('cancelEdit') : '✎ ' + t('editDoc')) : null,
      editing ? h('button', { className: 'skb-btn small primary', onClick: saveEdit, disabled: busy }, t('save')) : null,
      canEdit ? h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
        h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary,#666)' } }, t('category') + '：'),
        h('select', {
          className: 'skb-select', style: { height: 26, fontSize: 12 },
          value: doc.category, disabled: busy,
          onChange: (e) => changeCategory(e.target.value),
        }, ...(status && status.categories ? status.categories : []).map((c) => h('option', { key: c, value: c }, c))),
      ) : null,
      !isPrivate ? h('button', { className: 'skb-btn small', onClick: markImportant, disabled: busy },
        doc.important ? '☆ ' + t('unmarkImportant') : '★ ' + t('markImportant')) : null,
      !isPrivate ? h(CollectMenu, { t, doc, collections, onToast, onChanged: () => onRefresh(doc.id) }) : null,
      h('button', { className: 'skb-btn small', onClick: () => setPanels({ ...panels, comments: !panels.comments }) },
        `💬 ${t('comments')}${doc.comments ? `（${doc.comments}）` : ''}`),
      h('button', { className: 'skb-btn small', onClick: () => setPanels({ ...panels, history: !panels.history }) },
        '🕘 ' + t('history')),
      doc.rawId ? h('a', {
        className: 'skb-btn small', style: { lineHeight: '26px', textDecoration: 'none' },
        href: isPrivate ? `${API}/private/raw?id=${encodeURIComponent(doc.rawId)}` : `${API}/raw?id=${encodeURIComponent(doc.rawId)}&name=${encodeURIComponent(doc.rawName || 'raw')}`,
        target: '_blank', rel: 'noreferrer',
      }, '📎 ' + t('openRaw')) : null,
      doc.important && !doc.acked ? h('button', {
        className: 'skb-btn small', onClick: ack, disabled: !doc.read,
        title: doc.read ? '' : t('ackNeedRead'),
      }, '🔔 ' + t('ackImportant') + (doc.read ? '' : '（' + t('goRead') + '）')) : null,
      canDelete ? h('button', { className: 'skb-btn small danger', onClick: remove }, t('delete')) : null,
    ),

    editing && form ? h('div', { className: 'skb-form', style: { marginBottom: 16 } },
      h('div', { className: 'skb-label' }, t('titleField')),
      h('input', { className: 'skb-input', value: form.title, onChange: (e) => setForm({ ...form, title: e.target.value }) }),
      h('div', { className: 'skb-label' }, t('summaryField')),
      h('input', { className: 'skb-input', value: form.summary, maxLength: 20, onChange: (e) => setForm({ ...form, summary: e.target.value }) }),
      h('div', { className: 'skb-label' }, t('tagsField')),
      h('input', { className: 'skb-input', value: form.tags, onChange: (e) => setForm({ ...form, tags: e.target.value }) }),
      h('div', { className: 'skb-label' }, t('pointsField')),
      h('textarea', { className: 'skb-textarea', style: { minHeight: 70 }, value: form.points, onChange: (e) => setForm({ ...form, points: e.target.value }) }),
      h('div', { className: 'skb-label' }, t('markdownField')),
      h('textarea', { className: 'skb-textarea mono', value: form.markdown, onChange: (e) => setForm({ ...form, markdown: e.target.value }) }),
    ) : null,

    conflict ? h('div', {
      style: { margin: '0 0 16px', padding: '10px 12px', borderRadius: 10, background: 'rgba(220,150,0,.1)', border: '1px solid rgba(220,150,0,.35)' },
    },
      h('b', null, '⚠ ' + t('conflict')),
      h('div', { style: { fontSize: 12.5, margin: '4px 0 8px' } }, t('conflictHint')),
      h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
        h('button', {
          className: 'skb-btn small', onClick: async () => {
            if (conflict.latest && conflict.latest.id) await onRefresh(conflict.latest.id)
            setConflict(null)
          },
        }, t('viewLatest')),
        h('button', {
          className: 'skb-btn small danger', onClick: () => commit({ ...conflict.payload, baseVersion: conflict.latest ? conflict.latest.version : undefined }),
        }, t('overwrite')),
        h('button', { className: 'skb-btn small', onClick: () => setConflict(null) }, t('cancel')),
      ),
    ) : null,

    !editing ? h(Markdown, { text: doc.markdown || '' }) : null,

    (doc.points || []).length && !editing ? h('div', { className: 'skb-section' },
      h('h4', null, t('points')),
      ...doc.points.map((p, i) => h('div', { key: i, style: { fontSize: 12.5, padding: '2px 0' } }, '· ' + p))) : null,

    (doc.tags || []).length ? h('div', { style: { marginTop: 14, display: 'flex', gap: 6, flexWrap: 'wrap' } },
      ...doc.tags.map((tag) => h('span', { key: tag, className: 'skb-tag' }, tag))) : null,

    panels.comments ? h(Comments, { t, docId: doc.id, status, onToast }) : null,
    panels.history && !isPrivate ? h(HistoryPanel, { t, docId: doc.id, onToast, onRestored: () => onRefresh(doc.id) }) : null,
  )
}

// ---------------------------------------------------------------- admin

function Admin({ t, status, onBack, toast, setToast }) {
  const [stats, setStats] = React.useState(null)
  const [members, setMembers] = React.useState([])
  const [docs, setDocs] = React.useState([])
  const [raws, setRaws] = React.useState([])
  const [audit, setAudit] = React.useState([])
  const [invite, setInvite] = React.useState('')
  const [reason, setReason] = React.useState('')

  const post = async (pathname, body) => {
    const res = await fetch(`${API}${pathname}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`)
    return data
  }

  const load = async () => {
    try {
      const [s, m, d, r, a] = await Promise.all([
        fetch(`${API}/stats`).then((x) => x.json()),
        fetch(`${API}/members`).then((x) => x.json()),
        fetch(`${API}/list?limit=500&scope=all`).then((x) => x.json()),
        fetch(`${API}/inbox?status=all`).then((x) => x.json()),
        fetch(`${API}/audit?limit=60`).then((x) => x.json()),
      ])
      if (s.ok) setStats(s)
      if (m.ok) setMembers(m.items || [])
      if (d.ok) setDocs(d.items || [])
      if (r.ok) setRaws(r.items || [])
      if (a.ok) setAudit(a.items || [])
    } catch (error) { setToast({ error: true, text: String((error && error.message) || error) }) }
  }
  React.useEffect(() => { load() }, [])

  return h('div', { className: 'skb-page' },
    h('div', { className: 'skb-head' },
      h('button', { className: 'skb-btn', onClick: onBack }, '← ' + t('back')),
      h('h1', null, t('admin')),
      h('div', { className: 'skb-meta' }, h('span', null, status && status.name), h('span', null, `v${(status && status.version) || ''}`)),
    ),
    h('div', { className: 'skb-admin' },
      h('h2', null, t('stats')),
      h('div', { className: 'skb-grid' },
        h('div', { className: 'skb-card' }, t('docs'), h('b', null, (stats && stats.docs) || 0)),
        h('div', { className: 'skb-card' }, t('important'), h('b', null, (stats && stats.important) || 0)),
        h('div', { className: 'skb-card' }, t('comments'), h('b', null, (stats && stats.comments) || 0)),
        h('div', { className: 'skb-card' }, t('inbox'), h('b', null, (stats && stats.inbox) || 0)),
        h('div', { className: 'skb-card' }, t('members'), h('b', null, (stats && stats.members) || 0)),
        h('div', { className: 'skb-card' }, '文档体积', h('b', null, fmtBytes(stats && stats.docBytes))),
        h('div', { className: 'skb-card' }, '素材体积', h('b', null, fmtBytes(stats && stats.rawBytes))),
      ),
      h('h2', null, t('weeklyCategories')),
      h('div', { style: { fontSize: 12.5, lineHeight: 1.8 } },
        Object.entries((stats && stats.byCategory) || {}).map(([name, n]) => `${name} ${n}`).join(' · ')),

      h('h2', null, t('members')),
      h('div', { className: 'skb-form', style: { maxWidth: 420, marginBottom: 12 } },
        h('button', {
          className: 'skb-btn primary', onClick: async () => {
            const name = await ask({ title: '新成员名字' })
            if (!name || !name.trim()) return
            try {
              const data = await post('/members', { name: name.trim(), role: 'member' })
              setInvite(data.inviteCode || '')
              await load()
              setToast(null)
            } catch (error) { setToast({ error: true, text: String((error && error.message) || error) }) }
          },
        }, '＋ 添加成员'),
        invite ? h('div', { className: 'skb-code-box' },
          h('textarea', { readOnly: true, value: invite }),
          h('button', {
            className: 'skb-btn', onClick: () => {
              try { navigator.clipboard.writeText(invite) } catch { /* ignore */ }
              setToast({ text: t('copied') })
            },
          }, t('copy')),
        ) : null,
      ),
      h('table', { className: 'skb-table' },
        h('thead', null, h('tr', null, h('th', null, '名字'), h('th', null, '角色'), h('th', null, '令牌'), h('th', null, ''))),
        h('tbody', null, members.map((m) => h('tr', { key: m.name },
          h('td', null, m.name),
          h('td', null, m.role),
          h('td', { style: { fontFamily: 'ui-monospace,monospace', fontSize: 11 } }, m.token ? `${m.token.slice(0, 6)}…${m.token.slice(-4)}` : '—'),
          h('td', null, h('div', { className: 'skb-row-actions' },
            h('button', {
              className: 'skb-btn small', onClick: async () => {
                if (!await askConfirm(`重置 ${m.name} 的令牌？旧令牌立即失效。`)) return
                try { const data = await post('/members/rotate', { name: m.name }); setInvite(data.inviteCode || ''); await load() } catch (error) { setToast({ error: true, text: String((error && error.message) || error) }) }
              },
            }, '换令牌'),
            m.name === (status && status.member && status.member.name) ? null : h('button', {
              className: 'skb-btn small danger', onClick: async () => {
                if (!await askConfirm(`移除成员 ${m.name}？`)) return
                try { await post('/members/remove', { name: m.name }); await load() } catch (error) { setToast({ error: true, text: String((error && error.message) || error) }) }
              },
            }, '移除'),
          )),
        ))),
      ),

      h('h2', null, `${t('docsTable')}（${docs.length}）`),
      docs.length ? h('table', { className: 'skb-table' },
        h('thead', null, h('tr', null, h('th', null, '标题'), h('th', null, t('category')), h('th', null, t('author')), h('th', null, t('important')), h('th', null, ''))),
        h('tbody', null, docs.map((d) => h('tr', { key: d.id },
          h('td', null, (d.important ? '★ ' : '') + d.title, String(d.id).startsWith('priv_') ? h('span', { className: 'skb-priv' }, t('private')) : null),
          h('td', null, d.category), h('td', null, d.author || ''),
          h('td', null, d.important ? '是' : ''),
          h('td', null, h('button', {
            className: 'skb-btn small danger', onClick: async () => {
              if (!await askConfirm(t('confirmDelete'))) return
              try { await post('/delete', { id: d.id }); await load() } catch (error) { setToast({ error: true, text: String((error && error.message) || error) }) }
            },
          }, t('delete'))),
        ))),
      ) : h('div', { className: 'skb-empty' }, t('noData')),

      h('h2', null, `${t('rawList')}（${raws.length}）`),
      h('div', { className: 'skb-form', style: { maxWidth: 420 } },
        h('input', { className: 'skb-input', placeholder: t('skipReason'), value: reason, onChange: (e) => setReason(e.target.value) }),
      ),
      raws.length ? h('table', { className: 'skb-table' },
        h('thead', null, h('tr', null, h('th', null, '文件'), h('th', null, t('status')), h('th', null, t('author')), h('th', null, ''))),
        h('tbody', null, raws.map((r) => h('tr', { key: r.id },
          h('td', null, r.name),
          h('td', null, r.status === 'archived' ? '已成文' : r.status === 'skipped' ? '已跳过' : '待整理'),
          h('td', null, r.author),
          h('td', null, h('div', { className: 'skb-row-actions' },
            r.status === 'new' ? h('button', {
              className: 'skb-btn small', onClick: async () => {
                try { await post('/normalize', { id: r.id }); await load() } catch (error) { setToast({ error: true, text: String((error && error.message) || error) }) }
              },
            }, 'AI ' + t('normalize')) : null,
            r.status === 'new' ? h('button', {
              className: 'skb-btn small', onClick: async () => {
                try { await post('/raw/skip', { id: r.id, reason }); await load() } catch (error) { setToast({ error: true, text: String((error && error.message) || error) }) }
              },
            }, t('skip')) : null,
            h('button', {
              className: 'skb-btn small danger', onClick: async () => {
                if (!await askConfirm(t('deleteRaw') + '？')) return
                try { await post('/raw/delete', { id: r.id }); await load() } catch (error) { setToast({ error: true, text: String((error && error.message) || error) }) }
              },
            }, t('deleteRaw')),
          )),
        ))),
      ) : h('div', { className: 'skb-empty' }, t('noData')),

      h('h2', null, t('audit')),
      audit.length ? h('div', { style: { fontSize: 12, fontFamily: 'ui-monospace,monospace', lineHeight: 1.7 } },
        audit.map((a, i) => h('div', { key: i }, `${formatTime(a.at)} · ${a.actor || ''} · ${a.action || ''} · ${JSON.stringify(a.detail || {})}`)),
      ) : h('div', { className: 'skb-empty' }, t('noData')),

      toast ? h('div', { className: 'skb-toast' + (toast.error ? ' err' : '') }, toast.text) : null,
    ),
  )
}

// ---------------------------------------------------------------- page

function Page({ t }) {
  const [status, setStatus] = React.useState(null)
  const [items, setItems] = React.useState([])
  const [authors, setAuthors] = React.useState([])
  const [total, setTotal] = React.useState(0)
  const [query, setQuery] = React.useState('')
  const [searched, setSearched] = React.useState(false)
  const [category, setCategory] = React.useState('')
  const [author, setAuthor] = React.useState('')
  const [important, setImportant] = React.useState('')
  const [scope, setScope] = React.useState('all')
  const [sort, setSort] = React.useState('updated')
  const [tab, setTab] = React.useState('docs')
  const [doc, setDoc] = React.useState(null)
  const [inbox, setInbox] = React.useState([])
  const [collections, setCollections] = React.useState([])
  const [collection, setCollection] = React.useState('')
  const [importantList, setImportantList] = React.useState([])
  const [mentions, setMentions] = React.useState([])
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [toast, setToast] = React.useState(null)
  const [dragging, setDragging] = React.useState(false)
  const [setup, setSetup] = React.useState(false)
  const [invite, setInvite] = React.useState('')
  const [manual, setManual] = React.useState(false)
  const [form, setForm] = React.useState({ hubUrl: '', token: '', member: '' })
  const [view, setView] = React.useState('kb')
  const [uploadOpen, setUploadOpen] = React.useState(false)
  const [weekly, setWeekly] = React.useState(null)
  const [batch, setBatch] = React.useState(false)
  const [picked, setPicked] = React.useState([])
  const [fatal, setFatal] = React.useState('')
  const [normalizing, setNormalizing] = React.useState('')
  const dragDepth = React.useRef(0)
  const weeklyShown = React.useRef(false)

  const fail = (prefix, error) => setToast({ error: true, text: prefix + String((error && error.message) || error) })
  const toastMsg = (isError, text) => setToast({ error: Boolean(isError), text })

  const call = async (pathname, init) => {
    const res = await fetch(`${API}${pathname}`, init)
    const type = res.headers.get('content-type') || ''
    if (!type.includes('application/json')) {
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res
    }
    const data = await res.json()
    if (!res.ok || data.ok === false) {
      const error = new Error(data.error || `HTTP ${res.status}`)
      error.data = data
      error.status = res.status
      throw error
    }
    return data
  }
  const postJson = (pathname, body) => call(pathname, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })

  const loadStatus = async () => {
    try {
      const data = await call('/status')
      setStatus(data)
      if (data && data.tokenConfigured === false) setSetup(true)
      return data
    } catch (error) {
      setFatal(String((error && error.message) || error))
      setSetup(true)
      return null
    }
  }

  const loadList = async (override = {}) => {
    const state = { category, author, important, scope, sort, collection, ...override }
    const qs = new URLSearchParams({ limit: '300', scope: state.scope || 'all' })
    if (state.category) qs.set('category', state.category)
    if (state.author) qs.set('author', state.author)
    if (state.important) qs.set('important', state.important)
    if (state.sort) qs.set('sort', state.sort)
    if (state.collection) qs.set('collection', state.collection)
    const data = await call(`/list?${qs}`)
    setItems(data.items || [])
    setAuthors(data.authors || [])
    setTotal(data.total || 0)
  }

  const loadInbox = async () => {
    try {
      const data = await call('/inbox?status=new')
      setInbox(data.items || [])
    } catch { setInbox([]) }
  }

  const loadCollections = async () => {
    try { const data = await call('/collections'); setCollections(data.items || []) } catch { setCollections([]) }
  }

  const loadImportant = async () => {
    try { const data = await call('/important'); setImportantList(data.items || []) } catch { setImportantList([]) }
  }

  const loadMentions = async () => {
    try { const data = await call('/mentions'); setMentions(data.items || []) } catch { setMentions([]) }
  }

  const reloadAll = async () => {
    try {
      await loadStatus()
      await Promise.all([loadList(), loadInbox(), loadCollections(), loadImportant(), loadMentions()])
    } catch (error) {
      fail('', error)
    }
  }

  React.useEffect(() => {
    let alive = true
    ;(async () => {
      setLoading(true)
      try {
        const data = await loadStatus()
        if (data && alive) {
          await Promise.all([loadList(), loadInbox(), loadCollections(), loadImportant(), loadMentions()])
        }
      } catch (error) {
        if (alive) fail('', error)
      }
      if (alive) setLoading(false)
    })()
    return () => { alive = false }
  }, [])

  // 周报：每次打开页面最多弹一次
  React.useEffect(() => {
    if (!status || !status.weeklyDue || weeklyShown.current) return
    weeklyShown.current = true
    ;(async () => {
      try {
        const data = await call('/weekly')
        setWeekly(data.report)
      } catch { /* 静默 */ }
    })()
  }, [status])

  const openDoc = async (id) => {
    if (!id) { setDoc(null); return }
    setBusy(true)
    try {
      const data = await call(`/doc/open?id=${encodeURIComponent(id)}`)
      setDoc(data.doc)
      if (data.marked) {
        // 刚记成已读：刷新重要提醒状态，但不要让横幅马上消失（用户还没点取消置顶）
        const fresh = await call('/important')
        setImportantList(fresh.items || [])
      }
    } catch (error) { fail('', error) }
    setBusy(false)
  }

  const refreshDoc = async (id) => {
    try {
      await Promise.all([loadList(), loadImportant(), loadCollections()])
      if (id) {
        const data = await call(`/doc?id=${encodeURIComponent(id)}`)
        setDoc(data.doc)
      } else {
        setDoc(null)
      }
    } catch (error) { fail('', error) }
  }

  const doSearch = async (value) => {
    const text = value === undefined ? query : value
    if (!text.trim()) {
      setSearched(false)
      await loadList()
      return
    }
    setBusy(true)
    try {
      const data = await call(`/search?q=${encodeURIComponent(text)}&limit=50${category ? `&category=${encodeURIComponent(category)}` : ''}`)
      setItems(data.items || [])
      setTotal(data.total || 0)
      setSearched(true)
    } catch (error) { fail('', error) }
    setBusy(false)
  }

  const connect = async () => {
    setBusy(true)
    try {
      let payload = null
      const parsed = parseInvite(invite)
      if (parsed) payload = parsed
      else if (manual) payload = { hubUrl: form.hubUrl, token: form.token, member: form.member }
      else throw new Error(t('invalidInvite'))
      if (!payload.token) throw new Error(t('invalidInvite'))
      await postJson('/config', payload)
      const data = await loadStatus()
      if (data) {
        setSetup(false)
        await reloadAll()
        toastMsg(false, t('connected'))
      }
    } catch (error) { fail('', error) }
    setBusy(false)
  }

  const normalizeRaw = async (id) => {
    setNormalizing(id)
    try {
      await postJson('/normalize', { id })
      await Promise.all([loadInbox(), loadList()])
      toastMsg(false, t('normalized'))
    } catch (error) { fail('', error) }
    setNormalizing('')
  }

  const deleteRaw = async (id) => {
    if (!await askConfirm(t('deleteRaw') + '？')) return
    try { await postJson('/raw/delete', { id }); await loadInbox() } catch (error) { fail('', error) }
  }

  const skipRaw = async (id) => {
    const why = await ask({ title: t('skipReason') })
    if (why === null) return
    try { await postJson('/raw/skip', { id, reason: why }); await loadInbox() } catch (error) { fail('', error) }
  }

  const ackImportant = async (id) => {
    try {
      await postJson('/important/ack', { id })
      await Promise.all([loadImportant(), loadStatus()])
      toastMsg(false, t('acked'))
    } catch (error) {
      if (error && error.data && error.data.needRead) toastMsg(true, t('ackNeedRead'))
      else fail('', error)
    }
  }

  const togglePick = (id) => {
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const batchDownload = () => {
    if (!picked.length) return
    const qs = new URLSearchParams({ ids: picked.join(',') })
    const url = `${API}/batch/download?${qs}`
    const a = document.createElement('a')
    a.href = url
    a.rel = 'noreferrer'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  const batchDelete = async () => {
    if (!picked.length) return
    if (!await askConfirm(`删除选中的 ${picked.length} 篇？（非管理员只能删掉自己创建的）`)) return
    try {
      const data = await postJson('/batch-delete', { ids: picked })
      toastMsg(!data.ok, `已删除 ${data.deleted} 篇，失败 ${data.failed} 篇` +
        (data.results || []).filter((r) => !r.ok).map((r) => `\n· ${r.error}`).join(''))
      setPicked([])
      await Promise.all([loadList(), loadImportant(), loadCollections()])
    } catch (error) { fail('', error) }
  }

  const createCollection = async () => {
    const name = await ask({ title: t('collectionName') })
    if (!name || !name.trim()) return
    try { await postJson('/collections', { action: 'create', name: name.trim() }); await loadCollections() } catch (error) { fail('', error) }
  }

  const removeCollection = async (col) => {
    if (!await askConfirm(`${t('removeCollection')}：${col.name}？`)) return
    try {
      await postJson('/collections', { action: 'remove', collectionId: col.id })
      if (collection === col.id) setCollection('')
      await loadCollections()
    } catch (error) { fail('', error) }
  }

  const renameCollection = async (col) => {
    const name = await ask({ title: t('rename'), value: col.name })
    if (!name || !name.trim()) return
    try { await postJson('/collections', { action: 'rename', collectionId: col.id, name: name.trim() }); await loadCollections() } catch (error) { fail('', error) }
  }

  const markMentionsSeen = async () => {
    try { await postJson('/mentions/seen', {}); await loadMentions(); await loadStatus() } catch { /* ignore */ }
  }

  const onDrop = async (event) => {
    event.preventDefault()
    setDragging(false)
    dragDepth.current = 0
    const files = [...((event.dataTransfer && event.dataTransfer.files) || [])]
    if (!files.length) return
    setBusy(true)
    for (const file of files) {
      try {
        const qs = new URLSearchParams({ name: file.name, title: file.name })
        const res = await fetch(`${API}/upload?${qs}`, { method: 'POST', body: file })
        const data = await res.json()
        if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`)
      } catch (error) { fail(file.name + '：', error) }
    }
    setBusy(false)
    await reloadAll()
  }

  // ---------------------------------------------------------------- 首次连接

  if (!status && setup) {
    return h('div', { className: 'skb-wrap' },
      h(AskHost, { key: 'skb-ask' }),
      h('style', null, CSS),
      h('div', { className: 'skb-page' },
        h('div', { className: 'skb-hint' },
          h('h2', null, t('setupTitle')),
          h('p', null, t('setupHint')),
          h('div', { className: 'skb-form' },
            h('input', {
              className: 'skb-input', placeholder: t('invitePlaceholder'), value: invite,
              onChange: (e) => setInvite(e.target.value),
            }),
            h('div', { className: 'skb-chips' },
              h('button', { className: 'skb-btn primary', onClick: connect, disabled: busy }, t('connect')),
              h('button', { className: 'skb-chip' + (manual ? ' on' : ''), onClick: () => setManual(!manual) }, t('manual')),
            ),
            manual ? h('div', { className: 'skb-form' },
              h('div', { className: 'skb-label' }, t('hubUrl')),
              h('input', { className: 'skb-input', value: form.hubUrl, placeholder: 'http://192.168.1.10:8787', onChange: (e) => setForm({ ...form, hubUrl: e.target.value }) }),
              h('div', { className: 'skb-label' }, t('token')),
              h('input', { className: 'skb-input', value: form.token, onChange: (e) => setForm({ ...form, token: e.target.value }) }),
              h('div', { className: 'skb-label' }, t('memberName')),
              h('input', { className: 'skb-input', value: form.member, onChange: (e) => setForm({ ...form, member: e.target.value }) }),
            ) : null,
          ),
          fatal ? h('div', { style: { color: 'var(--dsw-alias-state-danger,#d33)', fontSize: 12.5 } }, fatal) : null,
        ),
        h(Toast, { toast, onClose: () => setToast(null) }),
      ),
    )
  }

  if (view === 'admin' && status && status.member && status.member.role === 'admin') {
    return h('div', { className: 'skb-wrap' },
      h(AskHost, { key: 'skb-ask' }),
      h('style', null, CSS),
      h(Admin, { t, status, onBack: async () => { setView('kb'); await reloadAll() }, toast, setToast }),
    )
  }

  const cats = (status && status.categories) || []
  const authorOptions = (() => {
    const map = new Map()
    for (const entry of authors) map.set(entry.name, entry.count)
    for (const item of items) {
      const name = item.author || '未知'
      if (!map.has(name)) map.set(name, 1)
    }
    return [...map.entries()]
  })()
  const activeCollection = collections.find((c) => c.id === collection)
  const listSource = tab === 'inbox' ? inbox : items

  const tabs = [
    { key: 'docs', label: t('docs'), count: total },
    { key: 'important', label: '★ ' + t('important'), count: importantList.length },
    { key: 'inbox', label: t('inbox'), count: inbox.length },
    { key: 'collections', label: '☆ ' + t('collections'), count: collections.length },
  ]

  const bannerVisible = importantList.length > 0 && view === 'kb'

  // 左栏列表：四个 tab 各自的渲染，用语句而不是嵌套三元，出错时位置明确。
  const renderRows = () => {
    if (loading) return emptyState(t('loading'))

    if (tab === 'mentions') {
      if (!mentions.length) return emptyState(t('noMentions'))
      return mentions.map((m) => h('div', {
        key: m.comment.id,
        className: 'skb-item',
        onClick: () => openDoc(m.docId),
      },
        h('div', { className: 'skb-item-main' },
          h('div', { className: 'skb-item-title' }, `@${m.comment.author} 提到你：${m.docTitle}`),
          h('div', { className: 'skb-item-sub' }, formatTime(m.comment.at)),
          h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary,#666)', marginTop: 3 } }, m.comment.text.slice(0, 120)),
        ),
      ))
    }

    if (tab === 'inbox') {
      if (!inbox.length) return emptyState(t('inboxEmpty'))
      return inbox.map((r) => h('div', { key: r.id, className: 'skb-item' },
        h('div', { className: 'skb-item-main' },
          h('div', { className: 'skb-item-title' }, r.scope === 'private' ? '🔒 ' + r.name : r.name),
          h('div', { className: 'skb-item-sub' },
            h('span', null, r.author || ''),
            h('span', null, formatTime(r.createdAt || r.at)),
            h('span', null, fmtBytes(r.bytes)),
          ),
          h('div', { style: { display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' } },
            h('button', {
              className: 'skb-btn small primary', disabled: normalizing === r.id,
              onClick: () => normalizeRaw(r.id),
            }, normalizing === r.id ? t('normalizing') : 'AI ' + t('normalize')),
            h('a', {
              className: 'skb-btn small', style: { lineHeight: '26px', textDecoration: 'none' },
              href: `${API}/raw?id=${encodeURIComponent(r.id)}&name=${encodeURIComponent(r.name || '')}`,
              target: '_blank', rel: 'noreferrer',
            }, '⬇'),
            h('button', { className: 'skb-btn small', onClick: () => skipRaw(r.id) }, t('skip')),
            h('button', { className: 'skb-btn small danger', onClick: () => deleteRaw(r.id) }, '✕'),
          ),
        ),
      ))
    }

    if (tab === 'important') {
      if (!importantList.length) return emptyState('没有未处理的重要资料')
      return importantList.map((d) => h('div', {
        key: d.id,
        className: 'skb-item' + (doc && doc.id === d.id ? ' active' : ''),
        onClick: () => openDoc(d.id),
      },
        h('span', { className: 'skb-star' }, '★'),
        h('div', { className: 'skb-item-main' },
          h('div', { className: 'skb-item-title' }, d.title),
          h('div', { className: 'skb-item-sub' },
            h('span', null, d.category),
            h('span', null, d.author || ''),
            h('span', null, d.read ? '已读' : '未读'),
          ),
          h('div', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary,#666)', marginTop: 3 } }, (d.recommend || '').slice(0, 80)),
        ),
      ))
    }

    if (!listSource.length) return emptyState(searched ? t('emptySearch') : t('empty'))
    return listSource.map((item) => h('div', {
      key: item.id,
      className: 'skb-item' + (doc && doc.id === item.id ? ' active' : '') + (item.read === false && item.important ? ' req' : ''),
      onClick: () => (batch ? togglePick(item.id) : openDoc(item.id)),
    },
      batch ? h('input', {
        type: 'checkbox', className: 'skb-cb', checked: picked.includes(item.id),
        onChange: () => togglePick(item.id),
        onClick: (e) => e.stopPropagation(),
      }) : (item.important ? h('span', { className: 'skb-star' }, '★') : h('span', { className: 'skb-star dim' }, '★')),
      h('div', { className: 'skb-item-main' },
        h('div', { className: 'skb-item-title' }, item.title),
        h('div', { className: 'skb-item-sub' },
          h('span', { className: item.scope === 'private' ? 'skb-priv' : 'skb-cat' },
            item.scope === 'private' ? '🔒 ' + t('private') : item.category),
          h('span', null, item.author || ''),
          h('span', null, formatTime(item.updatedAt)),
          item.comments ? h('span', null, `💬 ${item.comments}`) : null,
        ),
        item.snippet ? h('div', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary,#666)', marginTop: 3, lineHeight: 1.5 } }, item.snippet.slice(0, 90)) : null,
      ),
    ))
  }

  return h('div', { className: 'skb-wrap' },
      h(AskHost, { key: 'skb-ask' }),
    h('style', null, CSS),
    h('div', { className: 'skb-page' },
      // ------------------------------------------------ 顶栏
      h('div', { className: 'skb-head' },
        h('h1', null, t('title')),
        h('div', { className: 'skb-sub' }, status ? `${status.docs} 篇 · ${status.members ? status.members.length : 0} 人` : t('loading')),
        h('div', { className: 'skb-meta' },
          status && status.member ? h('span', { className: 'skb-pill' }, h('span', { className: 'skb-dot' }), status.member.name + (status.member.role === 'admin' ? ' · 管理员' : '')) : null,
          status && status.privateCount ? h('span', { className: 'skb-pill' }, '🔒 ' + status.privateCount) : null,
          status && status.mentionsUnread ? h('button', {
            className: 'skb-pill info',
            onClick: () => { setTab('mentions'); setView('kb'); markMentionsSeen() },
          }, `@ ${status.mentionsUnread}`) : null,
          h('button', { className: 'skb-pill', onClick: async () => { await reloadAll(); toastMsg(false, t('refresh')) } }, '⟳ ' + t('refresh')),
          status && status.member && status.member.role === 'admin'
            ? h('button', { className: 'skb-pill', onClick: () => setView('admin') }, t('admin')) : null,
        ),
      ),

      // ------------------------------------------------ 重要资料醒目提醒
      bannerVisible ? h('div', { className: 'skb-banner' },
        h('div', { className: 'skb-banner-head' },
          '🔔 ' + fill(t('importantBanner'), { n: importantList.length }),
          h('span', { style: { fontWeight: 400, opacity: .8 } }, '— 读完才能取消置顶'),
        ),
        ...importantList.slice(0, 4).map((d) => h('div', { key: d.id, className: 'skb-banner-item' },
          h('div', { className: 'skb-banner-main' },
            h('div', { className: 'skb-banner-title', onClick: () => openDoc(d.id) }, `★ ${d.title}`),
            h('div', { className: 'skb-banner-rec' }, d.recommend || ''),
            h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary,#888)', marginTop: 2 } },
              `${d.category} · ${d.author || ''} · ${formatTime(d.importantAt || d.updatedAt)}${d.read ? ' · 已读' : ''}`),
          ),
          h('div', { className: 'skb-banner-actions' },
            h('button', { className: 'skb-btn small', onClick: () => openDoc(d.id) }, d.read ? '重读' : t('goRead')),
            h('button', {
              className: 'skb-btn small primary', disabled: !d.read,
              title: d.read ? '' : t('ackNeedRead'),
              onClick: () => ackImportant(d.id),
            }, d.read ? t('ackImportant') : '先读'),
          ),
        )),
        importantList.length > 4 ? h('div', { style: { fontSize: 11.5, color: '#c62828' } },
          h('button', { className: 'skb-btn small ghost', onClick: () => setTab('important') }, `另外 ${importantList.length - 4} 篇 →`)) : null,
      ) : null,

      // ------------------------------------------------ 工具栏
      h('div', { className: 'skb-toolbar' },
        h('input', {
          className: 'skb-input', placeholder: t('searchPlaceholder'), value: query,
          onChange: (e) => setQuery(e.target.value),
          onKeyDown: (e) => { if (e.key === 'Enter') doSearch() },
        }),
        h('button', { className: 'skb-btn primary', onClick: () => doSearch(), disabled: busy }, t('search')),
        searched ? h('button', { className: 'skb-btn', onClick: () => { setQuery(''); doSearch('') } }, t('clear')) : null,
        h('button', { className: 'skb-btn', onClick: () => setUploadOpen(true) }, '＋ ' + t('upload')),
        h('button', {
          className: 'skb-btn' + (batch ? ' primary' : ''),
          onClick: () => { setBatch(!batch); setPicked([]) },
        }, batch ? t('exitBatch') : t('batchMode')),
      ),
      h('div', { className: 'skb-toolbar', style: { paddingTop: 0 } },
        h('select', { className: 'skb-select', value: category, onChange: (e) => { setCategory(e.target.value); setCollection(''); loadList({ category: e.target.value, collection: '' }).catch((err) => fail('', err)) } },
          h('option', { value: '' }, t('category') + '：' + t('all')),
          ...cats.map((c) => h('option', { key: c, value: c }, c))),
        h('select', { className: 'skb-select', value: author, onChange: (e) => { setAuthor(e.target.value); loadList({ author: e.target.value }).catch((err) => fail('', err)) } },
          h('option', { value: '' }, t('filterAuthor') + '：' + t('anyAuthor')),
          ...authorOptions.map(([name, count]) => h('option', { key: name, value: name }, `${name}（${count}）`))),
        h('select', { className: 'skb-select', value: important, onChange: (e) => { setImportant(e.target.value); loadList({ important: e.target.value }).catch((err) => fail('', err)) } },
          h('option', { value: '' }, t('filterImportant') + '：' + t('all')),
          h('option', { value: 'only' }, '★ ' + t('importantOnly')),
          h('option', { value: 'exclude' }, t('importantExclude'))),
        h('select', { className: 'skb-select', value: scope, onChange: (e) => { setScope(e.target.value); loadList({ scope: e.target.value }).catch((err) => fail('', err)) } },
          h('option', { value: 'all' }, t('scope') + '：' + t('scopeAll')),
          h('option', { value: 'public' }, t('scope') + '：' + t('scopePublic')),
          h('option', { value: 'private' }, t('scope') + '：🔒 ' + t('scopePrivate'))),
        h('select', { className: 'skb-select', value: sort, onChange: (e) => { setSort(e.target.value); loadList({ sort: e.target.value }).catch((err) => fail('', err)) } },
          h('option', { value: 'updated' }, t('sort') + '：' + t('sortUpdated')),
          h('option', { value: 'created' }, t('sort') + '：' + t('sortCreated')),
          h('option', { value: 'important' }, t('sort') + '：' + t('sortImportant'))),
      ),

      // ------------------------------------------------ 批量条
      batch ? h('div', { className: 'skb-batchbar' },
        h('b', null, fill(t('selected'), { n: picked.length })),
        h('button', { className: 'skb-btn small', onClick: () => setPicked(items.map((d) => d.id)) }, t('selectAll')),
        h('button', { className: 'skb-btn small', onClick: () => setPicked([]) }, t('selectNone')),
        h('span', { style: { flex: 1 } }),
        h('button', { className: 'skb-btn small', onClick: batchDownload, disabled: !picked.length }, '⬇ ' + t('batchDownload')),
        h('button', { className: 'skb-btn small danger', onClick: batchDelete, disabled: !picked.length }, '✕ ' + t('batchDelete')),
        h('span', { style: { fontSize: 11, opacity: .75 } }, t('deleteOwnOnly')),
      ) : null,

      // ------------------------------------------------ 主体
      h('div', { className: 'skb-body' },
        h('div', { className: 'skb-side' },
          h('div', { className: 'skb-tabs' },
            ...tabs.map((entry) => h('button', {
              key: entry.key,
              className: tab === entry.key ? 'active' : '',
              onClick: () => {
                setTab(entry.key)
                if (entry.key === 'inbox') loadInbox().catch((err) => fail('', err))
                if (entry.key === 'important') loadImportant().catch((err) => fail('', err))
                if (entry.key === 'collections') loadCollections().catch((err) => fail('', err))
                if (entry.key === 'docs') loadList().catch((err) => fail('', err))
              },
            }, entry.label, entry.count ? h('span', { className: 'skb-count' }, entry.count) : null)),
          ),

          // 收藏夹列表
          tab === 'collections' ? h('div', { style: { padding: 8 } },
            h('button', { className: 'skb-btn small', style: { width: '100%', marginBottom: 6 }, onClick: createCollection }, '＋ ' + t('newCollection')),
            !collections.length ? h('div', { style: { fontSize: 12, padding: 8, color: 'var(--dsw-alias-label-secondary,#777)' } }, t('collectionEmpty'))
              : collections.map((col) => h('div', {
                key: col.id,
                className: 'skb-col' + (collection === col.id ? ' active' : ''),
                onClick: () => { setCollection(col.id); setTab('docs'); loadList({ collection: col.id }).catch((err) => fail('', err)) },
              },
                h('span', null, '☆'),
                h('span', { className: 'n' }, col.name),
                h('span', { className: 'c' }, col.count),
                h('button', { className: 'skb-btn ghost small', onClick: (e) => { e.stopPropagation(); renameCollection(col) } }, '✎'),
                h('button', { className: 'skb-btn ghost small', onClick: (e) => { e.stopPropagation(); removeCollection(col) } }, '×'),
              )),
            activeCollection ? h('button', {
              className: 'skb-btn small', style: { width: '100%', marginTop: 6 },
              onClick: () => { setCollection(''); setTab('docs'); loadList({ collection: '' }).catch((err) => fail('', err)) },
            }, '← ' + t('all')) : null,
          ) : null,

          // 列表
          tab !== 'collections' ? h('div', { className: 'skb-list' }, renderRows()) : null,
        ),

        // ------------------------------------------------ 右栏
        h('div', { className: 'skb-main' },
          busy && !doc ? emptyState(t('loading'))
            : doc ? h(DocView, { t, doc, status, collections, onToast: toastMsg, onRefresh: refreshDoc, onOpenDoc: openDoc })
              : h('div', { className: 'skb-hint' },
                h('h2', null, t('title')),
                h('p', null, t('subtitle')),
                h('p', { style: { fontSize: 12 } },
                  '查资料时直接问 AI：它会先用 recall 一次拿回多篇要点，再按需读全文。'),
                h('p', { style: { fontSize: 12 } },
                  '隐私内容上传时选「仅自己可见」，只存在这台电脑上。'),
                h('p', { style: { fontSize: 12 } },
                  '标为重要必须写推荐语，会推送给所有人置顶；每人读完才能自己取消。'),
              ),
        ),
      ),

      h('div', { className: 'skb-foot' },
        status ? `${status.name} · Hub ${status.hubUrl || ''} · ${status.privateCount || 0} 篇私有` : t('noToken'),

      ),

      dragging ? h('div', { className: 'skb-drop' }, t('dropHere')) : null,
      h(Toast, { toast, onClose: () => setToast(null) }),
    ),

    uploadOpen ? h(UploadDialog, {
      t,
      collections,
      onClose: () => setUploadOpen(false),
      onDone: async () => { await reloadAll() },
    }) : null,

    weekly ? h(WeeklyDialog, {
      t, report: weekly,
      onClose: () => setWeekly(null),
      onSeen: async () => {
        try { await postJson('/weekly/seen', {}) } catch { /* ignore */ }
        setWeekly(null)
        await loadStatus()
      },
    }) : null,
  )
}

// ---------------------------------------------------------------- icon

function PanelIcon({ size = 18, active = false }) {
  return h('svg', {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
    'aria-hidden': true,
  },
    h('path', { d: 'M4 5.5A2.5 2.5 0 0 1 6.5 3H19v16H6.5A2.5 2.5 0 0 0 4 21.5z' }),
    h('path', { d: 'M4 18.5A2.5 2.5 0 0 1 6.5 16H19' }),
    h('path', { d: 'M9 7h6M9 10.5h4' }),
  )
}

window.__ModuleLoader__.load({
  id: 'dsh-shared-kb',
  factory(require) {
    React = require('react')
    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const t = makeT(ctx)
        TT = t
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: 'shared-kb', order: 6, label: () => t('panel'),
        }, (props) => React.createElement(PanelIcon, props)))
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'shared-kb' }, () => React.createElement(Page, { t })))
      },
    }
  },
})
})()
