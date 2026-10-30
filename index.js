'use strict'

/**
 * dsh-shared-kb — Host half
 *
 * 连接团队 Hub（hub.js），把共享知识库接进 DSH：
 *  - 模型工具：skb_search / skb_read / skb_list / skb_upload / skb_commit /
 *    skb_inbox / skb_read_raw / skb_status / skb_admin，以及
 *    skb_recall / skb_collect / skb_recommend / skb_comment / skb_private / skb_weekly；
 *  - 同源页面路由 /shared-kb/api/*，供侧栏「共享知识库」页面使用；
 *  - 本地私有库（仅自己可见）：~/.dsh/shared-kb-private，永不上传 Hub，直接复用 hub.js 的 Store；
 *  - 上传文本素材可自动按 inbox-triage 规范整理，也可以选择「直接存为待整理」稍后手动整理；
 *  - 批量下载在宿主侧打 zip（零依赖 STORE 写入器），浏览器只发一个请求。
 */

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const { Store: HubStore } = require('./hub.js')

const NAME = 'dsh-shared-kb'
const API_PREFIX = '/shared-kb/api'
const MAX_UPLOAD = 64 * 1024 * 1024
const MAX_ZIP_FILES = 300
const MAX_ZIP_BYTES = 256 * 1024 * 1024
const RECOMMEND_MIN = 10
const RECOMMEND_MAX = 200
const TEXT_EXT = new Set(['.md', '.markdown', '.txt', '.csv', '.tsv', '.json', '.jsonl', '.html', '.htm', '.xml', '.yml', '.yaml', '.log', '.ini', '.toml', '.sql', '.js', '.ts', '.py', '.sh'])

const CATEGORIES = [
  '01_票据报销', '02_证件资质', '03_合同协议', '04_工作项目', '05_学习资料',
  '06_灵感创意', '07_图文素材', '08_人脉联络', '09_生活事务', '10_待办提醒', '99_待分类',
]

// ---------------------------------------------------------------- schemastery

function loadSchemastery() {
  try { return require('@deepseek-ai/schemastery') } catch { /* fall through */ }
  const { createRequire } = require('node:module')
  const prefixes = [process.env.DSH_GLOBAL_PREFIX, path.join(os.homedir(), '.local')].filter(Boolean)
  for (const prefix of prefixes) {
    const hostCopy = path.join(prefix, 'lib', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'schemastery', 'lib', 'index.cjs')
    try { return createRequire(hostCopy)(hostCopy) } catch { /* try next */ }
  }
  return null
}

const Config = (() => {
  try {
    const S = loadSchemastery()
    if (!S) return undefined
    return S.object({
      hubUrl: S.string().description('Hub 地址，例如 http://192.168.1.10:8787（一般由邀请码自动写入）'),
      publicUrl: S.string().description('管理员用：邀请码里写给成员的对外地址；留空则用 hubUrl'),
      token: S.string().description('我的成员令牌（由 Hub 管理员分配）'),
      member: S.string().description('我的显示名'),
      autoNormalize: S.boolean().description('上传文本类素材时自动按统一规范整理（默认开启）'),
      model: S.string().description('整理使用的模型，格式 provider/model；留空跟随默认模型'),
      privateDir: S.string().description('仅自己可见的本地库目录，留空用 ~/.dsh/shared-kb-private'),
    })
  } catch { return undefined }
})()

// ---------------------------------------------------------------- config

function dshHome() {
  return process.env.DSH_HOME ? path.resolve(process.env.DSH_HOME) : path.join(os.homedir(), '.dsh')
}

function configFile() { return path.join(dshHome(), 'shared-kb.json') }

function readConfigFile() {
  try { return JSON.parse(fs.readFileSync(configFile(), 'utf8').replace(/^\uFEFF/, '')) || {} } catch { return {} }
}

function writeConfigFile(next) {
  const file = configFile()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, file)
  try { fs.chmodSync(file, 0o600) } catch { /* best effort */ }
}

function readConfig(config) {
  const base = config || {}
  const file = readConfigFile()
  const pick = (key, fallback = '') => {
    const fromBase = base[key] === undefined || base[key] === null ? '' : String(base[key]).trim()
    const fromFile = file[key] === undefined || file[key] === null ? '' : String(file[key]).trim()
    return fromBase || fromFile || fallback
  }
  return {
    hubUrl: pick('hubUrl', 'http://127.0.0.1:8787').replace(/\/+$/, ''),
    publicUrl: pick('publicUrl').replace(/\/+$/, ''),
    token: pick('token'),
    member: pick('member'),
    autoNormalize: base.autoNormalize === undefined
      ? (file.autoNormalize === undefined ? true : file.autoNormalize !== false)
      : base.autoNormalize !== false,
    model: pick('model'),
    privateDir: pick('privateDir') || path.join(dshHome(), 'shared-kb-private'),
  }
}

// ---------------------------------------------------------------- helpers

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

function readBody(req, cap = MAX_UPLOAD) {
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

async function readJsonBody(req, cap = 16 * 1024 * 1024) {
  const raw = (await readBody(req, cap)).toString('utf8').replace(/^\uFEFF/, '')
  try { return JSON.parse(raw || '{}') } catch { throw Object.assign(new Error('请求体不是合法 JSON'), { status: 400 }) }
}

function textOf(buffer, filePath) {
  const ext = path.extname(filePath || '').toLowerCase()
  if (!TEXT_EXT.has(ext)) return null
  try { return buffer.toString('utf8') } catch { return null }
}

function safeName(name) {
  return String(name || 'file').split(/[\\/]/).pop().slice(0, 180)
}

function today() { return new Date().toISOString().slice(0, 10) }

function splitTags(value) {
  if (Array.isArray(value)) return value.map((t) => String(t).trim()).filter(Boolean).slice(0, 40)
  return String(value || '').split(/[,，]/).map((t) => String(t).trim()).filter(Boolean).slice(0, 40)
}

function clampSummary(value, cap = 10) {
  const text = String(value || '').replace(/["'\n]/g, ' ').trim()
  return text.slice(0, cap)
}

function parseFrontmatter(markdown) {
  const text = String(markdown || '')
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  if (!match) return { body: text.trim(), meta: {} }
  const meta = {}
  const listKeys = new Set(['tags', 'points'])
  let key = ''
  let list = null
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (pair) {
      key = pair[1]
      const value = pair[2].trim().replace(/^["']|["']$/g, '')
      if (listKeys.has(key)) {
        list = []
        meta[key] = list
        if (value && value !== '[]') {
          for (const part of value.replace(/^\[|\]$/g, '').split(/[,，]/)) {
            if (part.trim()) list.push(part.trim().replace(/^["']|["']$/g, ''))
          }
        }
      } else {
        meta[key] = value
        list = null
      }
      continue
    }
    const item = /^\s*-\s+(.*)$/.exec(line)
    if (item && list) list.push(item[1].trim().replace(/^["']|["']$/g, ''))
  }
  return { body: text.slice(match[0].length).trim(), meta }
}

function decodeURIComponentSafe(value) {
  try { return decodeURIComponent(String(value)) } catch { return String(value) }
}

// ---------------------------------------------------------------- zip (STORE)

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
    table[i] = c
  }
  return table
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function dosStamp(date) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date()
  const year = Math.max(d.getFullYear(), 1980)
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

/** 最小 zip 写入器：只存储不压缩，用于「批量下载」。零第三方依赖。 */
function zipStore(entries) {
  const parts = []
  const central = []
  let offset = 0
  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8')
    const data = entry.data
    const crc = crc32(data)
    const stamp = dosStamp(entry.mtime)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(stamp.time, 10)
    local.writeUInt16LE(stamp.date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    parts.push(local, nameBuf, data)

    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(0x0800, 8)
    cd.writeUInt16LE(0, 10)
    cd.writeUInt16LE(stamp.time, 12)
    cd.writeUInt16LE(stamp.date, 14)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(data.length, 20)
    cd.writeUInt32LE(data.length, 24)
    cd.writeUInt16LE(nameBuf.length, 28)
    cd.writeUInt16LE(0, 30)
    cd.writeUInt16LE(0, 32)
    cd.writeUInt16LE(0, 34)
    cd.writeUInt16LE(0, 36)
    cd.writeUInt32LE(0, 38)
    cd.writeUInt32LE(offset, 42)
    central.push(Buffer.concat([cd, nameBuf]))
    offset += 30 + nameBuf.length + data.length
  }
  const centralBuf = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)
  return Buffer.concat([...parts, centralBuf, eocd])
}

function zipEntryName(doc, used) {
  const folder = String(doc.category || '99_待分类').replace(/[\\/:*?"<>|]/g, '_')
  const base = String(doc.title || doc.id || 'doc').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80)
  let name = `${folder}/${base}.md`
  let n = 2
  while (used.has(name)) { name = `${folder}/${base} (${n}).md`; n += 1 }
  used.add(name)
  return name
}

function docToMarkdown(doc) {
  const lines = [
    '---',
    `title: ${doc.title || ''}`,
    `summary: ${doc.summary || ''}`,
    `category: ${doc.category || ''}`,
    doc.confidence ? `confidence: ${doc.confidence}` : '',
    `author: ${doc.author || ''}`,
    doc.important ? 'important: true' : '',
    doc.recommend ? `recommend: ${doc.recommend}` : '',
    `updated: ${doc.updatedAt || ''}`,
    `tags: [${(doc.tags || []).join(', ')}]`,
    '---',
    '',
  ].filter((line) => line !== '')
  if ((doc.points || []).length) {
    lines.push('## 要点')
    for (const p of doc.points) lines.push(`- ${p}`)
    lines.push('')
  }
  lines.push(String(doc.markdown || ''))
  return lines.join('\n')
}

// ---------------------------------------------------------------- hub client

async function hubCall(cfg, pathname, options = {}) {
  if (!cfg.hubUrl) throw new Error('未连接知识库：请在页面里粘贴邀请码')
  if (!cfg.token) throw new Error('未配置成员令牌：请在页面里粘贴邀请码')
  const res = await fetch(cfg.hubUrl + pathname, {
    method: options.method || 'GET',
    headers: { authorization: `Bearer ${cfg.token}`, ...(options.headers || {}) },
    body: options.body,
    signal: options.signal,
  })
  const type = res.headers.get('content-type') || ''
  if (!type.includes('application/json')) {
    if (!res.ok) throw new Error(`Hub 返回 ${res.status}`)
    return res
  }
  const data = await res.json()
  if (!res.ok || data.ok === false) {
    const error = new Error((data && data.error) || `Hub 返回 ${res.status}`)
    error.status = res.status
    if (data && data.conflict) { error.conflict = true; error.latest = data.latest }
    if (data && data.needRead) error.needRead = true
    if (data && data.existingId) error.existingId = data.existingId
    throw error
  }
  return data
}

function uploadToHub(cfg, { name, title, tags, author, bytes, important, recommend, pending }) {
  return hubCall(cfg, '/api/upload', {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream',
      'x-filename': encodeURIComponent(safeName(name)),
      'x-title': encodeURIComponent(String(title || name || '')),
      'x-tags': encodeURIComponent(splitTags(tags).join(',')),
      'x-author': encodeURIComponent(String(author || '')),
      'x-important': important ? '1' : '0',
      'x-recommend': encodeURIComponent(String(recommend || '')),
      'x-pending': pending ? '1' : '0',
    },
    body: bytes,
  })
}

// ---------------------------------------------------------------- private store

/**
 * 仅自己可见的本地库：直接复用 hub.js 的 Store，目录结构一致，
 * 但它永远不联网、不进 Hub，只落在本机 ~/.dsh/shared-kb-private。
 */
let privateCache = null
function privateStore(cfg) {
  const dir = path.resolve(cfg.privateDir || path.join(dshHome(), 'shared-kb-private'))
  if (privateCache && privateCache.root === dir) return privateCache
  privateCache = new HubStore(dir)
  return privateCache
}

function privateView(meta, viewer) {
  return { ...meta, scope: 'private' }
}

/** 私有库的文档 id 统一带 priv_ 前缀，路由才能无歧义地区分「共享」与「本机」。 */
function privateId() {
  return `priv_${Date.now().toString(36)}${require('node:crypto').randomBytes(4).toString('hex')}`
}

function privatePut(store, payload, author) {
  const input = { ...payload }
  input.id = input.id ? String(input.id) : privateId()
  if (!input.id.startsWith('priv_')) input.id = 'priv_' + input.id
  const doc = store.putDoc(input, author)
  return privateView(doc, author)
}

/** 素材 id 两家都可能长得像 raw_xxx，先查本机私有库再走网络。 */
function findPrivateRaw(cfg, id) {
  try { return privateStore(cfg).raw.get(String(id)) || null } catch { return null }
}

/**
 * 把一条待整理素材交给模型整理成文。public 走 Hub，private 走本机。
 * 上传弹窗里的「自动整理」和「待整理」里的「整理」按钮共用这一条路径。
 */
async function normalizeRawById(ctx, cfg, id, scope) {
  const key = String(id)
  const isPrivate = scope === 'private' || Boolean(findPrivateRaw(cfg, key))
  const store = isPrivate ? privateStore(cfg) : null
  let meta = null
  let bytes = null
  if (isPrivate) {
    const raw = store.getRaw(key)
    if (!raw) throw new Error('素材不存在：' + key)
    meta = raw.meta
    bytes = raw.bytes
  } else {
    const inbox = await hubCall(cfg, '/api/inbox?status=all')
    meta = (inbox.items || []).find((item) => item.id === key) || null
    if (!meta) throw new Error('素材不存在：' + key)
    const upstream = await hubCall(cfg, `/api/raw?id=${encodeURIComponent(key)}`)
    bytes = Buffer.from(await upstream.arrayBuffer())
  }
  const raw = { meta, bytes }
  const name = (raw.meta && raw.meta.name) || String(id)
  const text = textOf(raw.bytes, name)
  if (text === null) throw new Error('非文本素材，无法自动整理；请先用你的工具把它转成文本')
  const markdown = await callModel(ctx, cfg, NORMALIZE_SYSTEM, normalizePrompt({
    name, member: cfg.member, tags: (raw.meta && raw.meta.tags) || [], text, rawId: String(id),
  }))
  const payload = docFromModel(markdown, {
    title: name,
    summary: '',
    author: cfg.member,
    rawId: String(id),
    sha256: (raw.meta && raw.meta.sha256) || '',
    important: Boolean(raw.meta && raw.meta.important),
    recommend: (raw.meta && raw.meta.recommend) || '',
  })
  if (isPrivate) {
    if (!store.raw.has(String(id))) throw new Error('素材不存在：' + id)
    const doc = privatePut(store, payload, cfg.member)
    return { ok: true, scope: 'private', doc }
  }
  const saved = await hubCall(cfg, '/api/docs', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
  })
  return { ok: true, scope: 'public', doc: saved.doc }
}

// ---------------------------------------------------------------- normalization

const NORMALIZE_SYSTEM = [
  '你是团队共享知识库的素材整理器，规范来自团队的 inbox-triage 技能。把用户给的素材整理成一件可检索的档案。',
  '',
  '分类（必须选一个，判断依据是「将来拿它干什么」而不是「它写的是什么」）：',
  ...CATEGORIES.map((c) => `- ${c}`),
  '',
  '判定顺序（命中即停）：有金额/单号/发票 → 01；身份或资格证明 → 02；有条款/期限/签署/报价 → 03；只有一句「某日做某事」→ 10；主体是人 → 08；主体是可复用图 → 07；还没落地的想法 → 06；工作过程产物 → 04；知识本身 → 05；生活事务 → 09；都不像或两类势均力敌 → 99。',
  '',
  '输出格式：YAML frontmatter + 正文。frontmatter 字段固定：',
  'title: 长标题，把来龙去脉说清',
  'summary: 不超过 10 个字，能独立看懂，像文件名（例：差旅报销3480元）',
  'category: 上面 11 类之一，原样照抄',
  'confidence: 高／中／低（字迹清楚、类型明确为高；靠推断为中；两类都像或图糊为低）',
  'tags: 3~6 个检索词，YAML 列表',
  'points: 2~4 条要点，YAML 列表，短句，可带 - [ ] 待办',
  'author: 上传者名字',
  'source: raw/<素材id>',
  'created: YYYY-MM-DD',
  'updated: YYYY-MM-DD',
  '',
  '正文只写「提取内容」：把素材里真正有用的文字、数字、单号、日期、金额、结论原样保留；读不出来的部分写「未识别」，不要编。',
  '',
  '硬性规则：',
  '1. 只写素材里有的，不补事实、数字、链接；',
  '2. 不猜分类，拿不准进 99_待分类，confidence 低；',
  '3. summary 不超过 10 个字，禁用「关于」「一张」「截图」「其他」「杂项」「文件1」；',
  '4. 直接输出 Markdown 全文，不要用 ``` 围栏包裹整篇；',
  '5. 素材是纯噪音（纯表情、无信息广告）时，category 用 99_待分类，summary 写「无信息」并在正文说明。',
].join('\n')

function normalizePrompt({ name, member, tags, text, rawId }) {
  return [
    `素材文件名：${name}`,
    `上传者：${member || '未知'}`,
    `素材 id：${rawId || ''}`,
    `建议标签：${splitTags(tags).join('、') || '（无）'}`,
    `整理日期：${today()}`,
    '',
    '原始素材如下：',
    '-----',
    String(text).slice(0, 30000),
    '-----',
    '',
    '请按规范整理。',
  ].join('\n')
}

async function callModel(ctx, cfg, system, userText, signal) {
  const llm = ctx.get('llm')
  const adm = ctx.get('agentDefaultModel')
  if (!llm || typeof llm.stream !== 'function') throw new Error('llm 服务不可用')
  if (!adm || typeof adm.currentSelection !== 'function') throw new Error('agentDefaultModel 服务不可用')
  let selection = adm.currentSelection()
  if (!selection || !selection.provider || !selection.model) throw new Error('尚未配置默认模型')
  if (cfg.model) {
    const slash = cfg.model.indexOf('/')
    if (slash > 0) selection = { provider: cfg.model.slice(0, slash), model: cfg.model.slice(slash + 1) }
  }
  let output = ''
  const stream = llm.stream({
    provider: selection.provider,
    model: selection.model,
    system,
    messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
    temperature: 0.2,
    maxTokens: 4096,
    signal,
  })
  for await (const chunk of stream) {
    if (!chunk || typeof chunk !== 'object') continue
    if (chunk.type === 'text-delta') output += chunk.text
    if (chunk.type === 'finish' && chunk.reason && (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted')) {
      throw new Error((chunk.reason.failure && chunk.reason.failure.message) || '模型调用失败')
    }
  }
  output = output.trim().replace(/^```(?:markdown|md)?\s*/i, '').replace(/```\s*$/, '')
  if (!output) throw new Error('模型没有返回内容')
  return output
}

function docFromModel(markdown, fallback) {
  const parsed = parseFrontmatter(markdown)
  const meta = parsed.meta || {}
  const category = CATEGORIES.includes(meta.category) ? meta.category : '99_待分类'
  return {
    title: String(meta.title || fallback.title || '未命名素材').slice(0, 200),
    summary: clampSummary(meta.summary || fallback.summary || ''),
    description: '',
    category,
    confidence: ['高', '中', '低'].includes(meta.confidence) ? meta.confidence : '中',
    tags: splitTags(meta.tags),
    points: Array.isArray(meta.points) ? meta.points.slice(0, 12) : [],
    markdown: parsed.body || String(markdown),
    author: String(meta.author || fallback.author || ''),
    rawId: fallback.rawId || '',
    sha256: fallback.sha256 || '',
    important: Boolean(fallback.important),
    recommend: String(fallback.recommend || ''),
  }
}

// ---------------------------------------------------------------- tools

function textResult(value) {
  return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }]
}

async function requireAdmin(cfg) {
  const status = await hubCall(cfg, '/api/status')
  if (!status.member || status.member.role !== 'admin') throw new Error('需要管理员权限')
  return status
}

function validateRecommend(important, recommend) {
  if (!important) return ''
  const text = String(recommend || '').trim()
  if ([...text].length < RECOMMEND_MIN) {
    throw new Error(`标记为重要必须手写推荐语，至少 ${RECOMMEND_MIN} 字（当前 ${[...text].length} 字）。这是防止滥发重要的硬性要求。`)
  }
  if ([...text].length > RECOMMEND_MAX) throw new Error(`推荐语最多 ${RECOMMEND_MAX} 字`)
  return text
}

function defineTools(ctx, readCfg) {
  const register = (definition) => ctx.tools.register(definition)
  const output = { schema: { type: 'object' }, render: (_args, value) => textResult(value) }

  // ---------------------------------------------------------------- search
  register({
    name: 'skb_search',
    description: '检索团队共享知识库（跨成员、跨会话），同时搜本机私有库。回答业务问题、复述历史决策或找现成资料前先用它。compact=true 时只回目录（id/标题/摘要/分类/是否重要），最省 token，适合先摸清有哪些资料。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '关键词或自然语言问题；中文按二元组匹配' },
        category: { type: 'string', enum: CATEGORIES, description: '可选：只在这一类里搜' },
        author: { type: 'string', description: '可选：只搜某个上传者的' },
        important: { type: 'string', enum: ['only', 'exclude'], description: '可选：只看重要资料 / 排除重要资料' },
        compact: { type: 'boolean', description: '只返回目录级字段，不返回要点与片段（省 token）' },
        limit: { type: 'integer', description: '返回条数，默认 8，最多 50' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    output,
    async execute(args, exec) {
      const cfg = readCfg()
      const limit = Math.max(1, Math.min(50, Number(args && args.limit) || 8))
      const qs = new URLSearchParams({ q: String(args.query || ''), limit: String(limit) })
      if (args.category) qs.set('category', args.category)
      if (args.author) qs.set('author', args.author)
      if (args.important) qs.set('important', args.important)
      if (args.compact) qs.set('compact', '1')
      const data = await hubCall(cfg, `/api/search?${qs}`, { signal: exec.signal })
      const local = searchPrivate(cfg, String(args.query || ''), {
        limit, category: args.category, author: args.author, important: args.important, compact: args.compact,
      })
      const items = [...(data.items || []), ...local].slice(0, limit)
      if (!items.length) return { ok: true, total: 0, items: [], hint: '共享库里没有命中；可以换短词，或确认是否还没入库。' }
      return { ok: true, total: data.total + local.length, items }
    },
  })

  register({
    name: 'skb_recall',
    description: '按主题一次性取回多篇文档的摘要与要点（聚合摘要），用来一次性拿到答案的骨架，替代「搜一堆再逐个读全文」。比逐个 skb_read 省大量上下文。',
    parameters: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: '主题或问题' },
        category: { type: 'string', enum: CATEGORIES, description: '可选：限定分类' },
        limit: { type: 'integer', description: '最多聚合几篇，默认 6，最多 20' },
      },
      required: ['topic'],
      additionalProperties: false,
    },
    output,
    async execute(args, exec) {
      const cfg = readCfg()
      const limit = Math.max(1, Math.min(20, Number(args && args.limit) || 6))
      const qs = new URLSearchParams({ topic: String(args.topic || ''), limit: String(limit) })
      if (args.category) qs.set('category', args.category)
      const data = await hubCall(cfg, `/api/recall?${qs}`, { signal: exec.signal })
      return { ok: true, ...data }
    },
  })

  register({
    name: 'skb_read',
    description: '按 id 读取一篇共享知识库文档的完整 Markdown（含分类、十字摘要、要点、版本）。通常先 skb_search 再 skb_read。会自动把这篇记为「已读」。',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string', description: '文档 id' } },
      required: ['id'],
      additionalProperties: false,
    },
    output,
    async execute(args, exec) {
      const cfg = readCfg()
      const id = String(args.id || '')
      if (id.startsWith('priv_')) {
        const doc = getPrivateDoc(cfg, id)
        if (!doc) throw new Error('本机私有库里没有这篇：' + id)
        return { ok: true, scope: 'private', doc }
      }
      const data = await hubCall(cfg, `/api/doc/open?id=${encodeURIComponent(id)}`, { signal: exec.signal })
      return { ok: true, doc: data.doc }
    },
  })

  register({
    name: 'skb_list',
    description: '列出共享知识库最近文档，可按分类、标签、上传者、重要性过滤，用来了解团队都有哪些资料。',
    parameters: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: CATEGORIES, description: '只列这一类' },
        tag: { type: 'string', description: '只列含该标签的文档' },
        author: { type: 'string', description: '只列这个上传者的' },
        important: { type: 'string', enum: ['only', 'exclude'], description: '只看重要 / 排除重要' },
        sort: { type: 'string', enum: ['updated', 'created', 'important'], description: '排序方式' },
        limit: { type: 'integer', description: '默认 30，最多 200' },
      },
      additionalProperties: false,
    },
    output,
    async execute(args, exec) {
      const limit = Math.max(1, Math.min(200, Number(args && args.limit) || 30))
      const qs = new URLSearchParams({ limit: String(limit) })
      for (const key of ['category', 'tag', 'author', 'important', 'sort']) {
        if (args[key]) qs.set(key, args[key])
      }
      return hubCall(readCfg(), `/api/list?${qs}`, { signal: exec.signal })
    },
  })

  // ---------------------------------------------------------------- upload / commit
  register({
    name: 'skb_upload',
    description: '上传一个素材文件。scope=public 进团队共享库（默认），scope=private 只存本机私有库、不上传任何服务器。pending=true 表示「先不整理，直接存为待整理」，之后再整理。标记 important=true 时必须同时给 recommend（手写推荐语，至少 10 字）。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '工作区内的文件路径（相对或绝对）' },
        title: { type: 'string', description: '素材标题，默认用文件名' },
        tags: { type: 'array', items: { type: 'string' }, description: '建议标签' },
        scope: { type: 'string', enum: ['public', 'private'], description: 'public=团队共享（默认）；private=仅自己可见、只存本机' },
        pending: { type: 'boolean', description: '先不整理，直接存为待整理' },
        important: { type: 'boolean', description: '标记为重要资料（会推送到全员置顶）' },
        recommend: { type: 'string', description: '推荐语，important=true 时必填，10~200 字' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    output,
    async execute(args, exec) {
      const cfg = readCfg()
      let cwd = process.cwd()
      const wd = ctx.get('workingDirectory')
      if (wd && exec.agent && typeof wd.ensure === 'function') {
        try { cwd = await wd.ensure(exec.agent) } catch { /* fall back */ }
      }
      const filePath = path.resolve(cwd, String(args.path || ''))
      const stat = fs.statSync(filePath)
      if (!stat.isFile()) throw new Error('不是文件：' + filePath)
      if (stat.size > MAX_UPLOAD) throw new Error('文件超过 64MB')
      const bytes = fs.readFileSync(filePath)
      const name = safeName(filePath)
      const recommend = validateRecommend(args.important, args.recommend)
      const text = textOf(bytes, filePath)

      if (args.scope === 'private') {
        const store = privateStore(cfg)
        const put = store.putRaw({ name, title: args.title || name, tags: args.tags, author: cfg.member, bytes, important: args.important, recommend, pending: args.pending })
        return {
          ok: true,
          scope: 'private',
          duplicate: put.duplicate,
          rawId: put.raw.id,
          name: put.raw.name,
          preview: text ? text.slice(0, 6000) : null,
          note: '已存到本机私有库（仅自己可见，未上传服务器）。用 skb_private 的 add 动作整理入库，或 skb_commit 时带 scope=private。',
        }
      }

      const data = await uploadToHub(cfg, {
        name, title: args.title || name, tags: args.tags, author: cfg.member, bytes,
        important: args.important, recommend, pending: args.pending,
      })
      if (data.duplicate) {
        return {
          ok: true,
          duplicate: true,
          rawId: data.raw.id,
          name: data.raw.name,
          existingDoc: data.doc || null,
          note: data.doc ? `已存在同一文件，已归档为《${data.doc.title}》` : '已存在同一文件，但还没整理成文',
        }
      }
      return {
        ok: true,
        duplicate: false,
        rawId: data.raw.id,
        name,
        bytes: stat.size,
        preview: text ? text.slice(0, 6000) : null,
        pending: Boolean(args.pending),
        note: args.pending
          ? '已存为待整理素材（未调用模型）。确认要整理时用 skb_inbox + skb_read_raw 取回内容，再按规范 skb_commit。'
          : (text
            ? '已上传原始素材。请按 shared-kb 技能整理后调用 skb_commit（带 rawId）。'
            : '二进制素材已上传；如需整理，请先用你的工具读取/转换该文件。'),
      }
    },
  })

  register({
    name: 'skb_commit',
    description: '把整理好的文档写入知识库（新建或更新同 id）。字段按 inbox-triage 规范：category 十类之一、summary ≤10 字、points 2~4 条、confidence 高/中/低。scope=private 写本机私有库。标记 important 时必须给 recommend。baseVersion 用于并发冲突检测。',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '长标题' },
        markdown: { type: 'string', description: '正文（可含 frontmatter，会被解析并去掉）' },
        category: { type: 'string', enum: CATEGORIES, description: '分类' },
        summary: { type: 'string', description: '不超过 10 个字的总结，像文件名' },
        description: { type: 'string', description: '可选的一句话说明' },
        confidence: { type: 'string', enum: ['高', '中', '低'] },
        tags: { type: 'array', items: { type: 'string' } },
        points: { type: 'array', items: { type: 'string' }, description: '2~4 条要点' },
        rawId: { type: 'string', description: '来源素材 id' },
        id: { type: 'string', description: '更新已有文档时传它的 id' },
        scope: { type: 'string', enum: ['public', 'private'], description: 'public=团队共享（默认）；private=只写本机私有库' },
        important: { type: 'boolean', description: '标记为重要资料' },
        recommend: { type: 'string', description: '推荐语，important=true 时必填，10~200 字' },
        baseVersion: { type: 'integer', description: '你编辑时看到的版本号，用于冲突检测' },
      },
      required: [],
      additionalProperties: false,
    },
    output,
    async execute(args, exec) {
      const cfg = readCfg()
      const parsed = parseFrontmatter(args.markdown || '')
      const meta = parsed.meta || {}
      const recommend = validateRecommend(args.important, args.recommend || meta.recommend)
      const payload = {
        title: String(args.title || meta.title || '').trim(),
        markdown: parsed.body || String(args.markdown || ''),
        category: args.category || (CATEGORIES.includes(meta.category) ? meta.category : '99_待分类'),
        summary: clampSummary(args.summary || meta.summary || ''),
        description: String(args.description || meta.description || '').slice(0, 500),
        confidence: args.confidence || (['高', '中', '低'].includes(meta.confidence) ? meta.confidence : ''),
        tags: splitTags(args.tags && args.tags.length ? args.tags : meta.tags),
        points: Array.isArray(args.points) && args.points.length ? args.points.slice(0, 12) : (Array.isArray(meta.points) ? meta.points.slice(0, 12) : []),
        rawId: args.rawId || (meta.source && String(meta.source).startsWith('raw/') ? String(meta.source).slice(4) : ''),
        id: args.id || '',
        important: Boolean(args.important),
        recommend,
        baseVersion: args.baseVersion,
      }
      if (args.scope === 'private') {
        const doc = privatePut(privateStore(cfg), payload, cfg.member)
        return { ok: true, scope: 'private', doc, receipt: `已收（仅自己可见）｜${doc.category} · ${doc.summary || doc.title}` }
      }
      const data = await hubCall(cfg, '/api/docs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: exec.signal,
      })
      return { ok: true, doc: data.doc, receipt: `已收｜${data.doc.category} · ${data.doc.summary || data.doc.title}` }
    },
  })

  register({
    name: 'skb_inbox',
    description: '列出还没整理成文的原始素材（自动整理失败、主动选「待整理」、或非文本素材会留在这里）。',
    parameters: {
      type: 'object',
      properties: { limit: { type: 'integer', description: '默认 20，最多 100' } },
      additionalProperties: false,
    },
    output,
    async execute(args, exec) {
      const data = await hubCall(readCfg(), '/api/inbox?status=new', { signal: exec.signal })
      const limit = Math.max(1, Math.min(100, Number(args && args.limit) || 20))
      return { ok: true, total: data.items.length, items: data.items.slice(0, limit) }
    },
  })

  register({
    name: 'skb_read_raw',
    description: '读取一条待整理原始素材的内容（按 skb_inbox 返回的 id）。文本类直接返回全文；二进制只返回元数据。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '原始素材 id' },
        maxChars: { type: 'integer', description: '最多返回多少字符，默认 20000' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    output,
    async execute(args, exec) {
      const cfg = readCfg()
      const inbox = await hubCall(cfg, '/api/inbox?status=all', { signal: exec.signal })
      const meta = (inbox.items || []).find((item) => item.id === args.id)
      if (!meta) throw new Error('素材不存在：' + args.id)
      const upstream = await hubCall(cfg, `/api/raw?id=${encodeURIComponent(args.id)}`, { signal: exec.signal })
      const bytes = Buffer.from(await upstream.arrayBuffer())
      const text = textOf(bytes, meta.name)
      const maxChars = Math.max(200, Math.min(100000, Number(args.maxChars) || 20000))
      return {
        ok: true,
        meta,
        text: text === null ? null : text.slice(0, maxChars),
        truncated: text !== null && text.length > maxChars,
        note: text === null ? '二进制素材，请先用你的工具转换后再整理。' : '请按 shared-kb 技能整理后调用 skb_commit（rawId 用本条 id）。',
      }
    },
  })

  register({
    name: 'skb_status',
    description: '查看共享知识库连接状态、当前成员与角色、文档数、待整理数量、未读重要资料数、本机私有库数量。排查「为什么搜不到」时先调用它。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output,
    async execute(_args, exec) {
      const cfg = readCfg()
      const status = await hubCall(cfg, '/api/status', { signal: exec.signal })
      const inbox = await hubCall(cfg, '/api/inbox?status=new', { signal: exec.signal })
      let privateCount = 0
      try { privateCount = privateStore(cfg).docs.size } catch { /* ignore */ }
      return { ...status, hubUrl: cfg.hubUrl, privateCount, privateDir: cfg.privateDir, inboxItems: inbox.items.slice(0, 20) }
    },
  })

  // ---------------------------------------------------------------- new: recall-adjacent
  register({
    name: 'skb_weekly',
    description: '查看本周知识库报告：新增了哪些、哪些被标为重要、谁贡献最多、分类分布。用于汇报或回顾。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output,
    async execute(_args, exec) {
      const data = await hubCall(readCfg(), '/api/weekly', { signal: exec.signal })
      return { ok: true, ...data.report }
    },
  })

  register({
    name: 'skb_collect',
    description: '管理「我的收藏夹」：可建多个收藏夹、重命名、删除，把文档放进/移出收藏夹。收藏夹跟账号走（存在 Hub），换设备能同步。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'create', 'rename', 'remove', 'add', 'remove_doc'], description: '动作' },
        name: { type: 'string', description: '收藏夹名（create/rename 用）' },
        collectionId: { type: 'string', description: '收藏夹 id（add/remove_doc/rename/remove 用，优先于 name）' },
        ids: { type: 'array', items: { type: 'string' }, description: '要放入/移出的文档 id' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output,
    async execute(args, exec) {
      const cfg = readCfg()
      const action = String(args.action || '')
      if (action === 'list') return hubCall(cfg, '/api/collections', { signal: exec.signal })
      const body = {
        action: action === 'remove_doc' ? 'remove-doc' : action,
        name: args.name,
        collectionId: args.collectionId,
        ids: args.ids,
      }
      return hubCall(cfg, '/api/collections', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: exec.signal,
      })
    },
  })

  register({
    name: 'skb_recommend',
    description: '把一篇文档标为「重要资料」并写推荐语——它会出现在所有成员的置顶提醒里，直到每个人自己读完才能消除。推荐语必须手写、10~200 字、说明「为什么值得所有人看」。unmark=true 取消重要标记。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '文档 id' },
        recommend: { type: 'string', description: '手写推荐语，10~200 字' },
        unmark: { type: 'boolean', description: '取消重要标记' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    output,
    async execute(args, exec) {
      const cfg = readCfg()
      if (args.unmark) {
        const data = await hubCall(cfg, '/api/docs', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: args.id, important: false }), signal: exec.signal,
        })
        return { ok: true, doc: data.doc, note: '已取消重要标记' }
      }
      const recommend = validateRecommend(true, args.recommend)
      const data = await hubCall(cfg, '/api/docs', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: args.id, important: true, recommend }), signal: exec.signal,
      })
      return { ok: true, doc: data.doc, note: '已标为重要资料，会推送到全员置顶' }
    },
  })

  register({
    name: 'skb_comment',
    description: '文档评论：查看/发表/删除评论。评论里写 @某人 会通知那个人（对方打开知识库能看到）。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'add', 'delete'], description: '动作' },
        id: { type: 'string', description: '文档 id' },
        text: { type: 'string', description: '评论内容（add 用），可含 @名字' },
        commentId: { type: 'string', description: '要删除的评论 id（delete 用）' },
      },
      required: ['action', 'id'],
      additionalProperties: false,
    },
    output,
    async execute(args, exec) {
      const cfg = readCfg()
      const action = String(args.action || '')
      if (action === 'list') {
        return hubCall(cfg, `/api/comments?id=${encodeURIComponent(args.id)}`, { signal: exec.signal })
      }
      if (action === 'add') {
        return hubCall(cfg, '/api/comments', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: args.id, text: args.text }), signal: exec.signal,
        })
      }
      if (action === 'delete') {
        return hubCall(cfg, '/api/comments/delete', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: args.id, commentId: args.commentId }), signal: exec.signal,
        })
      }
      throw new Error('未知评论动作：' + action)
    },
  })

  register({
    name: 'skb_private',
    description: '本机私有库（仅自己可见，永不上传服务器）：查看、检索、写入、删除。处理个人隐私、草稿、还没准备公开的材料时用它。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'get', 'add', 'delete', 'search', 'stats'], description: '动作' },
        id: { type: 'string', description: '文档 id（get/delete 用）' },
        query: { type: 'string', description: '检索词（search 用）' },
        title: { type: 'string', description: '标题（add 用）' },
        markdown: { type: 'string', description: '正文（add 用）' },
        category: { type: 'string', enum: CATEGORIES, description: '分类（add 用）' },
        summary: { type: 'string', description: '不超过 10 字的总结（add 用）' },
        tags: { type: 'array', items: { type: 'string' }, description: '标签（add 用）' },
        points: { type: 'array', items: { type: 'string' }, description: '要点（add 用）' },
        limit: { type: 'integer', description: '返回条数' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output,
    async execute(args, exec) {
      const cfg = readCfg()
      const store = privateStore(cfg)
      const action = String(args.action || '')
      const limit = Math.max(1, Math.min(200, Number(args.limit) || 30))
      if (action === 'stats') {
        return { ok: true, dir: store.root, docs: store.docs.size, raw: store.raw.size, ...store.stats() }
      }
      if (action === 'list') {
        const data = store.listDocs({ limit })
        return { ok: true, dir: store.root, total: data.total, items: data.items.map((d) => ({ ...d, scope: 'private' })) }
      }
      if (action === 'get') {
        const doc = store.getDoc(String(args.id || ''))
        if (!doc) throw new Error('私有库里没有这篇：' + args.id)
        return { ok: true, doc: { ...doc, scope: 'private' } }
      }
      if (action === 'search') {
        const data = store.search(String(args.query || ''), { limit })
        return { ok: true, total: data.total, items: data.items.map((d) => ({ ...d, scope: 'private' })) }
      }
      if (action === 'add') {
        if (!args.title) throw new Error('add 需要 title')
        const doc = privatePut(store, {
          title: args.title,
          markdown: String(args.markdown || ''),
          category: args.category || '99_待分类',
          summary: clampSummary(args.summary || ''),
          tags: splitTags(args.tags),
          points: Array.isArray(args.points) ? args.points : [],
          id: args.id,
        }, cfg.member)
        return { ok: true, scope: 'private', doc }
      }
      if (action === 'delete') {
        store.deleteDoc(String(args.id || ''), cfg.member, 'admin')
        return { ok: true, deleted: args.id }
      }
      throw new Error('未知私有库动作：' + action)
    },
  })

  register({
    name: 'skb_admin',
    description: '管理员操作：查看统计、审计日志、增删成员、轮换令牌、删除文档、批量删除、删除或跳过原始素材。仅 Hub 角色为 admin 时可用。',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['stats', 'members', 'audit', 'add_member', 'remove_member', 'rotate_member', 'delete_doc', 'batch_delete', 'delete_raw', 'skip_raw'],
          description: '要执行的管理动作',
        },
        name: { type: 'string', description: '成员名（add/remove/rotate 用）' },
        role: { type: 'string', enum: ['member', 'admin'], description: 'add_member 时的角色，默认 member' },
        id: { type: 'string', description: '文档或素材 id（delete/skip 用）' },
        ids: { type: 'array', items: { type: 'string' }, description: '批量删除的文档 id 列表' },
        reason: { type: 'string', description: 'skip_raw 的原因' },
        limit: { type: 'integer', description: 'audit 返回条数，默认 100' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output,
    async execute(args, exec) {
      const cfg = readCfg()
      await requireAdmin(cfg)
      const action = String(args.action || '')
      const post = (endpoint, body) => hubCall(cfg, endpoint, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: exec.signal,
      })
      if (action === 'stats') return hubCall(cfg, '/api/stats', { signal: exec.signal })
      if (action === 'members') return hubCall(cfg, '/api/members', { signal: exec.signal })
      if (action === 'audit') {
        const limit = Math.max(1, Math.min(1000, Number(args.limit) || 100))
        return hubCall(cfg, `/api/audit?limit=${limit}`, { signal: exec.signal })
      }
      if (action === 'add_member') {
        const data = await post('/api/members', { name: args.name, role: args.role || 'member' })
        const code = `skb1.${Buffer.from(JSON.stringify({ u: cfg.publicUrl || cfg.hubUrl, t: data.member.token, n: data.member.name })).toString('base64url')}`
        return { ok: true, member: data.member, inviteCode: code }
      }
      if (action === 'remove_member') return post('/api/members/remove', { name: args.name })
      if (action === 'rotate_member') {
        const data = await post('/api/members/rotate', { name: args.name })
        const code = `skb1.${Buffer.from(JSON.stringify({ u: cfg.publicUrl || cfg.hubUrl, t: data.member.token, n: data.member.name })).toString('base64url')}`
        return { ok: true, member: data.member, inviteCode: code }
      }
      if (action === 'delete_doc') return post('/api/docs/delete', { id: args.id })
      if (action === 'batch_delete') return post('/api/docs/batch-delete', { ids: args.ids || [] })
      if (action === 'delete_raw') return post('/api/raw/delete', { id: args.id })
      if (action === 'skip_raw') return post('/api/raw/skip', { id: args.id, reason: args.reason })
      throw new Error('未知管理动作：' + action)
    },
  })
}

// ---------------------------------------------------------------- private helpers

function searchPrivate(cfg, query, { limit = 10, category, author, important, compact } = {}) {
  try {
    const store = privateStore(cfg)
    const data = store.search(query, { limit, category, author, important, compact })
    return (data.items || []).map((item) => ({ ...item, scope: 'private' }))
  } catch { return [] }
}

function getPrivateDoc(cfg, id) {
  try {
    const doc = privateStore(cfg).getDoc(String(id))
    return doc ? { ...doc, scope: 'private' } : null
  } catch { return null }
}

// ---------------------------------------------------------------- skills

/**
 * 首次激活时把随包技能装进用户技能目录（只补缺失，不覆盖用户改动）。
 * 成员因此不需要再手动复制技能：装插件 = 装工具 + 装规范。
 */
function ensureSkills(logger) {
  try {
    const root = path.join(dshHome(), 'skills')
    fs.mkdirSync(root, { recursive: true })
    const bundled = path.join(__dirname, 'skills')
    if (!fs.existsSync(bundled)) return
    const install = (source, name) => {
      const dest = path.join(root, name)
      if (fs.existsSync(path.join(dest, 'SKILL.md'))) return
      fs.cpSync(source, dest, { recursive: true })
      logger?.info?.(`[dsh-shared-kb] 已安装技能：${name}`)
    }
    install(path.join(bundled, 'shared-kb'), 'shared-kb')
    for (const name of ['long-dialogue-knowledge', 'controversy-analysis', 'idea-synthesis']) {
      const source = path.join(bundled, 'upstream', name)
      if (fs.existsSync(source)) install(source, name)
    }
  } catch (error) {
    logger?.warn?.(`[dsh-shared-kb] 技能安装失败：${(error && error.message) || error}`)
  }
}

// ---------------------------------------------------------------- plugin

function apply(ctx, config) {
  const readCfg = () => readConfig(config)
  const logger = ctx.logger || console

  ensureSkills(logger)
  defineTools(ctx, readCfg)

  const prompt = ctx.get('systemPrompt')
  if (prompt && typeof prompt.section === 'function') {
    ctx.effect(() => prompt.section({
      name: 'shared-kb',
      order: 148,
      text: () => {
        const cfg = readCfg()
        if (!cfg.token) return ''
        return [
          '## 团队共享知识库',
          `团队有一个跨成员的共享知识库（Hub：${cfg.hubUrl}），当前成员：${cfg.member || '未命名'}；本机还有一个仅自己可见的私有库。`,
          '查资料先用 skb_recall（一次拿回多篇的摘要+要点，最省上下文）；不够再 skb_search（compact=true 只看目录）；需要原文才 skb_read。回答时给出文档标题。',
          '用户说「入库 / 收录 / 整理 / 存到知识库」时，按 shared-kb 技能执行：先查重，再 skb_upload 原始素材，按 inbox-triage 的十类 + ≤10 字总结 + 置信度整理后 skb_commit。',
          '内容涉及个人隐私、未定稿的草稿、不愿公开的材料时，用 scope=private 存进本机私有库（skb_upload / skb_commit 都支持），不要默认公开。',
          '用户说「先不整理」「直接存着」时，skb_upload 加 pending=true，不要调用模型整理。',
          '要标记重要资料用 skb_recommend，必须手写 10 字以上推荐语说明为什么值得全员看；不要用它刷存在感。',
          '有待整理素材时用 skb_inbox 列表、skb_read_raw 读原文，整理后 skb_commit。',
          '收藏夹用 skb_collect，评论与 @ 用 skb_comment，周报用 skb_weekly。',
          '管理员还可以用 skb_admin 管理成员、删除文档或素材、查看审计日志。',
        ].join('\n')
      },
    }), 'dsh-shared-kb: prompt section')
  }

  const webServer = ctx.get('webServer')
  if (!webServer || typeof webServer.register !== 'function') {
    logger.warn?.('[dsh-shared-kb] webServer 不可用，页面 API 未注册')
    return
  }

  const proxy = async (cfg, pathname, options) => hubCall(cfg, pathname, options)
  const post = (cfg, endpoint, payload) => proxy(cfg, endpoint, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
  })

  ctx.effect(() => webServer.register({
    kind: 'prefix',
    path: API_PREFIX,
    handler: async (req, res) => {
      const connection = ctx.get('connection')
      if (connection && typeof connection.requestRejection === 'function') {
        const rejection = connection.requestRejection(req)
        if (rejection !== undefined) { res.writeHead(rejection); res.end(); return }
      }
      const cfg = readCfg()
      try {
        const url = new URL(req.url || '/', 'http://dsh.local')
        const rest = url.pathname.slice(API_PREFIX.length) || '/'
        const q = url.searchParams

        // ------------------------------------------------ 配置
        if (req.method === 'GET' && rest === '/config') {
          const file = readConfigFile()
          let privateCount = 0
          try { privateCount = privateStore(cfg).docs.size } catch { /* ignore */ }
          sendJson(res, 200, {
            ok: true,
            hubUrl: cfg.hubUrl,
            publicUrl: cfg.publicUrl,
            member: cfg.member,
            model: cfg.model,
            autoNormalize: cfg.autoNormalize,
            privateDir: cfg.privateDir,
            privateCount,
            token: cfg.token ? `${cfg.token.slice(0, 4)}…${cfg.token.slice(-4)}` : '',
            hasToken: Boolean(cfg.token),
            source: file.token || file.hubUrl ? 'file' : 'config',
          })
          return
        }
        if (req.method === 'POST' && rest === '/config') {
          const payload = await readJsonBody(req, 64 * 1024)
          const next = readConfigFile()
          for (const key of ['hubUrl', 'publicUrl', 'token', 'member', 'model', 'privateDir']) {
            if (typeof payload[key] === 'string') next[key] = payload[key].trim()
          }
          if (typeof payload.autoNormalize === 'boolean') next.autoNormalize = payload.autoNormalize
          writeConfigFile(next)
          privateCache = null
          sendJson(res, 200, { ok: true })
          return
        }

        // ------------------------------------------------ 状态 / 列表 / 搜索
        if (req.method === 'GET' && (rest === '/' || rest === '/status')) {
          const status = await proxy(cfg, '/api/status')
          let privateCount = 0
          try { privateCount = privateStore(cfg).docs.size } catch { /* ignore */ }
          sendJson(res, 200, {
            ok: true,
            ...status,
            hubUrl: cfg.hubUrl,
            publicUrl: cfg.publicUrl,
            autoNormalize: cfg.autoNormalize,
            privateCount,
            privateDir: cfg.privateDir,
            tokenConfigured: Boolean(cfg.token),
          })
          return
        }

        if (req.method === 'GET' && rest === '/list') {
          const scope = q.get('scope') || 'public'
          const filter = {
            category: q.get('category') || '',
            tag: q.get('tag') || '',
            author: q.get('author') || '',
            important: q.get('important') || '',
            collection: q.get('collection') || '',
            sort: q.get('sort') || '',
          }
          let publicItems = []
          let publicTotal = 0
          let publicAuthors = []
          let localItems = []
          let localTotal = 0
          let localAuthors = []
          if (scope !== 'private') {
            const qs = new URLSearchParams({ limit: q.get('limit') || '60' })
            for (const [key, value] of Object.entries(filter)) if (value) qs.set(key, value)
            const data = await proxy(cfg, `/api/list?${qs}`)
            publicItems = (data.items || []).map((d) => ({ ...d, scope: 'public' }))
            publicTotal = data.total
            // 上传者清单必须覆盖整库，而不是当前这一页，否则 limit 一小筛选下拉就残缺。
            publicAuthors = Array.isArray(data.authors) ? data.authors : []
          }
          if (scope !== 'public' && !filter.collection) {
            const store = privateStore(cfg)
            const data = store.listDocs({ ...filter, limit: Math.max(1, Math.min(500, Number(q.get('limit')) || 200)) })
            localItems = data.items.map((d) => ({ ...d, scope: 'private' }))
            localTotal = data.total
            localAuthors = store.authors()
          }
          const all = [...publicItems, ...localItems]
          all.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
          sendJson(res, 200, {
            ok: true,
            total: publicTotal + localTotal,
            items: all,
            publicTotal,
            privateTotal: localTotal,
            authors: mergeAuthorCounts(publicAuthors, localAuthors),
          })
          return
        }

        if (req.method === 'GET' && rest === '/search') {
          const limit = Math.min(Math.max(Number(q.get('limit')) || 20, 1), 100)
          const query = q.get('q') || ''
          const compact = q.get('compact') === '1' || q.get('compact') === 'true'
          const data = await proxy(cfg, `/api/search?${new URLSearchParams({
            q: query,
            limit: String(limit),
            ...(q.get('category') ? { category: q.get('category') } : {}),
            ...(q.get('author') ? { author: q.get('author') } : {}),
            ...(q.get('important') ? { important: q.get('important') } : {}),
            ...(compact ? { compact: '1' } : {}),
          })}`)
          const local = searchPrivate(cfg, query, {
            limit, category: q.get('category') || '', author: q.get('author') || '', important: q.get('important') || '', compact,
          })
          const items = [...(data.items || []).map((d) => ({ ...d, scope: 'public' })), ...local]
          items.sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
          sendJson(res, 200, { ok: true, total: data.total + local.length, items: items.slice(0, limit) })
          return
        }

        if (req.method === 'GET' && rest === '/recall') {
          const qs = new URLSearchParams({ topic: q.get('topic') || q.get('q') || '', limit: q.get('limit') || '6' })
          if (q.get('category')) qs.set('category', q.get('category'))
          sendJson(res, 200, await proxy(cfg, `/api/recall?${qs}`))
          return
        }

        if (req.method === 'GET' && rest === '/doc') {
          const id = q.get('id') || ''
          if (String(id).startsWith('priv_')) {
            const doc = getPrivateDoc(cfg, id)
            if (!doc) { sendJson(res, 404, { ok: false, error: '私有库没有这篇' }); return }
            sendJson(res, 200, { ok: true, doc })
            return
          }
          sendJson(res, 200, await proxy(cfg, `/api/doc?id=${encodeURIComponent(id)}`))
          return
        }
        if (req.method === 'GET' && rest === '/doc/open') {
          const id = q.get('id') || ''
          if (String(id).startsWith('priv_')) {
            const doc = getPrivateDoc(cfg, id)
            if (!doc) { sendJson(res, 404, { ok: false, error: '私有库没有这篇' }); return }
            sendJson(res, 200, { ok: true, id, marked: false, doc })
            return
          }
          sendJson(res, 200, await proxy(cfg, `/api/doc/open?id=${encodeURIComponent(id)}`))
          return
        }

        if (req.method === 'GET' && rest === '/history') {
          const id = q.get('id') || ''
          if (String(id).startsWith('priv_')) {
            const store = privateStore(cfg)
            sendJson(res, 200, { ok: true, ...store.history(id) })
            return
          }
          sendJson(res, 200, await proxy(cfg, `/api/history?id=${encodeURIComponent(id)}`))
          return
        }

        // ------------------------------------------------ 重要 / 收藏 / 评论 / @
        if (req.method === 'GET' && rest === '/important') {
          sendJson(res, 200, await proxy(cfg, '/api/important'))
          return
        }
        if (req.method === 'POST' && rest === '/important/ack') {
          sendJson(res, 200, await post(cfg, '/api/important/ack', await readJsonBody(req)))
          return
        }
        if (req.method === 'GET' && rest === '/collections') {
          sendJson(res, 200, await proxy(cfg, '/api/collections'))
          return
        }
        if (req.method === 'POST' && rest === '/collections') {
          sendJson(res, 200, await post(cfg, '/api/collections', await readJsonBody(req)))
          return
        }
        if (req.method === 'GET' && rest === '/comments') {
          const id = q.get('id') || ''
          if (String(id).startsWith('priv_')) {
            sendJson(res, 200, { ok: true, items: privateStore(cfg).commentList(id) })
            return
          }
          sendJson(res, 200, await proxy(cfg, `/api/comments?id=${encodeURIComponent(id)}`))
          return
        }
        if (req.method === 'POST' && rest === '/comments') {
          const payload = await readJsonBody(req)
          if (String(payload.id || '').startsWith('priv_')) {
            sendJson(res, 200, { ok: true, comment: privateStore(cfg).addComment(payload.id, payload.text, cfg.member) })
            return
          }
          sendJson(res, 200, await post(cfg, '/api/comments', payload))
          return
        }
        if (req.method === 'POST' && rest === '/comments/delete') {
          const payload = await readJsonBody(req)
          if (String(payload.id || '').startsWith('priv_')) {
            sendJson(res, 200, privateStore(cfg).deleteComment(payload.id, payload.commentId, cfg.member, 'admin'))
            return
          }
          sendJson(res, 200, await post(cfg, '/api/comments/delete', payload))
          return
        }
        if (req.method === 'GET' && rest === '/mentions') {
          sendJson(res, 200, await proxy(cfg, '/api/mentions'))
          return
        }
        if (req.method === 'POST' && rest === '/mentions/seen') {
          sendJson(res, 200, await post(cfg, '/api/mentions/seen', {}))
          return
        }

        // ------------------------------------------------ 周报
        if (req.method === 'GET' && rest === '/weekly') {
          const data = await proxy(cfg, '/api/weekly')
          let privateThisWeek = 0
          try {
            const since = data.report.since
            for (const doc of privateStore(cfg).docs.values()) {
              if (String(doc.createdAt) >= since) privateThisWeek += 1
            }
          } catch { /* ignore */ }
          sendJson(res, 200, { ok: true, report: { ...data.report, privateThisWeek } })
          return
        }
        if (req.method === 'POST' && rest === '/weekly/seen') {
          sendJson(res, 200, await post(cfg, '/api/weekly/seen', {}))
          return
        }

        // ------------------------------------------------ 上传 / 提交
        if (req.method === 'POST' && rest === '/upload') {
          const name = safeName(decodeURIComponentSafe(q.get('name') || 'file'))
          const bytes = await readBody(req)
          if (!bytes.length) { sendJson(res, 400, { ok: false, error: '空文件' }); return }
          const tags = q.get('tags') || ''
          const title = q.get('title') || name
          const important = q.get('important') === '1'
          const recommend = q.get('recommend') || ''
          const pending = q.get('pending') === '1'
          const scope = q.get('scope') === 'private' ? 'private' : 'public'
          if (important && [...recommend.trim()].length < RECOMMEND_MIN) {
            sendJson(res, 400, { ok: false, error: `标记为重要必须手写推荐语，至少 ${RECOMMEND_MIN} 字` })
            return
          }

          if (scope === 'private') {
            const store = privateStore(cfg)
            const put = store.putRaw({ name, title, tags, author: cfg.member, bytes, important, recommend, pending })
            const text = textOf(bytes, name)
            let doc = null
            let pendingFlag = true
            let error = ''
            if (!pending && text && text.trim()) {
              try {
                const markdown = await callModel(ctx, cfg, NORMALIZE_SYSTEM, normalizePrompt({ name, member: cfg.member, tags, text, rawId: put.raw.id }))
                doc = privatePut(store, docFromModel(markdown, {
                  title: name, summary: '', author: cfg.member, rawId: put.raw.id, sha256: put.raw.sha256, important, recommend,
                }), cfg.member)
                pendingFlag = false
              } catch (e) {
                error = String((e && e.message) || e)
              }
            } else if (!text) error = '非文本素材，已进入待整理'
            sendJson(res, 200, { ok: true, scope, duplicate: put.duplicate, raw: put.raw, doc, pending: pendingFlag, error })
            return
          }

          const uploaded = await uploadToHub(cfg, { name, title, tags, author: cfg.member, bytes, important, recommend, pending })

          if (uploaded.duplicate) {
            sendJson(res, 200, {
              ok: true,
              scope,
              duplicate: true,
              raw: uploaded.raw,
              doc: uploaded.doc,
              pending: !uploaded.doc,
              error: uploaded.doc ? '' : '文件已上传过但还没整理',
            })
            return
          }

          const raw = uploaded.raw
          let normalized = null
          let pendingFlag = true
          let error = ''
          const text = textOf(bytes, name)
          if (!pending && text && text.trim()) {
            try {
              const markdown = await callModel(ctx, cfg, NORMALIZE_SYSTEM, normalizePrompt({ name, member: cfg.member, tags, text, rawId: raw.id }))
              const doc = docFromModel(markdown, { title: name, summary: '', author: cfg.member, rawId: raw.id, sha256: raw.sha256, important, recommend })
              const saved = await hubCall(cfg, '/api/docs', {
                method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(doc),
              })
              normalized = saved.doc
              pendingFlag = false
            } catch (e) {
              error = String((e && e.message) || e)
            }
          } else if (!text) error = '非文本素材，已进入待整理'
          sendJson(res, 200, { ok: true, scope, duplicate: false, raw, doc: normalized, pending: pendingFlag, error })
          return
        }

        if (req.method === 'POST' && rest === '/commit') {
          const payload = await readJsonBody(req)
          if (String(payload.id || '').startsWith('priv_') || payload.scope === 'private') {
            const doc = privatePut(privateStore(cfg), payload, cfg.member)
            sendJson(res, 200, { ok: true, doc })
            return
          }
          const data = await post(cfg, '/api/docs', payload)
          sendJson(res, 200, { ok: true, doc: data.doc })
          return
        }

        if (req.method === 'POST' && rest === '/delete') {
          const payload = await readJsonBody(req)
          if (String(payload.id || '').startsWith('priv_')) {
            privateStore(cfg).deleteDoc(payload.id, cfg.member, 'admin')
            sendJson(res, 200, { ok: true })
            return
          }
          sendJson(res, 200, await post(cfg, '/api/docs/delete', payload))
          return
        }

        if (req.method === 'POST' && rest === '/batch-delete') {
          const payload = await readJsonBody(req)
          const ids = Array.isArray(payload.ids) ? payload.ids.map(String) : []
          const privateIds = ids.filter((id) => id.startsWith('priv_'))
          const publicIds = ids.filter((id) => !id.startsWith('priv_'))
          const results = []
          if (publicIds.length) {
            const data = await post(cfg, '/api/docs/batch-delete', { ids: publicIds })
            results.push(...data.results)
          }
          if (privateIds.length) {
            const store = privateStore(cfg)
            for (const id of privateIds) {
              try {
                store.deleteDoc(id, cfg.member, 'admin')
                results.push({ id, ok: true })
              } catch (error) {
                results.push({ id, ok: false, error: String((error && error.message) || error) })
              }
            }
          }
          sendJson(res, 200, {
            // 批量操作是「多状态结果」：顶层 ok 表示请求已处理，逐条成败看 results/failed。
            ok: true,
            deleted: results.filter((r) => r.ok).length,
            failed: results.filter((r) => !r.ok).length,
            results,
          })
          return
        }

        if (req.method === 'POST' && rest === '/restore') {
          sendJson(res, 200, await post(cfg, '/api/docs/restore', await readJsonBody(req)))
          return
        }

        // ------------------------------------------------ 批量下载（zip）
        if (req.method === 'GET' && rest === '/batch/download') {
          const ids = String(q.get('ids') || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, MAX_ZIP_FILES)
          if (!ids.length) { sendJson(res, 400, { ok: false, error: 'ids 不能为空' }); return }
          const entries = []
          const used = new Set()
          let total = 0
          let skipped = 0
          const store = (() => { try { return privateStore(cfg) } catch { return null } })()
          for (const id of ids) {
            const doc = id.startsWith('priv_')
              ? (store ? store.getDoc(id) : null)
              : (await (async () => { try { return (await hubCall(cfg, `/api/doc?id=${encodeURIComponent(id)}`)).doc } catch { return null } })())
            if (!doc) { skipped += 1; continue }
            const data = Buffer.from(docToMarkdown(doc), 'utf8')
            total += data.length
            if (total > MAX_ZIP_BYTES) { skipped += 1; continue }
            entries.push({ name: zipEntryName(doc, used), data, mtime: new Date(doc.updatedAt || Date.now()) })
          }
          if (!entries.length) { sendJson(res, 404, { ok: false, error: '没有可打包的文档' }); return }
          const zip = zipStore(entries)
          const stamp = new Date().toISOString().slice(0, 10)
          res.writeHead(200, {
            'content-type': 'application/zip',
            'content-length': zip.length,
            'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`知识库导出-${stamp}.zip`)}`,
            'x-skipped': String(skipped),
          })
          res.end(zip)
          return
        }

        // ------------------------------------------------ 原始素材
        if (req.method === 'GET' && rest === '/inbox') {
          const status = q.get('status') || 'new'
          const author = q.get('author') || ''
          const qs = new URLSearchParams({ status })
          if (author) qs.set('author', author)
          const shared = await proxy(cfg, `/api/inbox?${qs}`)
          const local = privateStore(cfg).listRaw({ status: status === 'all' ? '' : status, author })
          const items = [
            ...local.map((r) => ({ ...r, scope: 'private' })),
            ...(shared.items || []).map((r) => ({ ...r, scope: 'public' })),
          ].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
          sendJson(res, 200, { ok: true, items, total: items.length })
          return
        }
        if (req.method === 'POST' && rest === '/normalize') {
          const body = await readJsonBody(req)
          try {
            const result = await normalizeRawById(ctx, cfg, body.id, body.scope)
            sendJson(res, 200, result)
          } catch (err) {
            sendJson(res, 400, { ok: false, error: String((err && err.message) || err) })
          }
          return
        }
        if (req.method === 'GET' && rest === '/stats') {
          sendJson(res, 200, await proxy(cfg, '/api/stats'))
          return
        }
        if (req.method === 'GET' && rest === '/members') {
          sendJson(res, 200, await proxy(cfg, '/api/members'))
          return
        }
        if (req.method === 'GET' && rest === '/audit') {
          sendJson(res, 200, await proxy(cfg, `/api/audit?limit=${encodeURIComponent(q.get('limit') || '100')}`))
          return
        }
        if (req.method === 'GET' && rest === '/raw') {
          const id = String(q.get('id') || '')
          const local = findPrivateRaw(cfg, id)
          if (local) {
            const got = privateStore(cfg).getRaw(id)
            if (!got) { sendJson(res, 404, { ok: false, error: '素材不存在' }); return }
            const buffer = got.bytes
            res.writeHead(200, {
              'content-type': 'application/octet-stream',
              'content-length': buffer.length,
              'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(got.meta.name || 'raw.bin')}`,
            })
            res.end(buffer)
            return
          }
          if (id.startsWith('priv_')) { sendJson(res, 404, { ok: false, error: '私有库素材走本机路径' }); return }
          const upstream = await proxy(cfg, `/api/raw?id=${encodeURIComponent(id)}`)
          const buffer = Buffer.from(await upstream.arrayBuffer())
          const upstreamDisposition = upstream.headers.get('content-disposition')
          const name = q.get('name')
          res.writeHead(200, {
            'content-type': upstream.headers.get('content-type') || 'application/octet-stream',
            'content-length': buffer.length,
            'content-disposition': upstreamDisposition || `attachment; filename*=UTF-8''${encodeURIComponent(name || 'raw.bin')}`,
          })
          res.end(buffer)
          return
        }
        if (req.method === 'POST' && rest === '/raw/skip') {
          const body = await readJsonBody(req)
          const store = privateStore(cfg)
          if (store.raw.has(String(body.id))) { sendJson(res, 200, { ok: true, scope: 'private', raw: store.skipRaw(body.id, body.reason, cfg.member) }); return }
          sendJson(res, 200, await post(cfg, '/api/raw/skip', body))
          return
        }
        if (req.method === 'POST' && rest === '/raw/touch') {
          const body = await readJsonBody(req)
          const store = privateStore(cfg)
          if (store.raw.has(String(body.id))) { sendJson(res, 200, { ok: true, scope: 'private', raw: store.touchRaw(body.id) }); return }
          sendJson(res, 200, await post(cfg, '/api/raw/touch', body))
          return
        }
        if (req.method === 'POST' && rest === '/raw/delete') {
          const body = await readJsonBody(req)
          const store = privateStore(cfg)
          if (store.raw.has(String(body.id))) { store.deleteRaw(body.id, cfg.member, 'admin'); sendJson(res, 200, { ok: true, scope: 'private' }); return }
          sendJson(res, 200, await post(cfg, '/api/raw/delete', body))
          return
        }

        // ------------------------------------------------ 私有库专用路由
        if (rest.startsWith('/private')) {
          const store = privateStore(cfg)
          const sub = rest.slice('/private'.length) || '/'
          if (req.method === 'GET' && (sub === '/' || sub === '/status')) {
            sendJson(res, 200, {
              ok: true, dir: store.root, docs: store.docs.size, raw: store.raw.size,
              authors: store.authors(), categories: CATEGORIES,
            })
            return
          }
          if (req.method === 'GET' && sub === '/list') {
            const data = store.listDocs({
              category: q.get('category') || '',
              author: q.get('author') || '',
              important: q.get('important') || '',
              sort: q.get('sort') || '',
              limit: Math.min(Math.max(Number(q.get('limit')) || 200, 1), 500),
            })
            sendJson(res, 200, { ok: true, total: data.total, items: data.items.map((d) => ({ ...d, scope: 'private' })), authors: data.authors })
            return
          }
          if (req.method === 'GET' && sub === '/doc') {
            const doc = getPrivateDoc(cfg, q.get('id') || '')
            if (!doc) { sendJson(res, 404, { ok: false, error: '私有库没有这篇' }); return }
            sendJson(res, 200, { ok: true, doc })
            return
          }
          if (req.method === 'POST' && sub === '/docs') {
            const doc = privatePut(store, await readJsonBody(req), cfg.member)
            sendJson(res, 200, { ok: true, doc })
            return
          }
          if (req.method === 'POST' && sub === '/docs/delete') {
            const payload = await readJsonBody(req)
            store.deleteDoc(String(payload.id || ''), cfg.member, 'admin')
            sendJson(res, 200, { ok: true })
            return
          }
          if (req.method === 'GET' && sub === '/history') {
            sendJson(res, 200, { ok: true, ...store.history(q.get('id') || '') })
            return
          }
          if (req.method === 'GET' && sub === '/comments') {
            sendJson(res, 200, { ok: true, items: store.commentList(q.get('id') || '') })
            return
          }
          if (req.method === 'POST' && sub === '/comments') {
            const payload = await readJsonBody(req)
            sendJson(res, 200, { ok: true, comment: store.addComment(payload.id, payload.text, cfg.member) })
            return
          }
          if (req.method === 'POST' && sub === '/comments/delete') {
            const payload = await readJsonBody(req)
            sendJson(res, 200, store.deleteComment(payload.id, payload.commentId, cfg.member, 'admin'))
            return
          }
          if (req.method === 'GET' && sub === '/raw') {
            const raw = store.getRaw(q.get('id') || '')
            if (!raw) { sendJson(res, 404, { ok: false, error: '素材不存在' }); return }
            res.writeHead(200, {
              'content-type': 'application/octet-stream',
              'content-length': raw.bytes.length,
              'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(raw.meta.name)}`,
            })
            res.end(raw.bytes)
            return
          }
          if (req.method === 'POST' && sub === '/raw/delete') {
            const payload = await readJsonBody(req)
            store.deleteRaw(String(payload.id || ''), cfg.member, 'admin')
            sendJson(res, 200, { ok: true })
            return
          }
          sendJson(res, 404, { ok: false, error: 'not found' })
          return
        }

        // ------------------------------------------------ 成员
        if (req.method === 'POST' && rest === '/members') {
          const payload = await readJsonBody(req, 64 * 1024)
          const data = await post(cfg, '/api/members', payload)
          const code = `skb1.${Buffer.from(JSON.stringify({ u: cfg.publicUrl || cfg.hubUrl, t: data.member.token, n: data.member.name })).toString('base64url')}`
          sendJson(res, 200, { ok: true, member: data.member, inviteCode: code })
          return
        }
        if (req.method === 'POST' && rest === '/members/remove') {
          sendJson(res, 200, await post(cfg, '/api/members/remove', await readJsonBody(req, 64 * 1024)))
          return
        }
        if (req.method === 'POST' && rest === '/members/rotate') {
          const data = await post(cfg, '/api/members/rotate', await readJsonBody(req, 64 * 1024))
          const code = `skb1.${Buffer.from(JSON.stringify({ u: cfg.publicUrl || cfg.hubUrl, t: data.member.token, n: data.member.name })).toString('base64url')}`
          sendJson(res, 200, { ok: true, member: data.member, inviteCode: code })
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
    },
  }), 'dsh-shared-kb: page api')
}

function mergeAuthorCounts(...groups) {
  const counts = new Map()
  for (const group of groups) {
    for (const item of group || []) {
      const name = item.name || '未知'
      counts.set(name, (counts.get(name) || 0) + Number(item.count || 0))
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }))
}

module.exports = { name: NAME, inject: ['tools', 'webServer'], Config, apply }
