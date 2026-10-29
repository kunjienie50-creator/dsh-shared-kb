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
 *   docs/<id>.json   规范化文档 + 历史版本
 *   raw/<id>.json    原始素材元数据（sha256 去重、status）
 *   raw/<id>.bin     原始字节
 *   audit.jsonl      管理操作流水（增删成员、删除素材…）
 */

const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const os = require('node:os')

const VERSION = '0.2.0'
const MAX_UPLOAD = 64 * 1024 * 1024
const MAX_BODY = 8 * 1024 * 1024
const MAX_VERSIONS = 20

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

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback }
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

function decodeHeader(value, fallback = '') {
  try { return decodeURIComponent(String(value || fallback)) } catch { return String(value || fallback) }
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
    this.configFile = path.join(this.root, 'config.json')
    this.auditFile = path.join(this.root, 'audit.jsonl')
    ensureDir(this.docsDir)
    ensureDir(this.rawDir)
    this.config = readJson(this.configFile, null)
    if (!this.config) {
      this.config = { name: '团队共享知识库', createdAt: nowIso(), members: [] }
      writeJsonAtomic(this.configFile, this.config)
    }
    if (!Array.isArray(this.config.members)) this.config.members = []
    this.docs = new Map()
    this.raw = new Map()
    this.rawBySha = new Map()
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
  }

  saveConfig() { writeJsonAtomic(this.configFile, this.config) }

  audit(actor, action, detail) {
    try {
      fs.appendFileSync(this.auditFile, JSON.stringify({ at: nowIso(), actor, action, detail }) + '\n')
    } catch { /* best effort */ }
  }

  memberByToken(token) {
    if (!token) return null
    for (const member of this.config.members) {
      if (constantEqual(member.token, token)) return member
    }
    return null
  }

  addMember(name, role) {
    const clean = String(name || '').trim()
    if (!clean) throw Object.assign(new Error('成员名不能为空'), { status: 400 })
    if (this.config.members.some((m) => m.name === clean)) {
      throw Object.assign(new Error(`成员已存在：${clean}`), { status: 409 })
    }
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
    if (!target) throw Object.assign(new Error(`成员不存在：${name}`), { status: 404 })
    if (name === actor) throw Object.assign(new Error('不能移除自己'), { status: 400 })
    const admins = this.config.members.filter((m) => m.role === 'admin')
    if (target.role === 'admin' && admins.length <= 1) {
      throw Object.assign(new Error('至少保留一个管理员'), { status: 400 })
    }
    this.config.members = this.config.members.filter((m) => m.name !== name)
    this.saveConfig()
    this.audit(actor, 'remove-member', { name })
  }

  rotate(name, actor) {
    const member = this.config.members.find((m) => m.name === name)
    if (!member) throw Object.assign(new Error(`成员不存在：${name}`), { status: 404 })
    member.token = crypto.randomBytes(24).toString('base64url')
    this.saveConfig()
    this.audit(actor, 'rotate-token', { name })
    return member
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
      sha256: doc.sha256 || '',
      bytes: Buffer.byteLength(doc.markdown || '', 'utf8'),
      version: doc.version || 1,
    }
  }

  listDocs({ category, tag, limit = 50, offset = 0 } = {}) {
    let docs = [...this.docs.values()]
    if (category) docs = docs.filter((d) => (d.category || '99_待分类') === category)
    if (tag) docs = docs.filter((d) => (d.tags || []).includes(tag))
    docs.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    const total = docs.length
    return { total, items: docs.slice(offset, offset + limit).map((d) => this.meta(d)) }
  }

  getDoc(id) {
    const doc = this.docs.get(String(id))
    if (!doc) return null
    return {
      ...this.meta(doc),
      markdown: doc.markdown,
      versions: (doc.versions || []).map((v) => ({ version: v.version, updatedAt: v.updatedAt, author: v.author })),
    }
  }

  search(query, { limit = 20, category } = {}) {
    const q = String(query || '').trim()
    if (!q) return { total: 0, items: [] }
    const scored = []
    for (const doc of this.docs.values()) {
      if (category && (doc.category || '99_待分类') !== category) continue
      const score = scoreDoc(doc, q)
      if (score > 0) scored.push({ doc, score })
    }
    scored.sort((a, b) => b.score - a.score || String(b.doc.updatedAt).localeCompare(String(a.doc.updatedAt)))
    const items = scored.slice(0, limit).map(({ doc, score }) => ({
      ...this.meta(doc),
      score,
      snippet: snippetOf(doc.markdown, q),
    }))
    return { total: scored.length, items }
  }

  putDoc(input, author) {
    const title = String(input.title || '').trim()
    const markdown = String(input.markdown || '')
    if (!title) throw Object.assign(new Error('title 必填'), { status: 400 })
    if (!markdown.trim()) throw Object.assign(new Error('markdown 必填'), { status: 400 })
    const id = input.id || newId('doc')
    const existing = this.docs.get(id)
    const stamp = nowIso()
    const tags = Array.isArray(input.tags)
      ? input.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 40)
      : String(input.tags || '').split(/[,，]/).map((t) => t.trim()).filter(Boolean).slice(0, 40)
    const points = Array.isArray(input.points)
      ? input.points.map((p) => String(p).trim()).filter(Boolean).slice(0, 12)
      : []
    let versions = existing && Array.isArray(existing.versions) ? existing.versions.slice() : []
    if (existing) {
      versions.unshift({ version: existing.version || 1, updatedAt: existing.updatedAt, author: existing.author, markdown: existing.markdown })
      versions = versions.slice(0, MAX_VERSIONS)
    }
    const category = CATEGORIES.includes(String(input.category)) ? String(input.category) : (existing && existing.category) || '99_待分类'
    if (!input.id) {
      const same = [...this.docs.values()].find((d) => d.title === title && (d.category || '99_待分类') === category)
      if (same) {
        throw Object.assign(new Error(`已存在同名文档《${same.title}》（id: ${same.id}），请用该 id 更新，或换个标题`), { status: 409, existingId: same.id })
      }
    }
    const doc = {
      id,
      title,
      summary: String(input.summary || '').trim().slice(0, 20),
      description: String(input.description || '').trim().slice(0, 500),
      category,
      confidence: ['高', '中', '低'].includes(String(input.confidence)) ? String(input.confidence) : '',
      tags,
      points,
      author: author || String(input.author || 'unknown'),
      rawId: input.rawId ? String(input.rawId) : (existing && existing.rawId) || '',
      sha256: input.sha256
        ? String(input.sha256)
        : (existing && existing.sha256) || (input.rawId && this.raw.get(String(input.rawId)) ? this.raw.get(String(input.rawId)).sha256 : '') || '',
      createdAt: (existing && existing.createdAt) || stamp,
      updatedAt: stamp,
      version: existing ? (existing.version || 1) + 1 : 1,
      markdown,
      versions,
    }
    this.docs.set(id, doc)
    writeJsonAtomic(path.join(this.docsDir, `${id}.json`), doc)
    if (doc.rawId) {
      const raw = this.raw.get(doc.rawId)
      if (raw) { raw.status = 'archived'; writeJsonAtomic(path.join(this.rawDir, `${raw.id}.json`), raw) }
    }
    return this.meta(doc)
  }

  deleteDoc(id, actor, role) {
    const doc = this.docs.get(String(id))
    if (!doc) return false
    if (role !== 'admin' && doc.author !== actor) {
      throw Object.assign(new Error('只能删除自己创建的文档'), { status: 403 })
    }
    this.docs.delete(doc.id)
    try { fs.unlinkSync(path.join(this.docsDir, `${doc.id}.json`)) } catch { /* ignore */ }
    this.audit(actor, 'delete-doc', { id: doc.id, title: doc.title })
    return true
  }

  putRaw({ name, title, tags, author, bytes }) {
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
      tags: Array.isArray(tags) ? tags : String(tags || '').split(/[,，]/).map((t) => t.trim()).filter(Boolean),
      author: String(author || 'unknown'),
      bytes: bytes.length,
      sha256,
      status: 'new',
      skipReason: '',
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

  listRaw({ status, limit = 200 } = {}) {
    let items = [...this.raw.values()]
    if (status) items = items.filter((r) => (r.status || 'new') === status)
    items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    return items.slice(0, limit)
  }

  skipRaw(id, reason, actor) {
    const meta = this.raw.get(String(id))
    if (!meta) throw Object.assign(new Error('素材不存在'), { status: 404 })
    meta.status = 'skipped'
    meta.skipReason = String(reason || '').slice(0, 300)
    writeJsonAtomic(path.join(this.rawDir, `${meta.id}.json`), meta)
    this.audit(actor, 'skip-raw', { id, name: meta.name, reason: meta.skipReason })
    return meta
  }

  deleteRaw(id, actor) {
    const meta = this.raw.get(String(id))
    if (!meta) throw Object.assign(new Error('素材不存在'), { status: 404 })
    const linked = [...this.docs.values()].find((d) => d.rawId === meta.id)
    if (linked) throw Object.assign(new Error(`该素材已生成文档《${linked.title}》，请先删除文档`), { status: 400 })
    this.raw.delete(meta.id)
    if (meta.sha256) this.rawBySha.delete(meta.sha256)
    try { fs.unlinkSync(path.join(this.rawDir, `${meta.id}.json`)) } catch { /* ignore */ }
    try { fs.unlinkSync(path.join(this.rawDir, `${meta.id}.bin`)) } catch { /* ignore */ }
    this.audit(actor, 'delete-raw', { id, name: meta.name })
  }

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
    return {
      docs: this.docs.size,
      raw: this.raw.size,
      inbox: this.listRaw({ status: 'new', limit: 100000 }).length,
      skipped: this.listRaw({ status: 'skipped', limit: 100000 }).length,
      members: this.config.members.length,
      docBytes,
      rawBytes,
      byCategory,
    }
  }

  status(member) {
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
      time: nowIso(),
    }
  }
}

// ---------------------------------------------------------------- server

function createHub(options) {
  const store = new Store(options.data)
  const log = options.log || ((...args) => console.log('[hub]', ...args))

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://hub.local')
    const pathname = url.pathname

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
        'access-control-allow-headers': 'authorization,content-type,x-filename,x-title,x-tags,x-author',
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
      if (member.role !== 'admin') throw Object.assign(new Error('需要管理员权限'), { status: 403 })
    }

    try {
      if (req.method === 'GET' && pathname === '/api/status') {
        sendJson(res, 200, store.status(member))
        return
      }

      if (req.method === 'GET' && pathname === '/api/list') {
        const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 500)
        const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0)
        sendJson(res, 200, {
          ok: true,
          ...store.listDocs({
            category: url.searchParams.get('category') || '',
            tag: url.searchParams.get('tag') || '',
            limit,
            offset,
          }),
        })
        return
      }

      if (req.method === 'GET' && pathname === '/api/search') {
        const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 20, 1), 100)
        sendJson(res, 200, {
          ok: true,
          ...store.search(url.searchParams.get('q') || '', {
            limit,
            category: url.searchParams.get('category') || '',
          }),
        })
        return
      }

      if (req.method === 'GET' && pathname === '/api/doc') {
        const doc = store.getDoc(url.searchParams.get('id') || '')
        if (!doc) { sendJson(res, 404, { ok: false, error: '文档不存在' }); return }
        sendJson(res, 200, { ok: true, doc })
        return
      }

      if (req.method === 'GET' && pathname === '/api/inbox') {
        const status = url.searchParams.get('status') || 'new'
        sendJson(res, 200, { ok: true, items: store.listRaw({ status: status === 'all' ? '' : status }) })
        return
      }

      if (req.method === 'GET' && pathname === '/api/raw') {
        const raw = store.getRaw(url.searchParams.get('id') || '')
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
        const result = store.putRaw({ name, title, tags, author: member.name, bytes: body })
        log(`${result.duplicate ? 'duplicate' : 'upload'} ${result.raw.id} ${result.raw.name} by ${member.name}`)
        sendJson(res, 200, { ok: true, ...result })
        return
      }

      if (req.method === 'POST' && pathname === '/api/docs') {
        const parsed = JSON.parse((await readBody(req, MAX_BODY)).toString('utf8') || '{}')
        if (parsed.rawId && !store.raw.get(String(parsed.rawId))) {
          sendJson(res, 400, { ok: false, error: 'rawId 不存在' })
          return
        }
        const previous = parsed.id ? store.docs.get(String(parsed.id)) : null
        if (previous && member.role !== 'admin' && previous.author !== member.name) {
          sendJson(res, 403, { ok: false, error: '只能更新自己创建的文档' })
          return
        }
        const doc = store.putDoc(parsed, member.name)
        log(`doc ${doc.id} "${doc.title}" v${doc.version} by ${member.name}`)
        sendJson(res, 200, { ok: true, doc })
        return
      }

      if (req.method === 'POST' && pathname === '/api/docs/delete') {
        const parsed = JSON.parse((await readBody(req, MAX_BODY)).toString('utf8') || '{}')
        store.deleteDoc(parsed.id, member.name, member.role)
        sendJson(res, 200, { ok: true })
        return
      }

      if (req.method === 'POST' && pathname === '/api/raw/skip') {
        requireAdmin()
        const parsed = JSON.parse((await readBody(req, MAX_BODY)).toString('utf8') || '{}')
        sendJson(res, 200, { ok: true, item: store.skipRaw(parsed.id, parsed.reason, member.name) })
        return
      }

      if (req.method === 'POST' && pathname === '/api/raw/delete') {
        requireAdmin()
        const parsed = JSON.parse((await readBody(req, MAX_BODY)).toString('utf8') || '{}')
        store.deleteRaw(parsed.id, member.name)
        sendJson(res, 200, { ok: true })
        return
      }

      if (req.method === 'GET' && pathname === '/api/members') {
        sendJson(res, 200, {
          ok: true,
          items: store.config.members.map((m) => ({ name: m.name, role: m.role, createdAt: m.createdAt })),
        })
        return
      }

      if (req.method === 'POST' && pathname === '/api/members') {
        requireAdmin()
        const parsed = JSON.parse((await readBody(req, MAX_BODY)).toString('utf8') || '{}')
        const created = store.addMember(parsed.name, parsed.role)
        store.audit(member.name, 'add-member', { name: created.name, role: created.role })
        sendJson(res, 200, { ok: true, member: { name: created.name, role: created.role, token: created.token } })
        return
      }

      if (req.method === 'POST' && pathname === '/api/members/remove') {
        requireAdmin()
        const parsed = JSON.parse((await readBody(req, MAX_BODY)).toString('utf8') || '{}')
        store.removeMember(String(parsed.name || ''), member.name)
        sendJson(res, 200, { ok: true })
        return
      }

      if (req.method === 'POST' && pathname === '/api/members/rotate') {
        requireAdmin()
        const parsed = JSON.parse((await readBody(req, MAX_BODY)).toString('utf8') || '{}')
        const rotated = store.rotate(String(parsed.name || ''), member.name)
        sendJson(res, 200, { ok: true, member: { name: rotated.name, role: rotated.role, token: rotated.token } })
        return
      }

      if (req.method === 'GET' && pathname === '/api/stats') {
        sendJson(res, 200, { ok: true, stats: store.stats() })
        return
      }

      sendJson(res, 404, { ok: false, error: 'not found' })
    } catch (error) {
      const status = error && error.status ? error.status : 500
      sendJson(res, status, { ok: false, error: String((error && error.message) || error) })
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

module.exports = { createHub, Store, VERSION, CATEGORIES, inviteCode }
