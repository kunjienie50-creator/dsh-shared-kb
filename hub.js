#!/usr/bin/env node
'use strict'

/**
 * dsh-shared-kb — Hub server（团队知识库中心）
 *
 * 一台常开的机器跑它；成员用 DSH 插件连上来。零第三方依赖。
 *
 *   node hub.js --data ./data --port 8787 --host 0.0.0.0
 *   node hub.js --data ./data --add-member 张三 --admin     # 打印邀请码
 *   node hub.js --data ./data --add-member 李四
 *   node hub.js --data ./data --list-members
 *   node hub.js --data ./data --remove-member 李四
 *   node hub.js --data ./data --rotate 李四
 *
 * 数据：
 *   config.json      成员、令牌、库名（含密钥，注意权限）
 *   state.json       每成员的收藏夹 / 已读 / 置顶确认 / 周报时间 / @已读
 *   docs/<id>.json   规范化文档 + 历史版本
 *   comments/<id>.json  某文档的评论流
 *   raw/<id>.json    原始素材元数据（sha256 去重、status）
 *   raw/<id>.bin     原始字节
 *   audit.jsonl      管理操作流水（增删成员、删除素材…）
 */

const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const os = require('node:os')

const VERSION = '0.3.0'
const MAX_UPLOAD = 64 * 1024 * 1024
const MAX_BODY = 16 * 1024 * 1024
const MAX_VERSIONS = 20
const SUMMARY_MAX = 10
const RECOMMEND_MIN = 10
const RECOMMEND_MAX = 200
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

const CATEGORIES = [
  '01_票据报销',
  '02_证件资质',
  '03_合同协议',
  '04_工作项目',
  '05_学习资料',
  '06_灵感创意',
  '07_图文素材',
  '08_人脉联络',
  '09_生活事务',
  '10_待办提醒',
  '99_待分类',
]

// ---------------------------------------------------------------- utilities

function nowIso() { return new Date().toISOString() }

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }) }

/** 读 JSON。刻意剥掉 UTF-8 BOM —— 记事本存过的 config.json 曾因此静默丢成员表。 */
function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
  } catch { return fallback }
}

function writeJsonAtomic(file, value) {
  ensureDir(path.dirname(file))
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2))
  fs.renameSync(tmp, file)
}

function safeName(name) {
  const base = String(name || 'file').split(/[\\/]/).pop() || 'file'
  return base.replace(/[\u0000-\u001f<>:"|?*]/g, '_').slice(0, 180)
}

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`
}

function constantEqual(a, b) {
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  if (x.length !== y.length) return false
  return crypto.timingSafeEqual(x, y)
}

function sendJson(res, status, value, extra) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    ...(extra || {}),
  })
  res.end(body)
}

function readBody(req, cap) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > cap) {
        reject(Object.assign(new Error('body too large'), { status: 413 }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

async function readJsonBody(req, cap) {
  const raw = (await readBody(req, cap || MAX_BODY)).toString('utf8').replace(/^\uFEFF/, '')
  try { return JSON.parse(raw || '{}') } catch { throw Object.assign(new Error('请求体不是合法 JSON'), { status: 400 }) }
}

function decodeHeader(value, fallback = '') {
  try { return decodeURIComponent(String(value || fallback)) } catch { return String(value || fallback) }
}

function bad(status, message, extra) {
  return Object.assign(new Error(message), { status, ...(extra || {}) })
}

function splitList(value, cap = 40) {
  if (Array.isArray(value)) return value.map((t) => String(t).trim()).filter(Boolean).slice(0, cap)
  return String(value || '').split(/[,，]/).map((t) => String(t).trim()).filter(Boolean).slice(0, cap)
}

// ---------------------------------------------------------------- search

function tokenize(text) {
  const norm = String(text || '').toLowerCase()
  const out = []
  for (const word of norm.match(/[a-z0-9][a-z0-9_\-.]{1,}/g) || []) out.push(word)
  for (const seg of norm.match(/[\u3400-\u4dbf\u4e00-\u9fff]+/g) || []) {
    if (seg.length === 1) out.push(seg)
    for (let i = 0; i < seg.length - 1; i++) out.push(seg.slice(i, i + 2))
  }
  return [...new Set(out)]
}

function countOf(haystack, needle) {
  if (!needle) return 0
  let n = 0
  let i = 0
  for (;;) {
    const at = haystack.indexOf(needle, i)
    if (at < 0) return n
    n += 1
    i = at + needle.length
  }
}

function snippetOf(text, query) {
  const plain = String(text || '').replace(/\s+/g, ' ')
  const lower = plain.toLowerCase()
  const terms = tokenize(query).sort((a, b) => b.length - a.length)
  let at = -1
  for (const term of terms) {
    const i = lower.indexOf(term)
    if (i >= 0) { at = i; break }
  }
  if (at < 0) return plain.slice(0, 160)
  const start = Math.max(0, at - 60)
  const end = Math.min(plain.length, at + 120)
  return `${start > 0 ? '…' : ''}${plain.slice(start, end)}${end < plain.length ? '…' : ''}`
}

function scoreDoc(doc, query) {
  const terms = tokenize(query)
  if (!terms.length) return 0
  const title = String(doc.title || '').toLowerCase()
  const summary = `${doc.summary || ''} ${(doc.points || []).join(' ')}`.toLowerCase()
  const tags = `${(doc.tags || []).join(' ')} ${doc.category || ''}`.toLowerCase()
  const body = String(doc.markdown || '').toLowerCase()
  let score = 0
  for (const term of terms) {
    score += countOf(title, term) * 6
    score += countOf(tags, term) * 4
    score += countOf(summary, term) * 2
    score += Math.min(countOf(body, term), 20)
  }
  return score
}

// ---------------------------------------------------------------- store

class Store {
  constructor(root) {
    this.root = path.resolve(root)
    this.docsDir = path.join(this.root, 'docs')
    this.rawDir = path.join(this.root, 'raw')
    this.commentsDir = path.join(this.root, 'comments')
    this.configFile = path.join(this.root, 'config.json')
    this.stateFile = path.join(this.root, 'state.json')
    this.auditFile = path.join(this.root, 'audit.jsonl')
    ensureDir(this.docsDir)
    ensureDir(this.rawDir)
    ensureDir(this.commentsDir)
    this.config = readJson(this.configFile, null)
    if (!this.config) {
      this.config = { name: '团队共享知识库', createdAt: nowIso(), members: [] }
      writeJsonAtomic(this.configFile, this.config)
    }
    if (!Array.isArray(this.config.members)) this.config.members = []
    this.state = readJson(this.stateFile, null)
    if (!this.state || typeof this.state !== 'object') this.state = { members: {} }
    if (!this.state.members || typeof this.state.members !== 'object') this.state.members = {}
    this.docs = new Map()
    this.raw = new Map()
    this.rawBySha = new Map()
    this.comments = new Map()
    this.load()
  }

  load() {
    this.docs.clear()
    for (const file of fs.readdirSync(this.docsDir)) {
      if (!file.endsWith('.json')) continue
      const doc = readJson(path.join(this.docsDir, file), null)
      if (doc && doc.id) this.docs.set(doc.id, doc)
    }
    this.raw.clear()
    this.rawBySha.clear()
    for (const file of fs.readdirSync(this.rawDir)) {
      if (!file.endsWith('.json')) continue
      const meta = readJson(path.join(this.rawDir, file), null)
      if (!meta || !meta.id) continue
      this.raw.set(meta.id, meta)
      if (meta.sha256) this.rawBySha.set(meta.sha256, meta)
    }
    this.comments.clear()
    for (const file of fs.readdirSync(this.commentsDir)) {
      if (!file.endsWith('.json')) continue
      const list = readJson(path.join(this.commentsDir, file), null)
      if (Array.isArray(list) && list.length) this.comments.set(file.replace(/\.json$/, ''), list)
    }
  }

  saveConfig() { writeJsonAtomic(this.configFile, this.config) }

  saveState() { writeJsonAtomic(this.stateFile, this.state) }

  audit(actor, action, detail) {
    try {
      fs.appendFileSync(this.auditFile, JSON.stringify({ at: nowIso(), actor, action, detail }) + '\n')
    } catch { /* best effort */ }
  }

  readAudit(limit) {
    try {
      const lines = fs.readFileSync(this.auditFile, 'utf8').split(/\r?\n/).filter(Boolean)
      return lines.slice(-limit).reverse().map((line) => {
        try { return JSON.parse(line) } catch { return { raw: line } }
      })
    } catch { return [] }
  }

  memberByToken(token) {
    if (!token) return null
    for (const member of this.config.members) {
      if (constantEqual(member.token, token)) return member
    }
    return null
  }

  // -------------------------------------------------------------- member state

  memberState(name) {
    const key = String(name || '')
    let s = this.state.members[key]
    if (!s || typeof s !== 'object') {
      s = { collections: [], ackedImportant: [], readDocs: {}, weeklySeenAt: '', mentionSeenAt: '' }
      this.state.members[key] = s
    }
    if (!Array.isArray(s.collections)) s.collections = []
    if (!Array.isArray(s.ackedImportant)) s.ackedImportant = []
    if (!s.readDocs || typeof s.readDocs !== 'object') s.readDocs = {}
    if (typeof s.weeklySeenAt !== 'string') s.weeklySeenAt = ''
    if (typeof s.mentionSeenAt !== 'string') s.mentionSeenAt = ''
    return s
  }

  hasRead(name, docId) {
    return Boolean(this.memberState(name).readDocs[docId])
  }

  markRead(name, docId) {
    const s = this.memberState(name)
    if (s.readDocs[docId]) return false
    s.readDocs[docId] = nowIso()
    this.saveState()
    return true
  }

  pruneReads(docId) {
    for (const key of Object.keys(this.state.members)) {
      const s = this.state.members[key]
      if (s && s.readDocs && s.readDocs[docId]) delete s.readDocs[docId]
      if (s && Array.isArray(s.ackedImportant)) s.ackedImportant = s.ackedImportant.filter((id) => id !== docId)
      if (s && Array.isArray(s.collections)) {
        for (const col of s.collections) col.docIds = (col.docIds || []).filter((id) => id !== docId)
      }
    }
  }

  // -------------------------------------------------------------- members

  addMember(name, role) {
    const clean = String(name || '').trim()
    if (!clean) throw bad(400, '成员名不能为空')
    if (this.config.members.some((m) => m.name === clean)) throw bad(409, `成员已存在：${clean}`)
    const member = {
      name: clean,
      role: role === 'admin' ? 'admin' : 'member',
      token: crypto.randomBytes(24).toString('base64url'),
      createdAt: nowIso(),
    }
    this.config.members.push(member)
    this.saveConfig()
    return member
  }

  removeMember(name, actor) {
    const target = this.config.members.find((m) => m.name === name)
    if (!target) throw bad(404, `成员不存在：${name}`)
    if (name === actor) throw bad(400, '不能移除自己')
    const admins = this.config.members.filter((m) => m.role === 'admin')
    if (target.role === 'admin' && admins.length <= 1) throw bad(400, '至少保留一个管理员')
    this.config.members = this.config.members.filter((m) => m.name !== name)
    this.saveConfig()
    this.audit(actor, 'remove-member', { name })
  }

  rotate(name, actor) {
    const member = this.config.members.find((m) => m.name === name)
    if (!member) throw bad(404, `成员不存在：${name}`)
    member.token = crypto.randomBytes(24).toString('base64url')
    this.saveConfig()
    this.audit(actor, 'rotate-token', { name })
    return member
  }

  // -------------------------------------------------------------- docs

  commentCount(docId) {
    const list = this.comments.get(docId) || []
    return list.filter((c) => !c.deleted).length
  }

  meta(doc) {
    return {
      id: doc.id,
      title: doc.title,
      summary: doc.summary || '',
      description: doc.description || '',
      category: doc.category || '99_待分类',
      confidence: doc.confidence || '',
      tags: doc.tags || [],
      points: doc.points || [],
      author: doc.author || '',
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      rawId: doc.rawId || '',
      rawName: doc.rawId && this.raw.get(doc.rawId) ? this.raw.get(doc.rawId).name : '',
      sha256: doc.sha256 || '',
      bytes: Buffer.byteLength(doc.markdown || '', 'utf8'),
      version: doc.version || 1,
      important: Boolean(doc.important),
      recommend: doc.recommend || '',
      importantAt: doc.importantAt || '',
      importantBy: doc.importantBy || '',
      comments: this.commentCount(doc.id),
    }
  }

  /** 一个文档对某个观看者的完整视图：是否读过、我在哪些收藏夹里。 */
  view(meta, viewer) {
    if (!viewer) return { ...meta, read: false, acked: false, inCollections: [] }
    const s = this.memberState(viewer)
    const inCollections = s.collections.filter((c) => (c.docIds || []).includes(meta.id)).map((c) => c.id)
    return {
      ...meta,
      read: Boolean(s.readDocs[meta.id]),
      acked: s.ackedImportant.includes(meta.id),
      inCollections,
    }
  }

  listDocs({ category, tag, author, important, collection, sort, limit = 50, offset = 0, viewer } = {}) {
    let docs = [...this.docs.values()]
    if (category) docs = docs.filter((d) => (d.category || '99_待分类') === category)
    if (tag) docs = docs.filter((d) => (d.tags || []).includes(tag))
    if (author) docs = docs.filter((d) => (d.author || '') === author)
    if (important === 'only' || important === true) docs = docs.filter((d) => Boolean(d.important))
    if (important === 'exclude') docs = docs.filter((d) => !d.important)
    if (collection) {
      const s = this.memberState(viewer)
      const col = s.collections.find((c) => c.id === collection)
      if (!col) throw bad(404, '收藏夹不存在')
      const ids = new Set(col.docIds || [])
      docs = docs.filter((d) => ids.has(d.id))
    }
    if (sort === 'created') docs.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    else if (sort === 'important') {
      docs.sort((a, b) => {
        const ai = a.important ? 1 : 0
        const bi = b.important ? 1 : 0
        if (ai !== bi) return bi - ai
        return String(b.importantAt || b.updatedAt).localeCompare(String(a.importantAt || a.updatedAt))
      })
    } else docs.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))

    const total = docs.length
    const items = docs.slice(offset, offset + limit).map((d) => this.view(this.meta(d), viewer))
    return { total, items, authors: this.authors() }
  }

  authors() {
    const counts = new Map()
    for (const doc of this.docs.values()) {
      const name = doc.author || '未知'
      counts.set(name, (counts.get(name) || 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }))
  }

  getDoc(id, viewer) {
    const doc = this.docs.get(String(id))
    if (!doc) return null
    return {
      ...this.view(this.meta(doc), viewer),
      markdown: doc.markdown,
      versions: (doc.versions || []).map((v) => ({
        version: v.version,
        updatedAt: v.updatedAt,
        author: v.author,
        summary: v.summary || '',
        bytes: Buffer.byteLength(v.markdown || '', 'utf8'),
      })),
    }
  }

  history(id, viewer) {
    const doc = this.docs.get(String(id))
    if (!doc) throw bad(404, '文档不存在')
    return {
      id: doc.id,
      title: doc.title,
      current: { version: doc.version || 1, markdown: doc.markdown, updatedAt: doc.updatedAt, author: doc.author },
      versions: (doc.versions || []).map((v) => ({
        version: v.version, markdown: v.markdown, updatedAt: v.updatedAt, author: v.author, summary: v.summary || '',
      })),
    }
  }

  search(query, { limit = 20, category, author, important, compact, viewer } = {}) {
    const q = String(query || '').trim()
    if (!q) return { total: 0, items: [] }
    const scored = []
    for (const doc of this.docs.values()) {
      if (category && (doc.category || '99_待分类') !== category) continue
      if (author && (doc.author || '') !== author) continue
      if ((important === 'only' || important === true) && !doc.important) continue
      if (important === 'exclude' && doc.important) continue
      const score = scoreDoc(doc, q)
      if (score > 0) scored.push({ doc, score })
    }
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      const ai = a.doc.important ? 1 : 0
      const bi = b.doc.important ? 1 : 0
      if (ai !== bi) return bi - ai
      return String(b.doc.updatedAt).localeCompare(String(a.doc.updatedAt))
    })
    const items = scored.slice(0, limit).map(({ doc, score }) => {
      const base = this.view(this.meta(doc), viewer)
      if (compact) {
        return {
          id: base.id, title: base.title, summary: base.summary, category: base.category,
          important: base.important, author: base.author, updatedAt: base.updatedAt, score,
        }
      }
      return { ...base, score, snippet: snippetOf(doc.markdown, q) }
    })
    return { total: scored.length, items }
  }

  /** 主题聚合：把命中的多篇压成「摘要 + 要点」的紧凑回答，替代逐个读全文。 */
  recall(topic, { limit = 6, category, viewer, maxChars = 2400 } = {}) {
    const hits = this.search(topic, { limit, category, viewer })
    const parts = []
    let used = 0
    for (const item of hits.items) {
      const line = [
        `· ${item.title}`,
        `  [${item.category}]${item.important ? ' ★重要' : ''}${item.author ? ' · ' + item.author : ''}${item.summary ? ' · ' + item.summary : ''}`,
        ...(item.points || []).map((p) => `  - ${p}`),
        item.recommend ? `  推荐语：${item.recommend}` : '',
        item.snippet ? `  摘录：${item.snippet}` : '',
      ].filter(Boolean).join('\n')
      if (used + line.length > maxChars) break
      parts.push(line)
      used += line.length
    }
    return {
      topic: String(topic || ''),
      total: hits.total,
      returned: parts.length,
      digest: parts.join('\n\n'),
      note: parts.length < hits.total ? `另有 ${hits.total - parts.length} 篇未展开，可再用 skb_search 收窄或加分类过滤。` : '',
    }
  }

  putDoc(input, author) {
    const id = input.id ? String(input.id) : newId('doc')
    const existing = this.docs.get(id)
    // 允许「只改元数据」的局部提交：没带 title / markdown 就沿用现有值
    const title = (String(input.title || '').trim() || (existing && existing.title) || '').slice(0, 200)
    const markdown = String(input.markdown || '')
    if (!title) throw bad(400, 'title 必填')
    if (!markdown.trim() && !existing) throw bad(400, 'markdown 必填')

    // 冲突检测：客户端提交时带着它看到的版本号
    const baseVersion = Number(input.baseVersion)
    if (existing && Number.isFinite(baseVersion) && baseVersion > 0 && (existing.version || 1) > baseVersion) {
      throw bad(409, `文档已被 ${existing.author || '他人'} 更新到 v${existing.version}，你看到的是 v${baseVersion}。请合并后重提。`, {
        conflict: true,
        latest: this.meta(existing),
      })
    }

    const stamp = nowIso()
    // 局部提交（只改分类/推荐语等）时，没传的字段沿用现有值，不能把标签与要点清空
    const tags = input.tags === undefined
      ? (existing && Array.isArray(existing.tags) ? existing.tags.slice() : [])
      : splitList(input.tags)
    const points = Array.isArray(input.points)
      ? input.points.map((p) => String(p).trim()).filter(Boolean).slice(0, 12)
      : (existing && Array.isArray(existing.points) ? existing.points.slice() : [])
    const category = CATEGORIES.includes(String(input.category))
      ? String(input.category)
      : (existing && existing.category) || '99_待分类'

    // 重要性 + 推荐语：标重要就必须手写推荐语，这是「防滥发」的硬闸门
    const wantImportant = input.important === undefined ? Boolean(existing && existing.important) : Boolean(input.important)
    let recommend = String(input.recommend || (existing && existing.recommend) || '').trim().slice(0, RECOMMEND_MAX)
    if (wantImportant) {
      if ([...recommend].length < RECOMMEND_MIN) {
        throw bad(400, `标记为重要必须手写推荐语，至少 ${RECOMMEND_MIN} 字（当前 ${[...recommend].length} 字）`)
      }
    } else {
      recommend = ''
    }

    if (!input.id) {
      const same = [...this.docs.values()].find((d) => d.title === title && (d.category || '99_待分类') === category)
      if (same) throw bad(409, `已存在同名文档《${same.title}》（id: ${same.id}），请用该 id 更新，或换个标题`, { existingId: same.id })
    }

    const body = markdown.trim() ? markdown : (existing ? existing.markdown : '')
    // 只有正文真的变了才产生新版本；纯元数据编辑（改分类/标签/推荐语）不制造噪音版本
    const bodyChanged = !existing || body !== existing.markdown
    let versions = existing && Array.isArray(existing.versions) ? existing.versions.slice() : []
    if (existing && bodyChanged) {
      versions.unshift({
        version: existing.version || 1,
        updatedAt: existing.updatedAt,
        author: existing.author,
        summary: existing.summary || '',
        markdown: existing.markdown,
      })
      versions = versions.slice(0, MAX_VERSIONS)
    }

    const wasImportant = Boolean(existing && existing.important)
    const doc = {
      id,
      title,
      summary: [...String(input.summary === undefined ? (existing && existing.summary) || '' : input.summary).trim()].slice(0, SUMMARY_MAX).join(''),
      description: String(input.description === undefined ? (existing && existing.description) || '' : input.description).trim().slice(0, 500),
      category,
      confidence: ['高', '中', '低'].includes(String(input.confidence))
        ? String(input.confidence)
        : (existing && existing.confidence) || '',
      tags,
      points,
      author: (existing && existing.author) || author || String(input.author || 'unknown'),
      rawId: input.rawId ? String(input.rawId) : (existing && existing.rawId) || '',
      sha256: input.sha256
        ? String(input.sha256)
        : (existing && existing.sha256) || (input.rawId && this.raw.get(String(input.rawId)) ? this.raw.get(String(input.rawId)).sha256 : '') || '',
      important: wantImportant,
      recommend,
      importantAt: wantImportant ? (wasImportant ? (existing && existing.importantAt) || stamp : stamp) : '',
      importantBy: wantImportant ? (wasImportant ? (existing && existing.importantBy) || author : author) : '',
      createdAt: (existing && existing.createdAt) || stamp,
      updatedAt: stamp,
      version: existing ? (existing.version || 1) + (bodyChanged ? 1 : 0) : 1,
      markdown: body,
      versions,
    }
    this.docs.set(id, doc)
    writeJsonAtomic(path.join(this.docsDir, `${id}.json`), doc)
    if (doc.rawId) {
      const raw = this.raw.get(doc.rawId)
      if (raw && raw.status !== 'archived') {
        raw.status = 'archived'
        writeJsonAtomic(path.join(this.rawDir, `${raw.id}.json`), raw)
      }
    }
    if (wantImportant && !wasImportant) {
      this.audit(author, 'mark-important', { id, title, recommend })
    }
    return this.meta(doc)
  }

  restoreDoc(id, version, actor) {
    const doc = this.docs.get(String(id))
    if (!doc) throw bad(404, '文档不存在')
    const target = (doc.versions || []).find((v) => v.version === Number(version))
    if (!target) throw bad(404, `版本 v${version} 不存在`)
    doc.versions = [
      { version: doc.version || 1, updatedAt: doc.updatedAt, author: doc.author, summary: doc.summary || '', markdown: doc.markdown },
      ...(doc.versions || []),
    ].slice(0, MAX_VERSIONS)
    doc.markdown = target.markdown
    doc.summary = target.summary || doc.summary
    doc.version = (doc.version || 1) + 1
    doc.updatedAt = nowIso()
    writeJsonAtomic(path.join(this.docsDir, `${doc.id}.json`), doc)
    this.audit(actor, 'restore-doc', { id: doc.id, version: Number(version) })
    return this.meta(doc)
  }

  deleteDoc(id, actor, role) {
    const doc = this.docs.get(String(id))
    if (!doc) return false
    if (role !== 'admin' && doc.author !== actor) throw bad(403, '只能删除自己创建的文档')
    this.docs.delete(doc.id)
    try { fs.unlinkSync(path.join(this.docsDir, `${doc.id}.json`)) } catch { /* ignore */ }
    try { fs.unlinkSync(path.join(this.commentsDir, `${doc.id}.json`)) } catch { /* ignore */ }
    this.comments.delete(doc.id)
    this.pruneReads(doc.id)
    this.saveState()
    this.audit(actor, 'delete-doc', { id: doc.id, title: doc.title })
    return true
  }

  batchDelete(ids, actor, role) {
    const results = []
    for (const id of ids) {
      const doc = this.docs.get(String(id))
      if (!doc) { results.push({ id, ok: false, error: '文档不存在' }); continue }
      if (role !== 'admin' && doc.author !== actor) {
        results.push({ id, ok: false, error: '只能删除自己创建的文档' })
        continue
      }
      try {
        this.deleteDoc(id, actor, role)
        results.push({ id, ok: true, title: doc.title })
      } catch (error) {
        results.push({ id, ok: false, error: String((error && error.message) || error) })
      }
    }
    // 批量操作是「多状态结果」：顶层 ok 表示请求已处理，逐条结果看 results/failed。
    // 早期写成 results.every(r => r.ok) 会让部分失败整体变成 ok:false，
    // 客户端反而拿不到「哪几条失败、为什么」。
    return {
      ok: true,
      deleted: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    }
  }

  // -------------------------------------------------------------- important

  /** 当前成员还没「读完并取消」的重要文档。读完但没点取消的也列出来，标 read:true 让他能关掉。 */
  importantFor(viewer) {
    const s = this.memberState(viewer)
    const acked = new Set(s.ackedImportant)
    const items = [...this.docs.values()]
      .filter((d) => d.important && !acked.has(d.id))
      .sort((a, b) => String(b.importantAt || b.updatedAt).localeCompare(String(a.importantAt || a.updatedAt)))
    return items.map((d) => this.view(this.meta(d), viewer))
  }

  ackImportant(id, actor) {
    const doc = this.docs.get(String(id))
    if (!doc) throw bad(404, '文档不存在')
    if (!doc.important) throw bad(400, '该文档不是重要资料')
    const s = this.memberState(actor)
    if (!s.readDocs[id]) throw bad(409, '请先打开阅读，读完才能取消置顶', { needRead: true })
    if (!s.ackedImportant.includes(id)) {
      s.ackedImportant.push(id)
      this.saveState()
    }
    return { ok: true, id, readAt: s.readDocs[id] }
  }

  // -------------------------------------------------------------- collections

  collectionList(viewer) {
    const s = this.memberState(viewer)
    return s.collections.map((c) => {
      const ids = c.docIds || []
      const resolved = ids.filter((id) => this.docs.has(id)).length
      return {
        id: c.id,
        name: c.name,
        createdAt: c.createdAt,
        count: resolved,
        unresolved: ids.length - resolved,
      }
    })
  }

  collectionOp(viewer, payload) {
    const s = this.memberState(viewer)
    const action = String(payload.action || '')
    const name = String(payload.name || '').trim().slice(0, 40)
    if (action === 'create') {
      if (!name) throw bad(400, '收藏夹名不能为空')
      if (s.collections.some((c) => c.name === name)) throw bad(409, `收藏夹已存在：${name}`)
      const col = { id: newId('col'), name, createdAt: nowIso(), docIds: [] }
      s.collections.push(col)
      this.saveState()
      return { ok: true, collection: { id: col.id, name: col.name, count: 0, unresolved: 0 } }
    }
    const col = s.collections.find((c) => c.id === String(payload.collectionId || '') || c.name === name)
    if (!col) throw bad(404, '收藏夹不存在')
    if (action === 'rename') {
      if (!name) throw bad(400, '新名字不能为空')
      if (s.collections.some((c) => c !== col && c.name === name)) throw bad(409, `收藏夹已存在：${name}`)
      col.name = name
      this.saveState()
      return { ok: true, collection: { id: col.id, name: col.name } }
    }
    if (action === 'remove') {
      s.collections = s.collections.filter((c) => c !== col)
      this.saveState()
      return { ok: true, removed: col.id }
    }
    if (action === 'add') {
      const ids = Array.isArray(payload.ids) ? payload.ids.map(String) : [String(payload.id || '')].filter(Boolean)
      let added = 0
      for (const id of ids) {
        if (!id) continue
        if (!col.docIds.includes(id)) { col.docIds.push(id); added += 1 }
      }
      this.saveState()
      return { ok: true, added, total: col.docIds.length }
    }
    if (action === 'remove-doc') {
      const ids = new Set(Array.isArray(payload.ids) ? payload.ids.map(String) : [String(payload.id || '')].filter(Boolean))
      const before = col.docIds.length
      col.docIds = col.docIds.filter((id) => !ids.has(id))
      this.saveState()
      return { ok: true, removed: before - col.docIds.length, total: col.docIds.length }
    }
    throw bad(400, '未知收藏夹动作：' + action)
  }

  // -------------------------------------------------------------- comments

  commentList(docId) {
    const list = this.comments.get(String(docId)) || []
    return list.filter((c) => !c.deleted)
  }

  addComment(docId, text, author) {
    const doc = this.docs.get(String(docId))
    if (!doc) throw bad(404, '文档不存在')
    const body = String(text || '').trim().slice(0, 2000)
    if (!body) throw bad(400, '评论不能为空')
    const mentions = []
    for (const member of this.config.members) {
      if (member.name && body.includes('@' + member.name) && member.name !== author) mentions.push(member.name)
    }
    const comment = { id: newId('cmt'), author, text: body, mentions, at: nowIso(), deleted: false }
    const list = this.comments.get(doc.id) || []
    list.push(comment)
    this.comments.set(doc.id, list)
    writeJsonAtomic(path.join(this.commentsDir, `${doc.id}.json`), list)
    return comment
  }

  deleteComment(docId, commentId, actor, role) {
    const list = this.comments.get(String(docId)) || []
    const comment = list.find((c) => c.id === String(commentId))
    if (!comment) throw bad(404, '评论不存在')
    if (role !== 'admin' && comment.author !== actor) throw bad(403, '只能删除自己的评论')
    comment.deleted = true
    writeJsonAtomic(path.join(this.commentsDir, `${String(docId)}.json`), list)
    this.audit(actor, 'delete-comment', { docId, commentId })
    return { ok: true }
  }

  /** 我被 @ 的评论（晚于上次查看时间）。 */
  mentionsFor(viewer) {
    const s = this.memberState(viewer)
    const since = s.mentionSeenAt || ''
    const out = []
    for (const [docId, list] of this.comments) {
      const doc = this.docs.get(docId)
      if (!doc) continue
      for (const c of list) {
        if (c.deleted) continue
        if (!(c.mentions || []).includes(viewer)) continue
        if (since && String(c.at) <= since) continue
        out.push({ docId, docTitle: doc.title, comment: c })
      }
    }
    out.sort((a, b) => String(b.comment.at).localeCompare(String(a.comment.at)))
    return out.slice(0, 100)
  }

  markMentionsSeen(viewer) {
    const s = this.memberState(viewer)
    s.mentionSeenAt = nowIso()
    this.saveState()
    return { ok: true, mentionSeenAt: s.mentionSeenAt }
  }

  // -------------------------------------------------------------- weekly

  weekly(viewer) {
    const now = Date.now()
    const since = new Date(now - WEEK_MS).toISOString()
    const docs = [...this.docs.values()]
    const fresh = docs.filter((d) => String(d.createdAt) >= since)
    const updatedOnly = docs.filter((d) => String(d.createdAt) < since && String(d.updatedAt) >= since)
    const important = docs.filter((d) => d.important && String(d.importantAt || d.updatedAt) >= since)
    const byCategory = {}
    for (const c of CATEGORIES) byCategory[c] = 0
    for (const d of fresh) byCategory[d.category || '99_待分类'] = (byCategory[d.category || '99_待分类'] || 0) + 1
    const byAuthor = {}
    for (const d of [...fresh, ...updatedOnly]) {
      const key = d.author || '未知'
      byAuthor[key] = (byAuthor[key] || 0) + 1
    }
    const s = this.memberState(viewer)
    const lastSeen = s.weeklySeenAt || ''
    return {
      since,
      now: new Date(now).toISOString(),
      newCount: fresh.length,
      updatedCount: updatedOnly.length,
      importantCount: important.length,
      byCategory,
      byAuthor,
      newDocs: fresh.slice(0, 20).map((d) => this.meta(d)),
      importantDocs: important.slice(0, 20).map((d) => this.meta(d)),
      lastSeenAt: lastSeen,
      due: fresh.length + important.length > 0 && (!lastSeen || now - Date.parse(lastSeen) >= WEEK_MS),
    }
  }

  markWeeklySeen(viewer) {
    const s = this.memberState(viewer)
    s.weeklySeenAt = nowIso()
    this.saveState()
    return { ok: true, weeklySeenAt: s.weeklySeenAt }
  }

  // -------------------------------------------------------------- raw

  putRaw({ name, title, tags, author, bytes, important, recommend, pending }) {
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex')
    const duplicate = this.rawBySha.get(sha256)
    if (duplicate) {
      const doc = [...this.docs.values()].find((d) => d.rawId === duplicate.id)
      return { duplicate: true, raw: duplicate, doc: doc ? this.meta(doc) : null }
    }
    const id = newId('raw')
    const meta = {
      id,
      name: safeName(name),
      title: String(title || name || '').slice(0, 300),
      tags: splitList(tags),
      author: String(author || 'unknown'),
      bytes: bytes.length,
      sha256,
      status: 'new',
      skipReason: '',
      important: Boolean(important),
      recommend: String(recommend || '').slice(0, RECOMMEND_MAX),
      pending: Boolean(pending),
      createdAt: nowIso(),
    }
    writeJsonAtomic(path.join(this.rawDir, `${id}.json`), meta)
    fs.writeFileSync(path.join(this.rawDir, `${id}.bin`), bytes)
    this.raw.set(id, meta)
    this.rawBySha.set(sha256, meta)
    return { duplicate: false, raw: meta, doc: null }
  }

  getRaw(id) {
    const meta = this.raw.get(String(id))
    if (!meta) return null
    try {
      return { meta, bytes: fs.readFileSync(path.join(this.rawDir, `${meta.id}.bin`)) }
    } catch { return null }
  }

  listRaw({ status, author, limit = 200 } = {}) {
    let items = [...this.raw.values()]
    if (status) items = items.filter((r) => (r.status || 'new') === status)
    if (author) items = items.filter((r) => (r.author || '') === author)
    items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    return items.slice(0, limit)
  }

  skipRaw(id, reason, actor) {
    const meta = this.raw.get(String(id))
    if (!meta) throw bad(404, '素材不存在')
    meta.status = 'skipped'
    meta.skipReason = String(reason || '').slice(0, 300)
    writeJsonAtomic(path.join(this.rawDir, `${meta.id}.json`), meta)
    this.audit(actor, 'skip-raw', { id, name: meta.name, reason: meta.skipReason })
    return meta
  }

  /** 把一条待整理素材标记为「已排入整理」（可选的整理中标记，避免重复整理）。 */
  touchRaw(id) {
    const meta = this.raw.get(String(id))
    if (!meta) throw bad(404, '素材不存在')
    meta.lastTouchedAt = nowIso()
    writeJsonAtomic(path.join(this.rawDir, `${meta.id}.json`), meta)
    return meta
  }

  deleteRaw(id, actor, role) {
    const meta = this.raw.get(String(id))
    if (!meta) throw bad(404, '素材不存在')
    if (role !== 'admin' && meta.author !== actor) throw bad(403, '只能删除自己上传的素材')
    const linked = [...this.docs.values()].find((d) => d.rawId === meta.id)
    if (linked) throw bad(400, `该素材已生成文档《${linked.title}》，请先删除文档`)
    this.raw.delete(meta.id)
    if (meta.sha256) this.rawBySha.delete(meta.sha256)
    try { fs.unlinkSync(path.join(this.rawDir, `${meta.id}.json`)) } catch { /* ignore */ }
    try { fs.unlinkSync(path.join(this.rawDir, `${meta.id}.bin`)) } catch { /* ignore */ }
    this.audit(actor, 'delete-raw', { id, name: meta.name })
  }

  // -------------------------------------------------------------- stats / status

  stats() {
    const byCategory = {}
    for (const category of CATEGORIES) byCategory[category] = 0
    let docBytes = 0
    for (const doc of this.docs.values()) {
      const key = doc.category || '99_待分类'
      byCategory[key] = (byCategory[key] || 0) + 1
      docBytes += Buffer.byteLength(doc.markdown || '', 'utf8')
    }
    let rawBytes = 0
    for (const meta of this.raw.values()) rawBytes += meta.bytes || 0
    let comments = 0
    for (const list of this.comments.values()) comments += list.filter((c) => !c.deleted).length
    return {
      docs: this.docs.size,
      raw: this.raw.size,
      inbox: this.listRaw({ status: 'new', limit: 100000 }).length,
      skipped: this.listRaw({ status: 'skipped', limit: 100000 }).length,
      members: this.config.members.length,
      important: [...this.docs.values()].filter((d) => d.important).length,
      comments,
      docBytes,
      rawBytes,
      byCategory,
    }
  }

  status(member) {
    const name = member ? member.name : ''
    const important = name ? this.importantFor(name) : []
    return {
      ok: true,
      name: this.config.name,
      version: VERSION,
      docs: this.docs.size,
      raw: this.raw.size,
      inbox: this.listRaw({ status: 'new', limit: 100000 }).length,
      member: member ? { name: member.name, role: member.role } : null,
      members: this.config.members.map((m) => ({ name: m.name, role: m.role })),
      categories: CATEGORIES,
      importantUnread: important.filter((d) => !d.read).length,
      importantTotal: important.length,
      mentionsUnread: name ? this.mentionsFor(name).length : 0,
      weeklyDue: name ? this.weekly(name).due : false,
      time: nowIso(),
    }
  }
}

// ---------------------------------------------------------------- server

function createHub(options) {
  const store = new Store(options.data)
  const log = options.log || ((...args) => console.log('[hub]', ...args))
  const corsHeaders = 'authorization,content-type,x-filename,x-title,x-tags,x-author,x-important,x-recommend,x-scope,x-pending'

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://hub.local')
    const pathname = url.pathname

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
        'access-control-allow-headers': corsHeaders,
        'access-control-max-age': '86400',
      })
      res.end()
      return
    }

    if (pathname === '/' || pathname === '/health') {
      sendJson(res, 200, { ok: true, service: 'dsh-shared-kb', version: VERSION, docs: store.docs.size })
      return
    }

    // 插件安装包（公开只读，便于成员在插件市场里用 URL 安装）
    if (req.method === 'GET' && pathname.startsWith('/install/') && pathname.endsWith('.tgz')) {
      const file = path.join(__dirname, 'dist', path.basename(pathname))
      if (!fs.existsSync(file)) { sendJson(res, 404, { ok: false, error: '安装包不存在' }); return }
      const body = fs.readFileSync(file)
      res.writeHead(200, {
        'content-type': 'application/gzip',
        'content-length': body.length,
        'content-disposition': `attachment; filename="${path.basename(file)}"`,
        'access-control-allow-origin': '*',
      })
      res.end(body)
      return
    }

    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
    const member = store.memberByToken(token)
    if (!member) {
      sendJson(res, 401, { ok: false, error: '未授权：token 无效或缺失' })
      return
    }

    const requireAdmin = () => {
      if (member.role !== 'admin') throw bad(403, '需要管理员权限')
    }
    const viewer = member.name
    const q = url.searchParams

    try {
      if (req.method === 'GET' && pathname === '/api/status') {
        sendJson(res, 200, store.status(member))
        return
      }

      if (req.method === 'GET' && pathname === '/api/list') {
        const limit = Math.min(Math.max(Number(q.get('limit')) || 50, 1), 500)
        const offset = Math.max(Number(q.get('offset')) || 0, 0)
        sendJson(res, 200, {
          ok: true,
          ...store.listDocs({
            category: q.get('category') || '',
            tag: q.get('tag') || '',
            author: q.get('author') || '',
            important: q.get('important') || '',
            collection: q.get('collection') || '',
            sort: q.get('sort') || '',
            limit,
            offset,
            viewer,
          }),
        })
        return
      }

      if (req.method === 'GET' && pathname === '/api/search') {
        const limit = Math.min(Math.max(Number(q.get('limit')) || 20, 1), 100)
        sendJson(res, 200, {
          ok: true,
          ...store.search(q.get('q') || '', {
            limit,
            category: q.get('category') || '',
            author: q.get('author') || '',
            important: q.get('important') || '',
            compact: q.get('compact') === '1' || q.get('compact') === 'true',
            viewer,
          }),
        })
        return
      }

      if (req.method === 'GET' && pathname === '/api/recall') {
        const limit = Math.min(Math.max(Number(q.get('limit')) || 6, 1), 20)
        sendJson(res, 200, {
          ok: true,
          ...store.recall(q.get('topic') || q.get('q') || '', {
            limit,
            category: q.get('category') || '',
            viewer,
          }),
        })
        return
      }

      if (req.method === 'GET' && pathname === '/api/doc') {
        const doc = store.getDoc(q.get('id') || '', viewer)
        if (!doc) { sendJson(res, 404, { ok: false, error: '文档不存在' }); return }
        sendJson(res, 200, { ok: true, doc })
        return
      }

      // 记录已读：GET 保持幂等，所以单独开一个路由，由客户端/工具显式调用
      if (req.method === 'GET' && pathname === '/api/doc/open') {
        const id = String(q.get('id') || '')
        const doc = store.docs.get(id)
        if (!doc) { sendJson(res, 404, { ok: false, error: '文档不存在' }); return }
        const marked = store.markRead(viewer, id)
        sendJson(res, 200, { ok: true, id, marked, doc: store.getDoc(id, viewer) })
        return
      }

      if (req.method === 'GET' && pathname === '/api/history') {
        sendJson(res, 200, { ok: true, ...store.history(q.get('id') || '', viewer) })
        return
      }

      if (req.method === 'GET' && pathname === '/api/inbox') {
        const status = q.get('status') || 'new'
        sendJson(res, 200, {
          ok: true,
          items: store.listRaw({ status: status === 'all' ? '' : status, author: q.get('author') || '' }),
        })
        return
      }

      if (req.method === 'GET' && pathname === '/api/raw') {
        const raw = store.getRaw(q.get('id') || '')
        if (!raw) { sendJson(res, 404, { ok: false, error: '素材不存在' }); return }
        res.writeHead(200, {
          'content-type': 'application/octet-stream',
          'content-length': raw.bytes.length,
          'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(raw.meta.name)}`,
          'access-control-allow-origin': '*',
        })
        res.end(raw.bytes)
        return
      }

      if (req.method === 'POST' && pathname === '/api/upload') {
        const body = await readBody(req, MAX_UPLOAD)
        if (!body.length) { sendJson(res, 400, { ok: false, error: '空文件' }); return }
        const name = decodeHeader(req.headers['x-filename'], 'file')
        const title = decodeHeader(req.headers['x-title'], name)
        const tags = decodeHeader(req.headers['x-tags'], '')
        const recommend = decodeHeader(req.headers['x-recommend'], '')
        const important = String(req.headers['x-important'] || '') === '1'
        const pending = String(req.headers['x-pending'] || '') === '1'
        if (important && [...recommend.trim()].length < RECOMMEND_MIN) {
          sendJson(res, 400, { ok: false, error: `标记为重要必须手写推荐语，至少 ${RECOMMEND_MIN} 字` })
          return
        }
        const result = store.putRaw({ name, title, tags, author: viewer, bytes: body, important, recommend, pending })
        log(`${result.duplicate ? 'duplicate' : 'upload'} ${result.raw.id} ${result.raw.name} by ${viewer}`)
        sendJson(res, 200, { ok: true, ...result })
        return
      }

      if (req.method === 'POST' && pathname === '/api/docs') {
        const parsed = await readJsonBody(req)
        if (parsed.rawId && !store.raw.get(String(parsed.rawId))) {
          sendJson(res, 400, { ok: false, error: 'rawId 不存在' })
          return
        }
        const previous = parsed.id ? store.docs.get(String(parsed.id)) : null
        if (previous && member.role !== 'admin' && previous.author !== viewer) {
          sendJson(res, 403, { ok: false, error: '只能更新自己创建的文档' })
          return
        }
        const doc = store.putDoc(parsed, viewer)
        log(`doc ${doc.id} "${doc.title}" v${doc.version} by ${viewer}`)
        sendJson(res, 200, { ok: true, doc: store.view(doc, viewer) })
        return
      }

      if (req.method === 'POST' && pathname === '/api/docs/restore') {
        const parsed = await readJsonBody(req)
        const previous = store.docs.get(String(parsed.id || ''))
        if (!previous) { sendJson(res, 404, { ok: false, error: '文档不存在' }); return }
        if (member.role !== 'admin' && previous.author !== viewer) {
          sendJson(res, 403, { ok: false, error: '只能回滚自己创建的文档' })
          return
        }
        sendJson(res, 200, { ok: true, doc: store.restoreDoc(parsed.id, parsed.version, viewer) })
        return
      }

      if (req.method === 'POST' && pathname === '/api/docs/delete') {
        const parsed = await readJsonBody(req)
        store.deleteDoc(parsed.id, viewer, member.role)
        sendJson(res, 200, { ok: true })
        return
      }

      if (req.method === 'POST' && pathname === '/api/docs/batch-delete') {
        const parsed = await readJsonBody(req)
        const ids = Array.isArray(parsed.ids) ? parsed.ids.map(String) : []
        if (!ids.length) { sendJson(res, 400, { ok: false, error: 'ids 不能为空' }); return }
        const result = store.batchDelete(ids, viewer, member.role)
        sendJson(res, 200, { ok: true, ...result })
        return
      }

      // ---- 重要资料
      if (req.method === 'GET' && pathname === '/api/important') {
        sendJson(res, 200, { ok: true, items: store.importantFor(viewer) })
        return
      }
      if (req.method === 'POST' && pathname === '/api/important/ack') {
        const parsed = await readJsonBody(req)
        sendJson(res, 200, { ok: true, ...store.ackImportant(parsed.id, viewer) })
        return
      }

      // ---- 收藏夹
      if (req.method === 'GET' && pathname === '/api/collections') {
        sendJson(res, 200, { ok: true, items: store.collectionList(viewer) })
        return
      }
      if (req.method === 'POST' && pathname === '/api/collections') {
        const parsed = await readJsonBody(req)
        sendJson(res, 200, store.collectionOp(viewer, parsed))
        return
      }

      // ---- 评论 / @
      if (req.method === 'GET' && pathname === '/api/comments') {
        sendJson(res, 200, { ok: true, items: store.commentList(q.get('id') || '') })
        return
      }
      if (req.method === 'POST' && pathname === '/api/comments') {
        const parsed = await readJsonBody(req)
        sendJson(res, 200, { ok: true, comment: store.addComment(parsed.id, parsed.text, viewer) })
        return
      }
      if (req.method === 'POST' && pathname === '/api/comments/delete') {
        const parsed = await readJsonBody(req)
        sendJson(res, 200, store.deleteComment(parsed.id, parsed.commentId, viewer, member.role))
        return
      }
      if (req.method === 'GET' && pathname === '/api/mentions') {
        sendJson(res, 200, { ok: true, items: store.mentionsFor(viewer) })
        return
      }
      if (req.method === 'POST' && pathname === '/api/mentions/seen') {
        sendJson(res, 200, store.markMentionsSeen(viewer))
        return
      }

      // ---- 周报
      if (req.method === 'GET' && pathname === '/api/weekly') {
        sendJson(res, 200, { ok: true, report: store.weekly(viewer) })
        return
      }
      if (req.method === 'POST' && pathname === '/api/weekly/seen') {
        sendJson(res, 200, store.markWeeklySeen(viewer))
        return
      }

      // ---- 素材维护
      if (req.method === 'POST' && pathname === '/api/raw/skip') {
        requireAdmin()
        const parsed = await readJsonBody(req)
        sendJson(res, 200, { ok: true, item: store.skipRaw(parsed.id, parsed.reason, viewer) })
        return
      }

      if (req.method === 'POST' && pathname === '/api/raw/touch') {
        const parsed = await readJsonBody(req)
        sendJson(res, 200, { ok: true, item: store.touchRaw(parsed.id) })
        return
      }

      if (req.method === 'POST' && pathname === '/api/raw/delete') {
        const parsed = await readJsonBody(req)
        store.deleteRaw(parsed.id, viewer, member.role)
        sendJson(res, 200, { ok: true })
        return
      }

      // ---- 成员
      if (req.method === 'GET' && pathname === '/api/members') {
        sendJson(res, 200, {
          ok: true,
          items: store.config.members.map((m) => ({ name: m.name, role: m.role, createdAt: m.createdAt })),
        })
        return
      }

      if (req.method === 'POST' && pathname === '/api/members') {
        requireAdmin()
        const parsed = await readJsonBody(req)
        const created = store.addMember(parsed.name, parsed.role)
        store.audit(viewer, 'add-member', { name: created.name, role: created.role })
        sendJson(res, 200, { ok: true, member: { name: created.name, role: created.role, token: created.token } })
        return
      }

      if (req.method === 'POST' && pathname === '/api/members/remove') {
        requireAdmin()
        const parsed = await readJsonBody(req)
        store.removeMember(String(parsed.name || ''), viewer)
        sendJson(res, 200, { ok: true })
        return
      }

      if (req.method === 'POST' && pathname === '/api/members/rotate') {
        requireAdmin()
        const parsed = await readJsonBody(req)
        const rotated = store.rotate(String(parsed.name || ''), viewer)
        sendJson(res, 200, { ok: true, member: { name: rotated.name, role: rotated.role, token: rotated.token } })
        return
      }

      if (req.method === 'GET' && pathname === '/api/stats') {
        sendJson(res, 200, { ok: true, stats: store.stats() })
        return
      }

      if (req.method === 'GET' && pathname === '/api/audit') {
        requireAdmin()
        const limit = Math.min(Math.max(Number(q.get('limit')) || 100, 1), 1000)
        sendJson(res, 200, { ok: true, items: store.readAudit(limit) })
        return
      }

      sendJson(res, 404, { ok: false, error: 'not found' })
    } catch (error) {
      const status = error && error.status ? error.status : 500
      const payload = { ok: false, error: String((error && error.message) || error) }
      if (error && error.conflict) { payload.conflict = true; payload.latest = error.latest }
      if (error && error.needRead) payload.needRead = true
      if (error && error.existingId) payload.existingId = error.existingId
      sendJson(res, status, payload)
    }
  })

  return { server, store }
}

// ---------------------------------------------------------------- CLI

function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) { out[key] = next; i++ } else { out[key] = true }
    } else out._.push(arg)
  }
  return out
}

function inviteCode(hubUrl, member) {
  const payload = { u: hubUrl, t: member.token, n: member.name }
  return `skb1.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`
}

function usage() {
  console.log(`dsh-shared-kb hub ${VERSION}

用法：
  node hub.js [--data DIR] [--port 8787] [--host 0.0.0.0]
  node hub.js [--data DIR] --add-member NAME [--admin] [--url http://192.168.1.10:8787]
  node hub.js [--data DIR] --list-members
  node hub.js [--data DIR] --remove-member NAME
  node hub.js [--data DIR] --rotate NAME
  node hub.js [--data DIR] --invite NAME [--url http://192.168.1.10:8787]   # 重新打印邀请码
  node hub.js [--data DIR] --rename "新库名"

环境变量：DSH_SHARED_KB_DATA / DSH_SHARED_KB_PORT / DSH_SHARED_KB_HOST
`)
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || args.h) { usage(); return }
  const data = path.resolve(String(args.data || process.env.DSH_SHARED_KB_DATA || path.join(os.homedir(), '.dsh-shared-kb')))
  const store = new Store(data)
  const baseUrl = String(args.url || process.env.DSH_SHARED_KB_URL || `http://127.0.0.1:${Number(args.port || process.env.DSH_SHARED_KB_PORT || 8787)}`).replace(/\/+$/, '')

  if (args['add-member']) {
    const member = store.addMember(String(args['add-member']), args.admin ? 'admin' : 'member')
    console.log(`已添加成员：${member.name} (${member.role})`)
    console.log(`邀请码（发给他，粘贴到插件页面即可）：\n${inviteCode(baseUrl, member)}`)
    console.log(`令牌：${member.token}`)
    return
  }
  if (args['remove-member']) {
    store.removeMember(String(args['remove-member']), 'cli')
    console.log(`已移除：${args['remove-member']}`)
    return
  }
  if (args.rotate) {
    const member = store.rotate(String(args.rotate), 'cli')
    console.log(`已轮换：${member.name}\n新令牌：${member.token}`)
    return
  }
  if (args.invite) {
    const member = store.config.members.find((m) => m.name === String(args.invite))
    if (!member) { console.error(`成员不存在：${args.invite}`); process.exitCode = 1; return }
    console.log(inviteCode(baseUrl, member))
    return
  }
  if (args['list-members']) {
    for (const m of store.config.members) console.log(`${m.name}\t${m.role}\t${m.createdAt}`)
    return
  }
  if (args.rename) {
    store.config.name = String(args.rename)
    store.saveConfig()
    console.log(`库名已改为：${args.rename}`)
    return
  }

  const port = Number(args.port || process.env.DSH_SHARED_KB_PORT || 8787)
  const host = String(args.host || process.env.DSH_SHARED_KB_HOST || '0.0.0.0')
  const { server } = createHub({ data })
  server.listen(port, host, () => {
    console.log(`[hub] dsh-shared-kb ${VERSION} listening on http://${host}:${port}`)
    console.log(`[hub] data: ${data}`)
    if (!store.config.members.length) {
      console.log('[hub] 还没有成员。添加第一个管理员：')
      console.log(`[hub]   node hub.js --data "${data}" --add-member 你的名字 --admin`)
    } else {
      console.log(`[hub] 成员：${store.config.members.map((m) => `${m.name}(${m.role})`).join('、')}`)
    }
  })
  const shutdown = () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 2000).unref() }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

if (require.main === module) main()

module.exports = { createHub, Store, VERSION, CATEGORIES, inviteCode, RECOMMEND_MIN, RECOMMEND_MAX }
