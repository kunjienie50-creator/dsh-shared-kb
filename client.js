'use strict'

/**
 * dsh-shared-kb — Client half
 *
 * 侧栏「共享知识库」入口 + 中栏整页：
 *  - 首次使用只填一个「邀请码」（或把手动配置折起来）；
 *  - 上传（点击/拖拽）、分类筛选、搜索、阅读；
 *  - 管理员视图：库统计、成员增删/轮换、邀请码生成、文档与素材清理。
 * 数据走宿主同源路由 /shared-kb/api。
 */

let React = null

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
  readFail: '读取失败：', searchFail: '搜索失败：', loadFail: '连接失败：',
  setupTitle: '连接团队知识库', setupBody: '把管理员发你的邀请码粘贴到下面，点「连接」即可。通常只有这一件事要做。',
  connFailTitle: '连不上知识库', retry: '重试', reenter: '重新填邀请码', api: '页面接口',
  invitePlaceholder: '粘贴邀请码（skb1.…）', connect: '连接', connecting: '连接中…',
  manual: '手动填写', manualHide: '收起手动填写', hubUrl: 'Hub 地址', token: '成员令牌', member: '显示名', save: '保存',
  badInvite: '邀请码格式不对，请让管理员重新发一个。',
  dropHere: '松手即可上传', uploaded: '已收｜', uploadedDup: '已存在，未重复保存：',
  uploadedPending: '已上传，等待整理：', uploadFail: '上传失败：', noPermission: '令牌无效或没有权限',
  delete: '删除', confirmDelete: '确定删除这篇文档？历史版本会一起删掉。',
  admin: '管理', back: '返回知识库', adminTitle: '知识库管理', adminOnly: '只有管理员能进',
  stats: '概览', members: '成员', addMember: '添加成员', namePlaceholder: '成员名字',
  roleMember: '成员', roleAdmin: '管理员', inviteCode: '邀请码（发给对方，粘贴即可连接）',
  copy: '复制', copied: '已复制', remove: '移除', rotate: '换令牌',
  confirmRemove: '确定移除该成员？他/她将立刻无法访问。', confirmRotate: '换令牌后旧令牌立即失效，确定？',
  resources: '资源清理', docList: '文档', rawList: '原始素材', skip: '标记无用', deleteRaw: '删除素材',
  skipReason: '原因（例如：重复截图）', noData: '暂无数据',
  footNote: '文件存在 Hub 那台机器上；这里只是入口。',
}

const EN = {
  panel: 'Shared KB', panelTitle: 'Team shared knowledge base',
  title: 'Shared knowledge base', subtitle: 'Drop it in, normalized once, searchable by everyone',
  searchPlaceholder: 'Search title, points, body…', search: 'Search', clear: 'Clear',
  upload: 'Upload', uploading: 'Working…', refresh: 'Refresh', loading: 'Loading…',
  empty: 'Nothing yet. Upload the first item.', emptySearch: 'No matches.',
  inbox: 'Inbox', inboxEmpty: 'Inbox is empty', docs: 'Saved',
  author: 'Author', updated: 'Updated', tags: 'Tags', version: 'Version', points: 'Points',
  category: 'Category', all: 'All', confidence: 'Confidence',
  readFail: 'Read failed: ', searchFail: 'Search failed: ', loadFail: 'Connection failed: ',
  setupTitle: 'Connect to the team library', setupBody: 'Paste the invite code from your admin and press Connect.',
  invitePlaceholder: 'Invite code (skb1.…)', connect: 'Connect', connecting: 'Connecting…',
  manual: 'Enter manually', manualHide: 'Hide manual entry', hubUrl: 'Hub URL', token: 'Member token', member: 'Display name', save: 'Save',
  badInvite: 'Invalid invite code. Ask your admin for a new one.',
  dropHere: 'Drop to upload', uploaded: 'Saved: ', uploadedDup: 'Already exists: ',
  uploadedPending: 'Uploaded, waiting for normalization: ', uploadFail: 'Upload failed: ', noPermission: 'Invalid token',
  delete: 'Delete', confirmDelete: 'Delete this document and its history?',
  admin: 'Admin', back: 'Back', adminTitle: 'Library admin', adminOnly: 'Admins only',
  stats: 'Overview', members: 'Members', addMember: 'Add member', namePlaceholder: 'Member name',
  roleMember: 'Member', roleAdmin: 'Admin', inviteCode: 'Invite code (send it to them)',
  copy: 'Copy', copied: 'Copied', remove: 'Remove', rotate: 'Rotate token',
  confirmRemove: 'Remove this member? Access stops immediately.', confirmRotate: 'Rotate the token? The old one stops working.',
  resources: 'Cleanup', docList: 'Documents', rawList: 'Raw material', skip: 'Mark useless', deleteRaw: 'Delete raw',
  skipReason: 'Reason (e.g. duplicate screenshot)', noData: 'No data',
  footNote: 'Files live on the Hub machine; this is just the client.',
}

function formatTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function fmtBytes(n) {
  const size = Number(n) || 0
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function parseInvite(code) {
  const raw = String(code || '').trim()
  if (!raw.startsWith('skb1.')) return null
  try {
    const json = decodeURIComponent(escape(atob(raw.slice(5).replace(/-/g, '+').replace(/_/g, '/'))))
    const data = JSON.parse(json)
    if (!data || !data.u || !data.t) return null
    return { hubUrl: data.u, token: data.t, member: data.n || '' }
  } catch { return null }
}

function inline(text, keyPrefix) {
  const nodes = []
  const source = String(text || '')
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g
  let last = 0
  let match
  let i = 0
  while ((match = pattern.exec(source))) {
    if (match.index > last) nodes.push(source.slice(last, match.index))
    const token = match[0]
    const key = `${keyPrefix}-${i++}`
    if (token.startsWith('**')) nodes.push(React.createElement('strong', { key }, token.slice(2, -2)))
    else if (token.startsWith('`')) nodes.push(React.createElement('code', { key, className: 'skb-inline-code' }, token.slice(1, -1)))
    else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)
      nodes.push(React.createElement('a', { key, href: link[2], target: '_blank', rel: 'noreferrer noopener' }, link[1]))
    }
    last = match.index + token.length
  }
  if (last < source.length) nodes.push(source.slice(last))
  return nodes
}

function Markdown({ text }) {
  const lines = String(text || '').split(/\r?\n/)
  const blocks = []
  let i = 0
  let key = 0
  while (i < lines.length) {
    const line = lines[i]
    if (/^```/.test(line)) {
      const code = []
      i++
      while (i < lines.length && !/^```/.test(lines[i])) { code.push(lines[i]); i++ }
      i++
      blocks.push(React.createElement('pre', { key: key++, className: 'skb-code' }, React.createElement('code', null, code.join('\n'))))
      continue
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading) {
      const level = heading[1].length
      blocks.push(React.createElement(`h${level}`, { key: key++, className: 'skb-h' }, inline(heading[2], `h${key}`)))
      i++
      continue
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const items = []
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(React.createElement('li', { key: `li${i}` }, inline(lines[i].replace(/^\s*[-*+]\s+/, ''), `li${i}`)))
        i++
      }
      blocks.push(React.createElement('ul', { key: key++ }, items))
      continue
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(React.createElement('li', { key: `li${i}` }, inline(lines[i].replace(/^\s*\d+\.\s+/, ''), `li${i}`)))
        i++
      }
      blocks.push(React.createElement('ol', { key: key++ }, items))
      continue
    }
    if (/^>\s?/.test(line)) {
      const quote = []
      while (i < lines.length && /^>\s?/.test(lines[i])) { quote.push(lines[i].replace(/^>\s?/, '')); i++ }
      blocks.push(React.createElement('blockquote', { key: key++, className: 'skb-quote' }, inline(quote.join(' '), `q${key}`)))
      continue
    }
    if (!line.trim()) { i++; continue }
    const para = [line]
    i++
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|>\s?|\s*[-*+]\s|\s*\d+\.\s)/.test(lines[i])) {
      para.push(lines[i])
      i++
    }
    blocks.push(React.createElement('p', { key: key++ }, inline(para.join(' '), `p${key}`)))
  }
  return React.createElement('div', { className: 'skb-markdown' }, blocks)
}

const CSS = `
.skb-page{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#1a1a1a)}
.skb-head{display:flex;align-items:center;gap:12px;padding:14px 20px;border-bottom:1px solid var(--dsw-alias-border-secondary,#e6e6e6)}
.skb-head h1{font-size:15px;font-weight:600;margin:0}
.skb-sub{font-size:12px;color:var(--dsw-alias-label-secondary,#666)}
.skb-head .skb-meta{margin-left:auto;display:flex;align-items:center;gap:10px;font-size:12px;color:var(--dsw-alias-label-secondary,#666)}
.skb-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-success,#2e9e5b);display:inline-block;margin-right:5px}
.skb-toolbar{display:flex;gap:8px;padding:12px 20px;align-items:center;flex-wrap:wrap}
.skb-input,.skb-select{height:32px;padding:0 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-primary,#d9d9d9);background:var(--dsw-alias-bg-base,#fff);color:inherit;font-size:13px;outline:none}
.skb-input{flex:1;min-width:180px}
.skb-input:focus{border-color:var(--dsw-alias-state-info,#3b82f6)}
.skb-btn{height:32px;padding:0 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-primary,#d9d9d9);background:var(--dsw-alias-bg-secondary,#f5f5f5);color:inherit;font-size:13px;cursor:pointer;white-space:nowrap}
.skb-btn:hover{background:var(--dsw-alias-bg-tertiary,#ececec)}
.skb-btn.primary{background:var(--dsw-alias-state-info,#1f6feb);border-color:transparent;color:#fff}
.skb-btn.danger{color:var(--dsw-alias-state-danger,#d33);border-color:var(--dsw-alias-state-danger,#d33)}
.skb-btn:disabled{opacity:.55;cursor:default}
.skb-body{flex:1;min-height:0;display:flex;border-top:1px solid var(--dsw-alias-border-secondary,#e6e6e6)}
.skb-side{width:340px;min-width:260px;max-width:44%;border-right:1px solid var(--dsw-alias-border-secondary,#e6e6e6);display:flex;flex-direction:column;min-height:0}
.skb-list{flex:1;overflow:auto;padding:8px}
.skb-item{display:block;width:100%;text-align:left;padding:10px 12px;border-radius:8px;border:1px solid transparent;background:transparent;color:inherit;cursor:pointer;margin-bottom:4px}
.skb-item:hover{background:var(--dsw-alias-bg-secondary,#f5f5f5)}
.skb-item.active{background:var(--dsw-alias-bg-tertiary,#ececec);border-color:var(--dsw-alias-border-primary,#d9d9d9)}
.skb-item-title{font-size:13px;font-weight:550;line-height:1.4;margin-bottom:4px;word-break:break-word}
.skb-item-sub{font-size:11.5px;color:var(--dsw-alias-label-secondary,#777);display:flex;gap:8px;flex-wrap:wrap}
.skb-tag{display:inline-block;padding:1px 6px;border-radius:999px;background:var(--dsw-alias-bg-tertiary,#eee);font-size:11px;color:var(--dsw-alias-label-secondary,#666)}
.skb-cat{display:inline-block;padding:1px 7px;border-radius:6px;background:rgba(31,111,235,.12);color:var(--dsw-alias-state-info,#1f6feb);font-size:11px;margin-right:6px}
.skb-main{flex:1;min-width:0;overflow:auto;padding:22px 30px}
.skb-doc-title{font-size:20px;font-weight:650;margin:6px 0 6px;line-height:1.35}
.skb-doc-meta{font-size:12px;color:var(--dsw-alias-label-secondary,#777);display:flex;gap:14px;flex-wrap:wrap;margin-bottom:14px;align-items:center}
.skb-markdown{font-size:13.5px;line-height:1.75}
.skb-markdown p{margin:0 0 10px}
.skb-h{margin:18px 0 8px;line-height:1.4}
.skb-markdown h1{font-size:20px}.skb-markdown h2{font-size:16px}.skb-markdown h3{font-size:14.5px}.skb-markdown h4{font-size:13.5px}
.skb-markdown ul,.skb-markdown ol{margin:0 0 10px;padding-left:22px}
.skb-code{background:var(--dsw-alias-bg-secondary,#f5f5f5);border-radius:8px;padding:10px 12px;overflow:auto;font-size:12.5px;margin:0 0 12px}
.skb-inline-code{background:var(--dsw-alias-bg-secondary,#f5f5f5);border-radius:4px;padding:1px 5px;font-size:12.5px}
.skb-quote{margin:0 0 12px;padding:4px 12px;border-left:3px solid var(--dsw-alias-border-primary,#d9d9d9);color:var(--dsw-alias-label-secondary,#666)}
.skb-empty{padding:40px 20px;text-align:center;font-size:13px;color:var(--dsw-alias-label-secondary,#777)}
.skb-toggle{display:flex;gap:6px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-secondary,#e6e6e6)}
.skb-toggle button{flex:1;height:28px;border-radius:6px;border:1px solid transparent;background:transparent;color:inherit;font-size:12px;cursor:pointer}
.skb-toggle button.active{background:var(--dsw-alias-bg-tertiary,#ececec);border-color:var(--dsw-alias-border-primary,#d9d9d9)}
.skb-hint{padding:28px;max-width:560px;margin:0 auto;font-size:13px;line-height:1.7;color:var(--dsw-alias-label-secondary,#666)}
.skb-hint h2{color:var(--dsw-alias-label-primary,#111);font-size:16px;margin:0 0 8px}
.skb-toast{position:sticky;bottom:10px;margin:0 20px 12px;padding:9px 12px;border-radius:8px;background:var(--dsw-alias-bg-tertiary,#ececec);font-size:12.5px;border:1px solid var(--dsw-alias-border-primary,#d9d9d9);white-space:pre-wrap}
.skb-toast.err{border-color:var(--dsw-alias-state-danger,#d33);color:var(--dsw-alias-state-danger,#d33)}
.skb-drop{position:absolute;inset:0;background:rgba(31,111,235,.08);border:2px dashed var(--dsw-alias-state-info,#1f6feb);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:14px;z-index:5;pointer-events:none}
.skb-wrap{position:relative;height:100%;display:flex;flex-direction:column;min-height:0}
.skb-form{display:grid;gap:8px;margin-top:14px}
.skb-code-box{display:flex;gap:8px;align-items:flex-start;margin-top:8px}
.skb-code-box textarea{flex:1;min-height:54px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;padding:8px;border-radius:8px;border:1px solid var(--dsw-alias-border-primary,#d9d9d9);background:var(--dsw-alias-bg-secondary,#f5f5f5);color:inherit;resize:vertical;word-break:break-all}
.skb-admin{padding:18px 24px;overflow:auto;flex:1}
.skb-admin h2{font-size:15px;margin:18px 0 10px}
.skb-admin h2:first-child{margin-top:0}
.skb-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px}
.skb-card{border:1px solid var(--dsw-alias-border-secondary,#e6e6e6);border-radius:10px;padding:10px 12px;font-size:12px;color:var(--dsw-alias-label-secondary,#666)}
.skb-card b{display:block;font-size:18px;color:var(--dsw-alias-label-primary,#111);margin-top:4px}
.skb-table{width:100%;border-collapse:collapse;font-size:12.5px}
.skb-table th,.skb-table td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--dsw-alias-border-secondary,#e6e6e6)}
.skb-table th{color:var(--dsw-alias-label-secondary,#777);font-weight:500}
.skb-row-actions{display:flex;gap:6px;flex-wrap:wrap}
.skb-row-actions .skb-btn{height:26px;padding:0 8px;font-size:12px}
.skb-foot{padding:8px 20px;font-size:11.5px;color:var(--dsw-alias-label-secondary,#888);border-top:1px solid var(--dsw-alias-border-secondary,#e6e6e6)}
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
  return (key) => {
    if (t) {
      try { const value = t(key); if (value && value !== key) return value } catch { /* fallthrough */ }
    }
    let active = 'zh'
    try { active = ctx.get('locale').getLocale().active } catch { /* ignore */ }
    return (String(active).startsWith('zh') ? ZH : EN)[key] || key
  }
}

function Page({ t }) {
  const [status, setStatus] = React.useState(null)
  const [items, setItems] = React.useState([])
  const [query, setQuery] = React.useState('')
  const [searched, setSearched] = React.useState(false)
  const [category, setCategory] = React.useState('')
  const [doc, setDoc] = React.useState(null)
  const [inbox, setInbox] = React.useState([])
  const [tab, setTab] = React.useState('docs')
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [toast, setToast] = React.useState(null)
  const [dragging, setDragging] = React.useState(false)
  const [setup, setSetup] = React.useState(false)
  const [invite, setInvite] = React.useState('')
  const [manual, setManual] = React.useState(false)
  const [form, setForm] = React.useState({ hubUrl: '', token: '', member: '' })
  const [view, setView] = React.useState('kb')
  const [fatal, setFatal] = React.useState('')
  const fileRef = React.useRef(null)
  const dragDepth = React.useRef(0)

  const fail = (prefix, error) => setToast({ error: true, text: prefix + String((error && error.message) || error) })

  const loadStatus = async () => {
    const res = await fetch(`${API}/status`)
    const data = await res.json()
    if (!res.ok || data.ok === false) throw new Error(data.error || t('noPermission'))
    setStatus(data)
    return data
  }
  const loadList = async (cat = category) => {
    const qs = new URLSearchParams({ limit: '200' })
    if (cat) qs.set('category', cat)
    const res = await fetch(`${API}/list?${qs}`)
    const data = await res.json()
    if (!res.ok || data.ok === false) throw new Error(data.error || t('noPermission'))
    setItems(data.items || [])
  }
  const loadInbox = async (st = 'new') => {
    try {
      const res = await fetch(`${API}/inbox?status=${st}`)
      const data = await res.json()
      if (data.ok) setInbox(data.items || [])
    } catch { /* ignore */ }
  }

  const refresh = async () => {
    setLoading(true)
    try {
      const data = await loadStatus()
      await loadList()
      await loadInbox('new')
      setToast(null)
    } catch (error) {
      const message = String((error && error.message) || error)
      if (/未授权|未配置|令牌|401/.test(message)) setSetup(true)
      fail(t('loadFail'), error)
    } finally {
      setLoading(false)
    }
  }

  React.useEffect(() => { refresh() }, [])

  const search = async () => {
    const q = query.trim()
    if (!q) { setSearched(false); await loadList(); return }
    setBusy(true)
    try {
      const qs = new URLSearchParams({ q, limit: '50' })
      if (category) qs.set('category', category)
      const res = await fetch(`${API}/search?${qs}`)
      const data = await res.json()
      if (!res.ok || data.ok === false) throw new Error(data.error || t('searchFail'))
      setItems(data.items || [])
      setSearched(true)
      if (data.items && data.items.length) openDoc(data.items[0].id)
      else setDoc(null)
    } catch (error) { fail(t('searchFail'), error) } finally { setBusy(false) }
  }

  const openDoc = async (id) => {
    try {
      const res = await fetch(`${API}/doc?id=${encodeURIComponent(id)}`)
      const data = await res.json()
      if (!res.ok || data.ok === false) throw new Error(data.error || t('readFail'))
      setDoc(data.doc)
      setView('kb')
    } catch (error) { fail(t('readFail'), error) }
  }

  const uploadFiles = async (files) => {
    const list = Array.from(files || [])
    if (!list.length) return
    setBusy(true)
    setToast(null)
    for (const file of list) {
      try {
        const res = await fetch(`${API}/upload?name=${encodeURIComponent(file.name)}`, {
          method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: file,
        })
        const data = await res.json()
        if (!res.ok || data.ok === false) throw new Error(data.error || t('uploadFail'))
        if (data.duplicate && data.doc) {
          setToast({ text: t('uploadedDup') + `${data.raw.name}\n《${data.doc.title}》` })
          await openDoc(data.doc.id)
        } else if (data.doc) {
          setToast({ text: `${t('uploaded')}${data.doc.category} · ${data.doc.summary || data.doc.title}` })
          await openDoc(data.doc.id)
        } else {
          setToast({ error: true, text: t('uploadedPending') + (data.error || file.name) })
        }
      } catch (error) { fail(t('uploadFail'), error) }
    }
    await refresh()
    setBusy(false)
  }

  const onDrop = (event) => {
    event.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    if (event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files.length) uploadFiles(event.dataTransfer.files)
  }

  const removeDoc = async () => {
    if (!doc) return
    if (typeof window !== 'undefined' && !window.confirm(t('confirmDelete'))) return
    try {
      const res = await fetch(`${API}/delete`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: doc.id }) })
      const data = await res.json()
      if (!res.ok || data.ok === false) throw new Error(data.error || 'delete failed')
      setDoc(null)
      await refresh()
    } catch (error) { fail(t('delete') + '：', error) }
  }

  const connectWithInvite = async () => {
    const parsed = parseInvite(invite)
    if (!parsed) { setToast({ error: true, text: t('badInvite') }); return }
    setBusy(true)
    try {
      const res = await fetch(`${API}/config`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(parsed) })
      const data = await res.json()
      if (!res.ok || data.ok === false) throw new Error(data.error || 'save failed')
      setSetup(false)
      setInvite('')
      await refresh()
    } catch (error) { fail(t('loadFail'), error) } finally { setBusy(false) }
  }

  const saveManual = async () => {
    setBusy(true)
    try {
      const res = await fetch(`${API}/config`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(form) })
      const data = await res.json()
      if (!res.ok || data.ok === false) throw new Error(data.error || 'save failed')
      setSetup(false)
      await refresh()
    } catch (error) { fail(t('loadFail'), error) } finally { setBusy(false) }
  }

  const h = React.createElement
  const cats = (status && status.categories) || []
  const isAdmin = Boolean(status && status.member && status.member.role === 'admin')
  const list = tab === 'docs' ? items : inbox

  if (setup) {
    return h('div', { className: 'skb-wrap' },
      h('style', null, CSS),
      h('div', { className: 'skb-page' },
        h('header', { className: 'skb-head' }, h('div', null,
          h('h1', null, t('title')), h('div', { className: 'skb-sub' }, t('subtitle')))),
        h('div', { className: 'skb-hint' },
          h('h2', null, t('setupTitle')),
          h('p', null, t('setupBody')),
          h('div', { className: 'skb-form' },
            h('input', { className: 'skb-input', placeholder: t('invitePlaceholder'), value: invite, onChange: (e) => setInvite(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') connectWithInvite() } }),
            h('div', null, h('button', { className: 'skb-btn primary', onClick: connectWithInvite, disabled: busy }, busy ? t('connecting') : t('connect'))),
          ),
          h('button', { className: 'skb-btn', style: { marginTop: '14px' }, onClick: () => setManual(!manual) }, manual ? t('manualHide') : t('manual')),
          manual ? h('div', { className: 'skb-form' },
            h('input', { className: 'skb-input', placeholder: t('hubUrl') + ' — http://192.168.1.10:8787', value: form.hubUrl, onChange: (e) => setForm({ ...form, hubUrl: e.target.value }) }),
            h('input', { className: 'skb-input', placeholder: t('token'), value: form.token, onChange: (e) => setForm({ ...form, token: e.target.value }) }),
            h('input', { className: 'skb-input', placeholder: t('member'), value: form.member, onChange: (e) => setForm({ ...form, member: e.target.value }) }),
            h('div', null, h('button', { className: 'skb-btn', onClick: saveManual, disabled: busy }, t('save'))),
          ) : null,
        ),
      ),
      toast ? h('div', { className: 'skb-toast' + (toast.error ? ' err' : '') }, toast.text) : null,
    )
  }

  if (fatal && !setup) {
    return h('div', { className: 'skb-wrap' },
      h('style', null, CSS),
      h('div', { className: 'skb-page' },
        h('header', { className: 'skb-head' }, h('div', null, h('h1', null, t('title')), h('div', { className: 'skb-sub' }, t('connFailTitle')))),
        h('div', { className: 'skb-hint' },
          h('h2', null, t('connFailTitle')),
          h('p', { style: { wordBreak: 'break-all' } }, fatal),
          h('p', { style: { fontSize: '11.5px', wordBreak: 'break-all' } }, `${t('api')}：${API}/status`),
          h('div', { style: { display: 'flex', gap: '8px', marginTop: '12px' } },
            h('button', { className: 'skb-btn primary', onClick: () => { setFatal(''); refresh() } }, t('retry')),
            h('button', { className: 'skb-btn', onClick: () => { setFatal(''); setSetup(true) } }, t('reenter')),
          ),
        ),
      ),
      toast ? h('div', { className: 'skb-toast' + (toast.error ? ' err' : '') }, toast.text) : null,
    )
  }

  if (view === 'admin' && isAdmin) {
    return h(Admin, { t, status, onBack: () => { setView('kb'); refresh() }, toast, setToast })
  }

  return h('div', {
    className: 'skb-wrap',
    onDragEnter: (e) => { e.preventDefault(); dragDepth.current++; setDragging(true) },
    onDragOver: (e) => e.preventDefault(),
    onDragLeave: (e) => { e.preventDefault(); dragDepth.current--; if (dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false) } },
    onDrop,
  },
    h('style', null, CSS),
    h('div', { className: 'skb-page' },
      h('header', { className: 'skb-head' },
        h('div', null,
          h('h1', null, (status && status.name) || t('title')),
          h('div', { className: 'skb-sub' }, t('subtitle')),
        ),
        h('div', { className: 'skb-meta' },
          status ? h('span', null, h('span', { className: 'skb-dot' }),
            `${status.member ? status.member.name : ''}${status.member && status.member.role === 'admin' ? '（管理员）' : ''} · ${status.docs} ${t('docs')} · ${status.inbox} ${t('inbox')}`) : null,
          isAdmin ? h('button', { className: 'skb-btn', onClick: () => setView('admin') }, t('admin')) : null,
          h('button', { className: 'skb-btn', onClick: refresh, disabled: loading || busy }, t('refresh')),
        ),
      ),
      h('div', { className: 'skb-toolbar' },
        h('input', {
          className: 'skb-input', placeholder: t('searchPlaceholder'), value: query,
          onChange: (e) => setQuery(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') search() },
        }),
        h('select', {
          className: 'skb-select', value: category,
          onChange: (e) => { setCategory(e.target.value); loadList(e.target.value) },
        }, h('option', { value: '' }, t('all')), cats.map((c) => h('option', { key: c, value: c }, c))),
        h('button', { className: 'skb-btn', onClick: search, disabled: busy }, t('search')),
        searched ? h('button', { className: 'skb-btn', onClick: () => { setQuery(''); setSearched(false); loadList() } }, t('clear')) : null,
        h('button', { className: 'skb-btn primary', onClick: () => fileRef.current && fileRef.current.click(), disabled: busy }, busy ? t('uploading') : t('upload')),
        h('input', { ref: fileRef, type: 'file', multiple: true, style: { display: 'none' }, onChange: (e) => { uploadFiles(e.target.files); e.target.value = '' } }),
      ),
      h('div', { className: 'skb-body' },
        h('aside', { className: 'skb-side' },
          h('div', { className: 'skb-toggle' },
            h('button', { className: tab === 'docs' ? 'active' : '', onClick: () => setTab('docs') }, `${t('docs')} ${items.length}`),
            h('button', { className: tab === 'inbox' ? 'active' : '', onClick: () => { setTab('inbox'); loadInbox('new') } }, `${t('inbox')} ${inbox.length}`),
          ),
          h('div', { className: 'skb-list' },
            loading && !list.length ? h('div', { className: 'skb-empty' }, t('loading')) : null,
            !loading && !list.length ? h('div', { className: 'skb-empty' }, tab === 'docs' ? (searched ? t('emptySearch') : t('empty')) : t('inboxEmpty')) : null,
            tab === 'docs'
              ? list.map((item) => h('button', {
                  key: item.id, className: 'skb-item' + (doc && doc.id === item.id ? ' active' : ''),
                  onClick: () => openDoc(item.id),
                },
                  h('div', { className: 'skb-item-title' }, item.title),
                  h('div', { className: 'skb-item-sub' },
                    h('span', null, item.summary || '—'),
                    h('span', null, item.author || '—'),
                    h('span', null, formatTime(item.updatedAt)),
                  ),
                  h('div', { style: { marginTop: '5px' } },
                    h('span', { className: 'skb-cat' }, item.category || '99_待分类'),
                    (item.tags || []).slice(0, 3).map((tag) => h('span', { className: 'skb-tag', key: tag, style: { marginRight: '4px' } }, tag)),
                  ),
                ))
              : list.map((raw) => h('div', { key: raw.id, className: 'skb-item' },
                  h('div', { className: 'skb-item-title' }, raw.title || raw.name),
                  h('div', { className: 'skb-item-sub' },
                    h('span', null, raw.author || '—'),
                    h('span', null, formatTime(raw.createdAt)),
                    h('span', null, fmtBytes(raw.bytes)),
                  ),
                  h('a', { href: `${API}/raw?id=${encodeURIComponent(raw.id)}&name=${encodeURIComponent(raw.name)}`, style: { fontSize: '11.5px' } }, '下载'),
                )),
          ),
        ),
        h('main', { className: 'skb-main' },
          doc
            ? h('div', null,
                h('div', null, h('span', { className: 'skb-cat' }, doc.category || '99_待分类'),
                  doc.confidence ? h('span', { className: 'skb-tag' }, `${t('confidence')} ${doc.confidence}`) : null),
                h('h2', { className: 'skb-doc-title' }, doc.title),
                h('div', { className: 'skb-doc-meta' },
                  doc.summary ? h('span', null, `「${doc.summary}」`) : null,
                  h('span', null, `${t('author')}：${doc.author || '—'}`),
                  h('span', null, `${t('updated')}：${formatTime(doc.updatedAt)}`),
                  h('span', null, `${t('version')}：v${doc.version}`),
                  h('button', { className: 'skb-btn', style: { height: '24px', marginLeft: 'auto' }, onClick: removeDoc }, t('delete')),
                ),
                doc.tags && doc.tags.length ? h('div', { style: { marginBottom: '12px' } }, doc.tags.map((tag) => h('span', { className: 'skb-tag', key: tag, style: { marginRight: '6px' } }, tag))) : null,
                doc.points && doc.points.length ? h('div', { style: { marginBottom: '16px', padding: '10px 14px', borderRadius: '8px', background: 'var(--dsw-alias-bg-secondary,#f5f5f5)' } },
                  h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary,#777)', marginBottom: '4px' } }, t('points')),
                  h('ul', { style: { margin: 0, paddingLeft: '20px', fontSize: '13px', lineHeight: 1.7 } }, doc.points.map((p, i) => h('li', { key: i }, p))),
                ) : null,
                h(Markdown, { text: doc.markdown }),
                doc.rawId ? h('p', { style: { marginTop: '18px', fontSize: '11.5px' } },
                  h('a', { href: `${API}/raw?id=${encodeURIComponent(doc.rawId)}${doc.rawName ? `&name=${encodeURIComponent(doc.rawName)}` : ''}` }, `下载原始素材${doc.rawName ? '（' + doc.rawName + '）' : ''}`)) : null,
              )
            : h('div', { className: 'skb-empty' }, loading ? t('loading') : t('empty')),
        ),
      ),
      h('div', { className: 'skb-foot' }, t('footNote')),
      toast ? h('div', { className: 'skb-toast' + (toast.error ? ' err' : '') }, toast.text) : null,
    ),
    dragging ? h('div', { className: 'skb-drop' }, t('dropHere')) : null,
  )
}

function Admin({ t, status, onBack, toast, setToast }) {
  const h = React.createElement
  const [stats, setStats] = React.useState(null)
  const [members, setMembers] = React.useState([])
  const [docs, setDocs] = React.useState([])
  const [raws, setRaws] = React.useState([])
  const [name, setName] = React.useState('')
  const [role, setRole] = React.useState('member')
  const [code, setCode] = React.useState('')
  const [reason, setReason] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [publicUrl, setPublicUrl] = React.useState(status.publicUrl || status.hubUrl || '')
  const isAdmin = status && status.member && status.member.role === 'admin'

  const load = async () => {
    const get = async (p) => { const r = await fetch(API + p); return r.json() }
    try {
      const [s, m, d, i] = await Promise.all([get('/stats'), get('/members'), get('/list?limit=500'), get('/inbox?status=all')])
      if (s.ok) setStats(s.stats)
      if (m.ok) setMembers(m.items || [])
      if (d.ok) setDocs(d.items || [])
      if (i.ok) setRaws(i.items || [])
    } catch (e) { setToast({ error: true, text: String(e.message || e) }) }
  }
  React.useEffect(() => { load() }, [])

  const post = async (path, body) => {
    setBusy(true)
    try {
      const r = await fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const data = await r.json()
      if (!r.ok || data.ok === false) throw new Error(data.error || 'failed')
      await load()
      return data
    } catch (e) { setToast({ error: true, text: String(e.message || e) }); return null } finally { setBusy(false) }
  }

  const addMember = async () => {
    if (!name.trim()) return
    const data = await post('/members', { name: name.trim(), role })
    if (data && data.inviteCode) { setCode(data.inviteCode); setName('') }
  }
  const copy = async (text) => {
    try { await navigator.clipboard.writeText(text); setToast({ text: t('copied') }) } catch { setToast({ error: true, text: 'copy failed' }) }
  }

  if (!isAdmin) {
    return h('div', { className: 'skb-wrap' }, h('style', null, CSS), h('div', { className: 'skb-page' },
      h('div', { className: 'skb-hint' }, h('h2', null, t('adminOnly')), h('button', { className: 'skb-btn', onClick: onBack }, t('back')))))
  }

  return h('div', { className: 'skb-wrap' },
    h('style', null, CSS),
    h('div', { className: 'skb-page' },
      h('header', { className: 'skb-head' },
        h('div', null, h('h1', null, t('adminTitle')), h('div', { className: 'skb-sub' }, status.name || '')),
        h('div', { className: 'skb-meta' }, h('button', { className: 'skb-btn', onClick: onBack }, t('back'))),
      ),
      h('div', { className: 'skb-admin' },
        h('h2', null, '对外地址'),
        h('p', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary,#777)', margin: '0 0 8px' } },
          '邀请码里写的就是这个地址，必须是其他成员能访问到的 Hub 地址（局域网 IP / Tailscale / 内网穿透）。'),
        h('div', { style: { display: 'flex', gap: '8px', marginBottom: '6px' } },
          h('input', { className: 'skb-input', value: publicUrl, onChange: (e) => setPublicUrl(e.target.value), placeholder: 'http://192.168.1.10:8787' }),
          h('button', { className: 'skb-btn', onClick: async () => {
            setBusy(true)
            try {
              const r = await fetch(`${API}/config`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ publicUrl }) })
              const data = await r.json()
              if (!r.ok || data.ok === false) throw new Error(data.error || 'save failed')
              setToast({ text: '已保存对外地址' })
            } catch (e) { setToast({ error: true, text: String(e.message || e) }) } finally { setBusy(false) }
          }, disabled: busy }, '保存'),
        ),
        h('h2', null, t('stats')),
        h('div', { className: 'skb-grid' },
          h('div', { className: 'skb-card' }, t('docs'), h('b', null, stats ? stats.docs : '—')),
          h('div', { className: 'skb-card' }, t('inbox'), h('b', null, stats ? stats.inbox : '—')),
          h('div', { className: 'skb-card' }, t('members'), h('b', null, stats ? stats.members : '—')),
          h('div', { className: 'skb-card' }, '存储', h('b', null, stats ? fmtBytes((stats.docBytes || 0) + (stats.rawBytes || 0)) : '—')),
        ),
        h('h2', null, t('members')),
        h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' } },
          h('input', { className: 'skb-input', style: { minWidth: '160px' }, placeholder: t('namePlaceholder'), value: name, onChange: (e) => setName(e.target.value) }),
          h('select', { className: 'skb-select', value: role, onChange: (e) => setRole(e.target.value) },
            h('option', { value: 'member' }, t('roleMember')), h('option', { value: 'admin' }, t('roleAdmin'))),
          h('button', { className: 'skb-btn primary', onClick: addMember, disabled: busy }, t('addMember')),
        ),
        code ? h('div', { className: 'skb-code-box' },
          h('textarea', { readOnly: true, value: code }),
          h('button', { className: 'skb-btn', onClick: () => copy(code) }, t('copy')),
        ) : null,
        code ? h('p', { style: { fontSize: '11.5px', color: 'var(--dsw-alias-label-secondary,#777)' } }, t('inviteCode')) : null,
        h('table', { className: 'skb-table' },
          h('thead', null, h('tr', null, h('th', null, '名字'), h('th', null, '角色'), h('th', null, ''))),
          h('tbody', null, members.map((m) => h('tr', { key: m.name },
            h('td', null, m.name), h('td', null, m.role === 'admin' ? t('roleAdmin') : t('roleMember')),
            h('td', null, h('div', { className: 'skb-row-actions' },
              h('button', { className: 'skb-btn', onClick: async () => {
                if (!window.confirm(t('confirmRotate'))) return
                const data = await post('/members/rotate', { name: m.name })
                if (data && data.inviteCode) setCode(data.inviteCode)
              } }, t('rotate')),
              m.name === (status.member && status.member.name) ? null : h('button', { className: 'skb-btn danger', onClick: async () => {
                if (!window.confirm(t('confirmRemove'))) return
                await post('/members/remove', { name: m.name })
              } }, t('remove')),
            )),
          ))),
        ),
        h('h2', null, `${t('docList')}（${docs.length}）`),
        docs.length ? h('table', { className: 'skb-table' },
          h('thead', null, h('tr', null, h('th', null, '标题'), h('th', null, t('category')), h('th', null, t('author')), h('th', null, ''))),
          h('tbody', null, docs.map((d) => h('tr', { key: d.id },
            h('td', null, d.title), h('td', null, d.category), h('td', null, d.author),
            h('td', null, h('button', { className: 'skb-btn danger', onClick: async () => {
              if (!window.confirm(t('confirmDelete'))) return
              await post('/delete', { id: d.id })
            } }, t('delete'))),
          ))),
        ) : h('div', { className: 'skb-empty' }, t('noData')),
        h('h2', null, `${t('rawList')}（${raws.length}）`),
        raws.length ? h('table', { className: 'skb-table' },
          h('thead', null, h('tr', null, h('th', null, '文件'), h('th', null, '状态'), h('th', null, t('author')), h('th', null, ''))),
          h('tbody', null, raws.map((r) => h('tr', { key: r.id },
            h('td', null, r.name), h('td', null, r.status === 'archived' ? '已成文' : r.status === 'skipped' ? '已跳过' : '待整理'), h('td', null, r.author),
            h('td', null, h('div', { className: 'skb-row-actions' },
              r.status === 'new' ? h('button', { className: 'skb-btn', onClick: async () => {
                const why = window.prompt(t('skipReason'), reason || '')
                if (why === null) return
                await post('/raw/skip', { id: r.id, reason: why })
              } }, t('skip')) : null,
              r.status === 'archived' ? null : h('button', { className: 'skb-btn danger', onClick: async () => {
                if (!window.confirm(t('deleteRaw') + '?')) return
                await post('/raw/delete', { id: r.id })
              } }, t('deleteRaw')),
            )),
          ))),
        ) : h('div', { className: 'skb-empty' }, t('noData')),
      ),
      toast ? h('div', { className: 'skb-toast' + (toast.error ? ' err' : '') }, toast.text) : null,
    ),
  )
}

function PanelIcon({ size = 18, active = false }) {
  return React.createElement('svg', {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
    'aria-hidden': true,
  },
    React.createElement('path', { d: 'M4 5.5A2.5 2.5 0 0 1 6.5 3H19v16H6.5A2.5 2.5 0 0 0 4 21.5z' }),
    React.createElement('path', { d: 'M4 18.5A2.5 2.5 0 0 1 6.5 16H19' }),
    React.createElement('path', { d: 'M9 7h6M9 10.5h4' }),
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
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: 'shared-kb', order: 6, label: () => t('panel'),
        }, (props) => React.createElement(PanelIcon, props)))
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'shared-kb' }, () => React.createElement(Page, { t })))
      },
    }
  },
})
