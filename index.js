'use strict'

/**
 * dsh-shared-kb — Host half
 *
 * 连接团队 Hub（hub.js），把共享知识库接进 DSH：
 *  - 九个模型工具：skb_search / skb_read / skb_list / skb_upload / skb_commit /
 *    skb_inbox / skb_read_raw / skb_status / skb_admin；
 *  - 同源页面路由 /shared-kb/api/*，供侧栏「共享知识库」页面使用；
 *  - 上传文本素材可交给宿主默认模型，按 inbox-triage 的十类 + 十字总结 +
 *    置信度规范自动整理入库；失败留在「待整理」，由 agent 用技能补做；
 *  - 管理员（Hub 角色 admin）可在页面里管成员、删文档、清理素材。
 */

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const NAME = 'dsh-shared-kb'
const API_PREFIX = '/shared-kb/api'
const MAX_UPLOAD = 64 * 1024 * 1024
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
    })
  } catch { return undefined }
})()

// ---------------------------------------------------------------- config

function dshHome() {
  return process.env.DSH_HOME ? path.resolve(process.env.DSH_HOME) : path.join(os.homedir(), '.dsh')
}

function configFile() { return path.join(dshHome(), 'shared-kb.json') }

function readConfigFile() {
  try { return JSON.parse(fs.readFileSync(configFile(), 'utf8')) || {} } catch { return {} }
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
  return String(value || '').split(/[,，]/).map((t) => t.trim()).filter(Boolean).slice(0, 40)
}

function clampSummary(value) {
  const text = String(value || '').replace(/["'\n]/g, ' ').trim()
  return text.slice(0, 10)
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
  if (!res.ok || data.ok === false) throw new Error((data && data.error) || `Hub 返回 ${res.status}`)
  return data
}

function uploadToHub(cfg, { name, title, tags, author, bytes }) {
  return hubCall(cfg, '/api/upload', {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream',
      'x-filename': encodeURIComponent(safeName(name)),
      'x-title': encodeURIComponent(String(title || name || '')),
      'x-tags': encodeURIComponent(splitTags(tags).join(',')),
      'x-author': encodeURIComponent(String(author || '')),
    },
    body: bytes,
  })
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

function defineTools(ctx, readCfg) {
  const register = (definition) => ctx.tools.register(definition)
  const output = { schema: { type: 'object' }, render: (_args, value) => textResult(value) }

  register({
    name: 'skb_search',
    description: '检索团队共享知识库（跨成员、跨会话）。回答业务问题、复述历史决策或找现成资料前先用它；返回命中文档的 id、标题、十字摘要、分类、标签与片段。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '关键词或自然语言问题；中文按二元组匹配' },
        category: { type: 'string', enum: CATEGORIES, description: '可选：只在这一类里搜' },
        limit: { type: 'integer', description: '返回条数，默认 8，最多 50' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    output,
    async execute(args, exec) {
      const limit = Math.max(1, Math.min(50, Number(args && args.limit) || 8))
      const qs = new URLSearchParams({ q: String(args.query || ''), limit: String(limit) })
      if (args.category) qs.set('category', args.category)
      const data = await hubCall(readCfg(), `/api/search?${qs}`, { signal: exec.signal })
      if (!data.items.length) return { ok: true, total: 0, items: [], hint: '共享库里没有命中；可以换短词，或确认是否还没入库。' }
      return { ok: true, total: data.total, items: data.items }
    },
  })

  register({
    name: 'skb_read',
    description: '按 id 读取一篇共享知识库文档的完整 Markdown（含分类、十字摘要、要点、版本）。通常先 skb_search 再 skb_read。',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string', description: '文档 id' } },
      required: ['id'],
      additionalProperties: false,
    },
    output,
    async execute(args, exec) {
      const data = await hubCall(readCfg(), `/api/doc?id=${encodeURIComponent(String(args.id || ''))}`, { signal: exec.signal })
      return { ok: true, doc: data.doc }
    },
  })

  register({
    name: 'skb_list',
    description: '列出共享知识库最近文档，可按分类或标签过滤，用来了解团队都有哪些资料。',
    parameters: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: CATEGORIES, description: '只列这一类' },
        tag: { type: 'string', description: '只列含该标签的文档' },
        limit: { type: 'integer', description: '默认 30，最多 200' },
      },
      additionalProperties: false,
    },
    output,
    async execute(args, exec) {
      const limit = Math.max(1, Math.min(200, Number(args && args.limit) || 30))
      const qs = new URLSearchParams({ limit: String(limit) })
      if (args.category) qs.set('category', args.category)
      if (args.tag) qs.set('tag', args.tag)
      return hubCall(readCfg(), `/api/list?${qs}`, { signal: exec.signal })
    },
  })

  register({
    name: 'skb_upload',
    description: '把工作区里的一个素材文件上传到共享库原始素材区（不可变），返回 rawId 与文本预览；若同一文件已存在会返回 duplicate 与已有文档。随后按 shared-kb 技能整理并调用 skb_commit。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '工作区内的文件路径（相对或绝对）' },
        title: { type: 'string', description: '素材标题，默认用文件名' },
        tags: { type: 'array', items: { type: 'string' }, description: '建议标签' },
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
      const data = await uploadToHub(cfg, { name, title: args.title || name, tags: args.tags, author: cfg.member, bytes })
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
      const text = textOf(bytes, filePath)
      return {
        ok: true,
        duplicate: false,
        rawId: data.raw.id,
        name,
        bytes: stat.size,
        preview: text ? text.slice(0, 6000) : null,
        note: text
          ? '已上传原始素材。请按 shared-kb 技能整理后调用 skb_commit（带 rawId）。'
          : '二进制素材已上传；如需整理，请先用你的工具读取/转换该文件。',
      }
    },
  })

  register({
    name: 'skb_commit',
    description: '把整理好的文档写入共享知识库（新建或更新同 id）。字段按 inbox-triage 规范：category 十类之一、summary ≤10 字、points 2~4 条、confidence 高/中/低。',
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
      },
      required: ['title', 'markdown'],
      additionalProperties: false,
    },
    output,
    async execute(args, exec) {
      const cfg = readCfg()
      const parsed = parseFrontmatter(args.markdown)
      const meta = parsed.meta || {}
      const payload = {
        title: String(args.title || meta.title || '未命名文档').trim(),
        markdown: parsed.body || String(args.markdown || ''),
        category: args.category || (CATEGORIES.includes(meta.category) ? meta.category : '99_待分类'),
        summary: clampSummary(args.summary || meta.summary || ''),
        description: String(args.description || meta.description || '').slice(0, 500),
        confidence: args.confidence || (['高', '中', '低'].includes(meta.confidence) ? meta.confidence : ''),
        tags: splitTags(args.tags && args.tags.length ? args.tags : meta.tags),
        points: Array.isArray(args.points) && args.points.length ? args.points.slice(0, 12) : (Array.isArray(meta.points) ? meta.points.slice(0, 12) : []),
        rawId: args.rawId || (meta.source && String(meta.source).startsWith('raw/') ? String(meta.source).slice(4) : ''),
        id: args.id || '',
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
    description: '列出共享库里还没整理成文的原始素材（自动整理失败、或非文本素材会留在这里）。',
    parameters: {
      type: 'object',
      properties: { limit: { type: 'integer', description: '默认 20，最多 100' } },
      additionalProperties: false,
    },
    output,
    async execute(args, exec) {
      const data = await hubCall(readCfg(), '/api/inbox', { signal: exec.signal })
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
    description: '查看共享知识库连接状态、当前成员与角色、文档数、待整理数量。排查「为什么搜不到」时先调用它。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output,
    async execute(_args, exec) {
      const cfg = readCfg()
      const status = await hubCall(cfg, '/api/status', { signal: exec.signal })
      const inbox = await hubCall(cfg, '/api/inbox', { signal: exec.signal })
      return { ...status, hubUrl: cfg.hubUrl, inboxItems: inbox.items.slice(0, 20) }
    },
  })

  register({
    name: 'skb_admin',
    description: '管理员操作：查看统计、增删成员、轮换令牌、删除文档、删除或跳过原始素材。仅 Hub 角色为 admin 时可用。',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['stats', 'members', 'add_member', 'remove_member', 'rotate_member', 'delete_doc', 'delete_raw', 'skip_raw'],
          description: '要执行的管理动作',
        },
        name: { type: 'string', description: '成员名（add/remove/rotate 用）' },
        role: { type: 'string', enum: ['member', 'admin'], description: 'add_member 时的角色，默认 member' },
        id: { type: 'string', description: '文档或素材 id（delete/skip 用）' },
        reason: { type: 'string', description: 'skip_raw 的原因' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output,
    async execute(args, exec) {
      const cfg = readCfg()
      await requireAdmin(cfg)
      const action = String(args.action || '')
      if (action === 'stats') return hubCall(cfg, '/api/stats', { signal: exec.signal })
      if (action === 'members') return hubCall(cfg, '/api/members', { signal: exec.signal })
      if (action === 'add_member') {
        const data = await hubCall(cfg, '/api/members', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: args.name, role: args.role || 'member' }), signal: exec.signal,
        })
        const code = `skb1.${Buffer.from(JSON.stringify({ u: cfg.publicUrl || cfg.hubUrl, t: data.member.token, n: data.member.name })).toString('base64url')}`
        return { ok: true, member: data.member, inviteCode: code }
      }
      if (action === 'remove_member') {
        return hubCall(cfg, '/api/members/remove', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: args.name }), signal: exec.signal,
        })
      }
      if (action === 'rotate_member') {
        const data = await hubCall(cfg, '/api/members/rotate', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: args.name }), signal: exec.signal,
        })
        const code = `skb1.${Buffer.from(JSON.stringify({ u: cfg.publicUrl || cfg.hubUrl, t: data.member.token, n: data.member.name })).toString('base64url')}`
        return { ok: true, member: data.member, inviteCode: code }
      }
      if (action === 'delete_doc') {
        return hubCall(cfg, '/api/docs/delete', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: args.id }), signal: exec.signal,
        })
      }
      if (action === 'delete_raw') {
        return hubCall(cfg, '/api/raw/delete', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: args.id }), signal: exec.signal,
        })
      }
      if (action === 'skip_raw') {
        return hubCall(cfg, '/api/raw/skip', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: args.id, reason: args.reason }), signal: exec.signal,
        })
      }
      throw new Error('未知管理动作：' + action)
    },
  })
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
          `团队有一个跨成员的共享知识库（Hub：${cfg.hubUrl}），当前成员：${cfg.member || '未命名'}。`,
          '任务涉及团队资料、历史决策、现场经验、术语或别人上传的素材时，先用 skb_search / skb_list 检索，再用 skb_read 读全文；回答时给出文档标题。',
          '用户说「入库 / 收录 / 整理 / 存到知识库」时，按 shared-kb 技能执行：先查重，再 skb_upload 原始素材，按 inbox-triage 的十类 + ≤10 字总结 + 置信度整理后 skb_commit。',
          '有待整理素材时用 skb_inbox 列表、skb_read_raw 读原文，整理后 skb_commit。',
          '管理员还可以用 skb_admin 管理成员、删除文档或素材。',
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

        if (req.method === 'GET' && rest === '/config') {
          const file = readConfigFile()
          sendJson(res, 200, {
            ok: true,
            hubUrl: cfg.hubUrl,
            publicUrl: cfg.publicUrl,
            member: cfg.member,
            model: cfg.model,
            autoNormalize: cfg.autoNormalize,
            token: cfg.token ? `${cfg.token.slice(0, 4)}…${cfg.token.slice(-4)}` : '',
            hasToken: Boolean(cfg.token),
            source: file.token || file.hubUrl ? 'file' : 'config',
          })
          return
        }
        if (req.method === 'POST' && rest === '/config') {
          const payload = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8') || '{}')
          const next = readConfigFile()
          if (typeof payload.hubUrl === 'string' && payload.hubUrl.trim()) next.hubUrl = payload.hubUrl.trim()
          if (typeof payload.publicUrl === 'string') next.publicUrl = payload.publicUrl.trim()
          if (typeof payload.token === 'string' && payload.token.trim()) next.token = payload.token.trim()
          if (typeof payload.member === 'string') next.member = payload.member.trim()
          if (typeof payload.model === 'string') next.model = payload.model.trim()
          if (typeof payload.autoNormalize === 'boolean') next.autoNormalize = payload.autoNormalize
          writeConfigFile(next)
          sendJson(res, 200, { ok: true })
          return
        }

        if (req.method === 'GET' && (rest === '/' || rest === '/status')) {
          const status = await proxy(cfg, '/api/status')
          sendJson(res, 200, {
            ok: true,
            ...status,
            hubUrl: cfg.hubUrl,
            publicUrl: cfg.publicUrl,
            autoNormalize: cfg.autoNormalize,
            tokenConfigured: Boolean(cfg.token),
          })
          return
        }
        if (req.method === 'GET' && rest === '/list') {
          const qs = new URLSearchParams({ limit: url.searchParams.get('limit') || '60' })
          if (url.searchParams.get('category')) qs.set('category', url.searchParams.get('category'))
          if (url.searchParams.get('tag')) qs.set('tag', url.searchParams.get('tag'))
          sendJson(res, 200, await proxy(cfg, `/api/list?${qs}`))
          return
        }
        if (req.method === 'GET' && rest === '/search') {
          const qs = new URLSearchParams({ q: url.searchParams.get('q') || '', limit: url.searchParams.get('limit') || '20' })
          if (url.searchParams.get('category')) qs.set('category', url.searchParams.get('category'))
          sendJson(res, 200, await proxy(cfg, `/api/search?${qs}`))
          return
        }
        if (req.method === 'GET' && rest === '/doc') {
          sendJson(res, 200, await proxy(cfg, `/api/doc?id=${encodeURIComponent(url.searchParams.get('id') || '')}`))
          return
        }
        if (req.method === 'GET' && rest === '/inbox') {
          const qs = new URLSearchParams({ status: url.searchParams.get('status') || 'new' })
          sendJson(res, 200, await proxy(cfg, `/api/inbox?${qs}`))
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
        if (req.method === 'GET' && rest === '/raw') {
          const upstream = await proxy(cfg, `/api/raw?id=${encodeURIComponent(url.searchParams.get('id') || '')}`)
          const buffer = Buffer.from(await upstream.arrayBuffer())
          const upstreamDisposition = upstream.headers.get('content-disposition')
          const name = url.searchParams.get('name')
          res.writeHead(200, {
            'content-type': upstream.headers.get('content-type') || 'application/octet-stream',
            'content-length': buffer.length,
            // 上游 Hub 已经带 filename*=UTF-8''，直接透传；没有才退回 name 参数
            'content-disposition': upstreamDisposition || `attachment; filename*=UTF-8''${encodeURIComponent(name || 'raw.bin')}`,
          })
          res.end(buffer)
          return
        }

        if (req.method === 'POST' && rest === '/upload') {
          const name = safeName(decodeURIComponentSafe(url.searchParams.get('name') || 'file'))
          const bytes = await readBody(req)
          if (!bytes.length) { sendJson(res, 400, { ok: false, error: '空文件' }); return }
          const tags = url.searchParams.get('tags') || ''
          const uploaded = await uploadToHub(cfg, { name, title: url.searchParams.get('title') || name, tags, author: cfg.member, bytes })

          if (uploaded.duplicate) {
            sendJson(res, 200, {
              ok: true,
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
          let pending = false
          let error = ''
          const text = textOf(bytes, name)
          if (cfg.autoNormalize && text && text.trim()) {
            try {
              const markdown = await callModel(ctx, cfg, NORMALIZE_SYSTEM, normalizePrompt({ name, member: cfg.member, tags, text, rawId: raw.id }))
              const doc = docFromModel(markdown, { title: name, summary: '', author: cfg.member, rawId: raw.id, sha256: raw.sha256 })
              const saved = await hubCall(cfg, '/api/docs', {
                method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(doc),
              })
              normalized = saved.doc
            } catch (e) {
              pending = true
              error = String((e && e.message) || e)
            }
          } else {
            pending = true
            if (!text) error = '非文本素材，已进入待整理'
          }
          sendJson(res, 200, { ok: true, duplicate: false, raw, doc: normalized, pending, error })
          return
        }

        if (req.method === 'POST' && rest === '/commit') {
          const payload = JSON.parse((await readBody(req, 8 * 1024 * 1024)).toString('utf8') || '{}')
          const data = await proxy(cfg, '/api/docs', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
          })
          sendJson(res, 200, { ok: true, doc: data.doc })
          return
        }

        if (req.method === 'POST' && rest === '/delete') {
          const payload = JSON.parse((await readBody(req, 8 * 1024 * 1024)).toString('utf8') || '{}')
          sendJson(res, 200, await proxy(cfg, '/api/docs/delete', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
          }))
          return
        }

        if (req.method === 'POST' && rest === '/raw/skip') {
          const payload = JSON.parse((await readBody(req, 8 * 1024 * 1024)).toString('utf8') || '{}')
          sendJson(res, 200, await proxy(cfg, '/api/raw/skip', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
          }))
          return
        }

        if (req.method === 'POST' && rest === '/raw/delete') {
          const payload = JSON.parse((await readBody(req, 8 * 1024 * 1024)).toString('utf8') || '{}')
          sendJson(res, 200, await proxy(cfg, '/api/raw/delete', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
          }))
          return
        }

        if (req.method === 'POST' && rest === '/members') {
          const payload = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8') || '{}')
          const data = await proxy(cfg, '/api/members', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
          })
          const code = `skb1.${Buffer.from(JSON.stringify({ u: cfg.publicUrl || cfg.hubUrl, t: data.member.token, n: data.member.name })).toString('base64url')}`
          sendJson(res, 200, { ok: true, member: data.member, inviteCode: code })
          return
        }

        if (req.method === 'POST' && rest === '/members/remove') {
          const payload = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8') || '{}')
          sendJson(res, 200, await proxy(cfg, '/api/members/remove', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
          }))
          return
        }

        if (req.method === 'POST' && rest === '/members/rotate') {
          const payload = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8') || '{}')
          const data = await proxy(cfg, '/api/members/rotate', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
          })
          const code = `skb1.${Buffer.from(JSON.stringify({ u: cfg.publicUrl || cfg.hubUrl, t: data.member.token, n: data.member.name })).toString('base64url')}`
          sendJson(res, 200, { ok: true, member: data.member, inviteCode: code })
          return
        }

        sendJson(res, 404, { ok: false, error: 'not found' })
      } catch (error) {
        sendJson(res, error && error.status ? error.status : 500, { ok: false, error: String((error && error.message) || error) })
      }
    },
  }), 'dsh-shared-kb: page api')
}

function decodeURIComponentSafe(value) {
  try { return decodeURIComponent(String(value)) } catch { return String(value) }
}

module.exports = { name: NAME, inject: ['tools', 'webServer'], Config, apply }
