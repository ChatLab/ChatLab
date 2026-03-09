/**
 * WeChat 4.x macOS 数据库访问层
 *
 * 微信 4.x 数据库路径：
 *   ~/Library/Containers/com.tencent.xinWeChat/Data/Library/Application Support/
 *   com.tencent.xinWeChat/2.0b4.0.9/{account_wxid}/
 *
 * 数据库使用 SQLCipher 加密（WCDB），需提供解密密钥。
 *
 * 密钥获取方式（需在 macOS 上操作）：
 *   参考 https://github.com/xaoyaoo/PyWxDump 等工具，通过读取进程内存获取。
 */

import Database from 'better-sqlite3-multiple-ciphers'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { existsSync, readdirSync, statSync } from 'node:fs'

// ============================
// 常量
// ============================

/** 微信 4.x macOS 数据库根目录 */
const WECHAT_BASE_PATH = join(
  homedir(),
  'Library/Containers/com.tencent.xinWeChat/Data/Library/Application Support/com.tencent.xinWeChat/2.0b4.0.9'
)

/** 消息数据库分片数量 */
const MESSAGE_DB_SHARDS = 10

/** WeChat 消息类型映射 */
export const MESSAGE_TYPE_MAP: Record<number, string> = {
  1: '文本',
  3: '图片',
  34: '语音',
  43: '视频',
  47: '表情',
  49: '链接/文件/引用',
  10000: '系统消息',
  10002: '撤回消息',
}

// ============================
// 类型定义
// ============================

export interface WeChatAccount {
  wxid: string
  path: string
  hasMessageDb: boolean
  hasContactDb: boolean
}

export interface WeChatMessage {
  localId: number
  msgSvrId?: number
  type: number
  typeName: string
  subType: number
  isSender: number
  talker: string
  /** 原始 content（群消息可能包含 "wxid:\n实际内容" 前缀） */
  content: string | null
  createTime: number
  createTimeISO: string
  dbFile: string
  /** 发言人 wxid（群消息解析 content 前缀或独立字段，私聊为空）*/
  senderWxid?: string
  /** 去掉发言人前缀后的实际消息内容（群消息专用）*/
  actualContent?: string | null
  /** 发言人在群内的显示名（群昵称，如已加载群成员则填充）*/
  senderDisplayName?: string | null
}

export interface WeChatGroupMember {
  chatRoomName: string
  memberWxid: string
  /** 群昵称（该成员在该群内设置的名字，可为空）*/
  displayName: string | null
  /** 微信昵称（全局）*/
  nickName: string | null
  /** 你给该成员设置的备注 */
  remarkName: string | null
  /** 最终显示名：优先顺序 remarkName > displayName > nickName > memberWxid */
  resolvedName: string
}

export interface WeChatContact {
  userName: string
  nickName: string | null
  remarkName: string | null
  alias: string | null
  type: number
  pyInitial: string | null
  quanPin: string | null
}

export interface WeChatSession {
  strUsrName: string
  nOrder: number
  nUnReadCount: number
  strNickName: string | null
  strContent: string | null
  nMsgLocalID: number | null
  nMsgStatus: number | null
  nMsgType: number | null
  nTime: number | null
}

export interface CipherConfig {
  /** 密钥（支持两种格式）:
   *  - 原始密码字符串（直接用作 SQLCipher 密码）
   *  - 十六进制字符串（64位 hex，代表 32 字节，使用 hex: 前缀，如 "hex:0a1b2c..."）
   */
  key: string
  /** cipher_page_size，默认 4096 */
  pageSize?: number
  /** kdf_iter，默认 64000 */
  kdfIter?: number
  /** HMAC 算法，默认 HMAC_SHA1 */
  hmacAlgo?: string
  /** KDF 算法，默认 PBKDF2_HMAC_SHA1 */
  kdfAlgo?: string
}

// ============================
// 账户发现
// ============================

/**
 * 列出本机微信 4.x 已登录账户
 */
export function listWeChatAccounts(): WeChatAccount[] {
  if (!existsSync(WECHAT_BASE_PATH)) {
    return []
  }

  const entries = readdirSync(WECHAT_BASE_PATH)
  const accounts: WeChatAccount[] = []

  for (const entry of entries) {
    const accountPath = join(WECHAT_BASE_PATH, entry)
    try {
      const stat = statSync(accountPath)
      if (!stat.isDirectory()) continue
      // wxid 通常以 wxid_ 开头，或者是其他格式
      // 跳过明显不是账户目录的条目
      if (entry === 'Backup' || entry === 'Cache') continue

      const messagePath = join(accountPath, 'Message')
      const contactDbPath = join(accountPath, 'WCDB_Contact.sqlite')

      accounts.push({
        wxid: entry,
        path: accountPath,
        hasMessageDb: existsSync(messagePath),
        hasContactDb: existsSync(contactDbPath),
      })
    } catch {
      // 跳过无法访问的目录
    }
  }

  return accounts
}

/**
 * 获取指定账户的数据库路径
 */
export function getAccountPaths(wxidOrPath: string) {
  // 如果是完整路径则直接使用，否则作为 wxid 拼接
  const accountPath = wxidOrPath.includes('/')
    ? resolve(wxidOrPath)
    : join(WECHAT_BASE_PATH, wxidOrPath)

  return {
    accountPath,
    contactDb: join(accountPath, 'WCDB_Contact.sqlite'),
    messageDir: join(accountPath, 'Message'),
    messageShards: Array.from({ length: MESSAGE_DB_SHARDS }, (_, i) =>
      join(accountPath, 'Message', `msg_${i}.db`)
    ),
  }
}

// ============================
// 数据库连接
// ============================

/**
 * 打开 WeChat SQLCipher 加密数据库
 *
 * @param dbPath 数据库文件路径
 * @param config 解密配置
 * @returns better-sqlite3 Database 实例
 * @throws 如果数据库无法打开或密钥错误
 */
export function openWeChatDatabase(dbPath: string, config: CipherConfig): Database.Database {
  if (!existsSync(dbPath)) {
    throw new Error(`数据库文件不存在: ${dbPath}`)
  }

  const db = new Database(dbPath, { readonly: true })

  try {
    // 设置密钥 - 必须在任何其他操作之前
    if (config.key.startsWith('hex:')) {
      // 十六进制格式的原始密钥
      db.pragma(`key="hex:${config.key.slice(4)}"`)
    } else {
      // 直接密码
      db.pragma(`key='${config.key.replace(/'/g, "''")}'`)
    }

    // 设置 SQLCipher 参数（微信 WCDB 默认值）
    db.pragma(`cipher_page_size=${config.pageSize ?? 4096}`)
    db.pragma(`kdf_iter=${config.kdfIter ?? 64000}`)
    db.pragma(`cipher_hmac_algorithm=${config.hmacAlgo ?? 'HMAC_SHA1'}`)
    db.pragma(`cipher_kdf_algorithm=${config.kdfAlgo ?? 'PBKDF2_HMAC_SHA1'}`)

    // 验证是否可以正常读取（如果密钥错误，这里会抛出异常）
    db.prepare('SELECT count(*) FROM sqlite_master').get()

    return db
  } catch (err) {
    db.close()
    throw new Error(
      `无法打开数据库 ${dbPath}：${err instanceof Error ? err.message : String(err)}\n` +
        `请检查密钥是否正确，以及 SQLCipher 参数是否匹配。`
    )
  }
}

// ============================
// 查询：会话列表
// ============================

/**
 * 获取会话列表（来自 Session.db 或联系人数据库）
 */
export function querySessions(
  db: Database.Database,
  options: { limit?: number; offset?: number } = {}
): WeChatSession[] {
  const { limit = 50, offset = 0 } = options

  // 尝试 SessionAbstract 表（存在于部分版本）
  const tables = (
    db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
      .all() as { name: string }[]
  ).map((r) => r.name)

  if (tables.includes('SessionAbstract')) {
    return db
      .prepare(
        `SELECT strUsrName, nOrder, nUnReadCount, strNickName, strContent,
                nMsgLocalID, nMsgStatus, nMsgType, nTime
         FROM SessionAbstract
         ORDER BY nOrder DESC
         LIMIT ? OFFSET ?`
      )
      .all(limit, offset) as WeChatSession[]
  }

  return []
}

// ============================
// 查询：联系人
// ============================

/**
 * 查询联系人列表
 */
export function queryContacts(
  db: Database.Database,
  options: { search?: string; limit?: number; offset?: number } = {}
): WeChatContact[] {
  const { search, limit = 100, offset = 0 } = options

  // 检查可用的联系人表
  const tables = (
    db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
      .all() as { name: string }[]
  ).map((r) => r.name)

  // 常见表名：WCDBFriend、Friend、WCContact
  const tableName = ['WCDBFriend', 'Friend', 'WCContact'].find((t) => tables.includes(t))

  if (!tableName) {
    throw new Error(`未找到联系人表，当前表：${tables.join(', ')}`)
  }

  // 获取表的列名
  const columns = (
    db.prepare(`PRAGMA table_info(${tableName})`).all() as { name: string }[]
  ).map((c) => c.name)

  const hasColumn = (col: string) => columns.includes(col)

  const select = `
    SELECT
      ${hasColumn('userName') ? 'userName' : 'NULL'} as userName,
      ${hasColumn('nickName') ? 'nickName' : 'NULL'} as nickName,
      ${hasColumn('remarkName') ? 'remarkName' : hasColumn('remark') ? 'remark' : 'NULL'} as remarkName,
      ${hasColumn('alias') ? 'alias' : 'NULL'} as alias,
      ${hasColumn('type') ? 'type' : '0'} as type,
      ${hasColumn('pyInitial') ? 'pyInitial' : 'NULL'} as pyInitial,
      ${hasColumn('quanPin') ? 'quanPin' : 'NULL'} as quanPin
    FROM ${tableName}
  `

  if (search) {
    const like = `%${search}%`
    return db
      .prepare(
        `${select}
         WHERE userName LIKE ? OR nickName LIKE ? OR remarkName LIKE ? OR alias LIKE ?
         ORDER BY ${hasColumn('pyInitial') ? 'pyInitial' : 'userName'}
         LIMIT ? OFFSET ?`
      )
      .all(like, like, like, like, limit, offset) as WeChatContact[]
  }

  return db
    .prepare(
      `${select}
       ORDER BY ${hasColumn('pyInitial') ? 'pyInitial' : 'userName'}
       LIMIT ? OFFSET ?`
    )
    .all(limit, offset) as WeChatContact[]
}

// ============================
// 查询：消息
// ============================

// ============================
// 群消息发言人解析
// ============================

/**
 * 从群消息中解析发言人 wxid 和实际内容。
 *
 * 微信群消息 content 格式（旧版/部分 4.x）：
 *   "wxid_xxx:\n<实际内容>"
 *
 * 微信 4.x WCDB 也可能有独立的 senderUserName 列，优先使用。
 */
export function parseGroupSender(
  row: Record<string, unknown>,
  isSender: number,
  talker: string
): { senderWxid: string; actualContent: string | null } {
  // 自己发送的消息：senderWxid 为账户本身（用特殊标记）
  if (isSender === 1) {
    return { senderWxid: '__self__', actualContent: row.content != null ? String(row.content) : null }
  }

  // 优先读取独立的发言人字段（WCDB 4.x 部分版本）
  const senderField =
    row.senderUserName ?? row.fromUser ?? row.FromUser ?? row.sender ?? null
  if (senderField != null && String(senderField).trim() !== '') {
    return {
      senderWxid: String(senderField).trim(),
      actualContent: row.content != null ? String(row.content) : null,
    }
  }

  // 非群消息（私聊）：发言人就是 talker
  if (!talker.endsWith('@chatroom')) {
    return { senderWxid: talker, actualContent: row.content != null ? String(row.content) : null }
  }

  // 群消息：从 content 前缀解析 "wxid_xxx:\n实际内容"
  const content = row.content != null ? String(row.content) : null
  if (content) {
    const newlineIdx = content.indexOf('\n')
    if (newlineIdx > 0) {
      const prefix = content.slice(0, newlineIdx)
      // wxid 前缀：不含空格、不含 XML 标签特征、长度合理（3~64）
      if (prefix.length >= 3 && prefix.length <= 64 && !prefix.includes(' ') && !prefix.includes('<')) {
        const senderWxid = prefix.endsWith(':') ? prefix.slice(0, -1) : prefix
        return { senderWxid, actualContent: content.slice(newlineIdx + 1) }
      }
    }
  }

  return { senderWxid: '', actualContent: content }
}

function formatMessage(row: Record<string, unknown>, dbFile: string): WeChatMessage {
  const createTime = Number(row.createTime ?? row.CreateTime ?? 0)
  const type = Number(row.type ?? row.Type ?? 0)
  const isSender = Number(row.isSender ?? row.IsSend ?? 0)
  const talker = String(row.talker ?? row.StrTalker ?? '')

  const isGroupMsg = talker.endsWith('@chatroom')
  const { senderWxid, actualContent } = isGroupMsg
    ? parseGroupSender(row, isSender, talker)
    : { senderWxid: undefined, actualContent: undefined }

  return {
    localId: Number(row.localId ?? row.MesLocalID ?? 0),
    msgSvrId: row.msgSvrId != null ? Number(row.msgSvrId) : undefined,
    type,
    typeName: MESSAGE_TYPE_MAP[type] ?? `未知(${type})`,
    subType: Number(row.subType ?? row.SubType ?? 0),
    isSender,
    talker,
    content: row.content != null ? String(row.content) : null,
    createTime,
    createTimeISO: new Date(createTime * 1000).toISOString(),
    dbFile,
    ...(isGroupMsg && { senderWxid, actualContent }),
  }
}

/**
 * 从单个消息数据库分片中查询消息
 */
export function queryMessagesFromShard(
  db: Database.Database,
  shardPath: string,
  options: {
    talker?: string
    keyword?: string
    startTime?: number
    endTime?: number
    limit?: number
    offset?: number
    isSender?: number
  } = {}
): WeChatMessage[] {
  const { talker, keyword, startTime, endTime, limit = 100, offset = 0, isSender } = options

  // 检测实际表名
  const tables = (
    db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
      .all() as { name: string }[]
  ).map((r) => r.name)

  const tableName = tables.find((t) => t === 'WCDBMessage' || t === 'Chat' || t === 'message')
  if (!tableName) return []

  // 检测列名（不同版本字段名不同）
  const columns = (
    db.prepare(`PRAGMA table_info(${tableName})`).all() as { name: string }[]
  ).map((c) => c.name)

  const hasColumn = (col: string) => columns.includes(col)

  // 构建查询条件
  const conditions: string[] = []
  const params: (string | number)[] = []

  if (talker) {
    const talkerCol = hasColumn('talker') ? 'talker' : hasColumn('StrTalker') ? 'StrTalker' : null
    if (talkerCol) {
      conditions.push(`${talkerCol} = ?`)
      params.push(talker)
    }
  }

  if (isSender !== undefined) {
    const senderCol = hasColumn('isSender') ? 'isSender' : hasColumn('IsSend') ? 'IsSend' : null
    if (senderCol) {
      conditions.push(`${senderCol} = ?`)
      params.push(isSender)
    }
  }

  const timeCol = hasColumn('createTime')
    ? 'createTime'
    : hasColumn('CreateTime')
      ? 'CreateTime'
      : null

  if (timeCol && startTime !== undefined) {
    conditions.push(`${timeCol} >= ?`)
    params.push(startTime)
  }

  if (timeCol && endTime !== undefined) {
    conditions.push(`${timeCol} <= ?`)
    params.push(endTime)
  }

  if (keyword) {
    const contentCol = hasColumn('content') ? 'content' : hasColumn('Content') ? 'Content' : null
    if (contentCol) {
      conditions.push(`${contentCol} LIKE ?`)
      params.push(`%${keyword}%`)
    }
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const orderBy = timeCol ? `ORDER BY ${timeCol} DESC` : ''

  params.push(limit, offset)

  const rows = db
    .prepare(
      `SELECT * FROM ${tableName}
       ${where}
       ${orderBy}
       LIMIT ? OFFSET ?`
    )
    .all(...params) as Record<string, unknown>[]

  return rows.map((row) => formatMessage(row, shardPath))
}

/**
 * 跨所有分片查询消息
 */
export function queryMessagesAllShards(
  shardPaths: string[],
  config: CipherConfig,
  options: {
    talker?: string
    keyword?: string
    startTime?: number
    endTime?: number
    limit?: number
    isSender?: number
  } = {}
): WeChatMessage[] {
  const { limit = 100 } = options
  const allMessages: WeChatMessage[] = []

  for (const shardPath of shardPaths) {
    if (!existsSync(shardPath)) continue

    let db: Database.Database | null = null
    try {
      db = openWeChatDatabase(shardPath, config)
      const messages = queryMessagesFromShard(db, shardPath, {
        ...options,
        limit: limit * 2, // 每个分片多取一些，最后再裁剪
      })
      allMessages.push(...messages)
    } catch {
      // 跳过打不开的分片
    } finally {
      db?.close()
    }
  }

  // 按时间排序并裁剪
  allMessages.sort((a, b) => b.createTime - a.createTime)
  return allMessages.slice(0, limit)
}

// ============================
// 查询：自定义 SQL
// ============================

export interface SqlQueryResult {
  columns: string[]
  rows: unknown[][]
  rowCount: number
}

/**
 * 在指定数据库上执行自定义 SQL（只读）
 */
export function executeCustomSQL(db: Database.Database, sql: string): SqlQueryResult {
  // 安全检查：只允许 SELECT 语句
  const trimmed = sql.trim().toUpperCase()
  if (!trimmed.startsWith('SELECT') && !trimmed.startsWith('PRAGMA') && !trimmed.startsWith('WITH')) {
    throw new Error('只允许执行 SELECT、WITH 或 PRAGMA 语句')
  }

  const stmt = db.prepare(sql)
  const rows = stmt.all() as Record<string, unknown>[]

  if (rows.length === 0) {
    return { columns: [], rows: [], rowCount: 0 }
  }

  const columns = Object.keys(rows[0])
  const data = rows.map((row) => columns.map((col) => row[col]))

  return {
    columns,
    rows: data,
    rowCount: rows.length,
  }
}

// ============================
// 查询：群成员与群昵称
// ============================

/**
 * 查询某个群的成员列表及其群昵称
 *
 * 微信数据库中群成员信息来源：
 * 1. 联系人库的 WCDBChatRoomMember 表（WCDB 4.x）
 * 2. 群成员信息与联系人的 join 查询（获取微信昵称/备注）
 */
export function queryGroupMembers(
  contactDb: Database.Database,
  chatRoomId: string
): WeChatGroupMember[] {
  const tables = (
    contactDb
      .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
      .all() as { name: string }[]
  ).map((r) => r.name)

  // 可能的群成员表名
  const memberTableName = [
    'WCDBChatRoomMember',
    'ChatRoomMember',
    'GroupMember',
  ].find((t) => tables.includes(t))

  if (!memberTableName) {
    // 尝试从 WCDBFriend/Friend 表里捞群成员（部分版本把群成员作为特殊联系人存储）
    const contactTable = ['WCDBFriend', 'Friend', 'WCContact'].find((t) => tables.includes(t))
    if (!contactTable) return []

    const contactCols = (
      contactDb.prepare(`PRAGMA table_info(${contactTable})`).all() as { name: string }[]
    ).map((c) => c.name)

    if (!contactCols.includes('chatRoomMembers') && !contactCols.includes('memberList')) {
      return []
    }
    return []
  }

  // 获取群成员表的列
  const memberCols = (
    contactDb.prepare(`PRAGMA table_info(${memberTableName})`).all() as { name: string }[]
  ).map((c) => c.name)

  const hasMemberCol = (col: string) => memberCols.includes(col)

  // 群 ID 字段可能叫 chatRoomName 或 chatroomId 等
  const roomIdCol =
    hasMemberCol('chatRoomName') ? 'chatRoomName' :
    hasMemberCol('chatroomId') ? 'chatroomId' :
    hasMemberCol('roomId') ? 'roomId' : null

  // 成员 wxid 字段
  const memberWxidCol =
    hasMemberCol('memberName') ? 'memberName' :
    hasMemberCol('wxid') ? 'wxid' :
    hasMemberCol('userName') ? 'userName' : null

  // 群昵称字段
  const displayNameCol =
    hasMemberCol('displayName') ? 'displayName' :
    hasMemberCol('nickName') ? 'nickName' : null

  if (!roomIdCol || !memberWxidCol) {
    // 表结构不认识，返回原始数据
    const rows = contactDb
      .prepare(`SELECT * FROM ${memberTableName} LIMIT 500`)
      .all() as Record<string, unknown>[]
    return rows.map((r) => ({
      chatRoomName: chatRoomId,
      memberWxid: String(r[memberWxidCol ?? Object.keys(r)[0]] ?? ''),
      displayName: null,
      nickName: null,
      remarkName: null,
      resolvedName: String(r[memberWxidCol ?? Object.keys(r)[0]] ?? ''),
    }))
  }

  // 查询群成员
  const members = contactDb
    .prepare(
      `SELECT ${memberWxidCol} as memberWxid,
              ${displayNameCol ? displayNameCol : 'NULL'} as displayName
       FROM ${memberTableName}
       WHERE ${roomIdCol} = ?`
    )
    .all(chatRoomId) as { memberWxid: string; displayName: string | null }[]

  if (members.length === 0) return []

  // 尝试 join 联系人表获取微信昵称和备注
  const contactTable = ['WCDBFriend', 'Friend', 'WCContact'].find((t) => tables.includes(t))

  if (!contactTable) {
    return members.map((m) => ({
      chatRoomName: chatRoomId,
      memberWxid: m.memberWxid,
      displayName: m.displayName,
      nickName: null,
      remarkName: null,
      resolvedName: m.displayName || m.memberWxid,
    }))
  }

  const contactCols = (
    contactDb.prepare(`PRAGMA table_info(${contactTable})`).all() as { name: string }[]
  ).map((c) => c.name)

  const hasCC = (col: string) => contactCols.includes(col)
  const userNameCol = hasCC('userName') ? 'userName' : null
  const nickNameCol = hasCC('nickName') ? 'nickName' : null
  const remarkCol = hasCC('remarkName') ? 'remarkName' : hasCC('remark') ? 'remark' : null

  if (!userNameCol) {
    return members.map((m) => ({
      chatRoomName: chatRoomId,
      memberWxid: m.memberWxid,
      displayName: m.displayName,
      nickName: null,
      remarkName: null,
      resolvedName: m.displayName || m.memberWxid,
    }))
  }

  // 批量查联系人信息
  const wxids = members.map((m) => m.memberWxid)
  const placeholders = wxids.map(() => '?').join(',')
  const contacts = contactDb
    .prepare(
      `SELECT ${userNameCol} as userName,
              ${nickNameCol ? nickNameCol : 'NULL'} as nickName,
              ${remarkCol ? remarkCol : 'NULL'} as remarkName
       FROM ${contactTable}
       WHERE ${userNameCol} IN (${placeholders})`
    )
    .all(...wxids) as { userName: string; nickName: string | null; remarkName: string | null }[]

  const contactMap = new Map(contacts.map((c) => [c.userName, c]))

  return members.map((m) => {
    const contact = contactMap.get(m.memberWxid)
    const remarkName = contact?.remarkName || null
    const nickName = contact?.nickName || null
    const displayName = m.displayName || null
    const resolvedName = remarkName || displayName || nickName || m.memberWxid
    return {
      chatRoomName: chatRoomId,
      memberWxid: m.memberWxid,
      displayName,
      nickName,
      remarkName,
      resolvedName,
    }
  })
}

/**
 * 将群成员列表转换为 wxid → resolvedName 的快查 Map
 */
export function buildMemberNameMap(members: WeChatGroupMember[]): Map<string, string> {
  return new Map(members.map((m) => [m.memberWxid, m.resolvedName]))
}

/**
 * 给消息列表批量填充发言人显示名
 */
export function enrichMessagesWithNames(
  messages: WeChatMessage[],
  nameMap: Map<string, string>,
  selfName: string = '我'
): WeChatMessage[] {
  return messages.map((msg) => {
    if (msg.senderWxid === '__self__') {
      return { ...msg, senderDisplayName: selfName }
    }
    if (msg.senderWxid) {
      return { ...msg, senderDisplayName: nameMap.get(msg.senderWxid) ?? msg.senderWxid }
    }
    return msg
  })
}

// ============================
// 查询：数据库表结构
// ============================

/**
 * 获取数据库表结构信息
 */
export function getDatabaseSchema(db: Database.Database): Record<string, string[]> {
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
    .all() as { name: string }[]

  const schema: Record<string, string[]> = {}
  for (const { name } of tables) {
    const columns = db
      .prepare(`PRAGMA table_info(${name})`)
      .all() as { name: string; type: string; notnull: number; pk: number }[]
    schema[name] = columns.map(
      (c) => `${c.name} ${c.type}${c.pk ? ' PK' : ''}${c.notnull ? ' NOT NULL' : ''}`
    )
  }
  return schema
}
