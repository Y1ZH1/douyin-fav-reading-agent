import { openDB, type IDBPDatabase } from 'idb'
import type { ChatSession, ChatMessage } from '@/types/chat'

const DB_NAME = 'ai-code-tutor-pro'
const DB_VERSION = 3

let db: IDBPDatabase | null = null

export async function getDB(): Promise<IDBPDatabase> {
  if (db) return db

  db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(database, oldVersion, _newVersion, transaction) {
      if (oldVersion < 1) {
        database.createObjectStore('sessions', { keyPath: 'id' })
        database.createObjectStore('messages', { keyPath: 'id' })
      }
      // 统一在 v3 阶段处理索引创建，避免 upgrade 回调中错误调用 database.transaction
      if (oldVersion < 3) {
        if (!database.objectStoreNames.contains('sessions')) {
          database.createObjectStore('sessions', { keyPath: 'id' })
        }
        if (!database.objectStoreNames.contains('messages')) {
          const store = database.createObjectStore('messages', { keyPath: 'id' })
          store.createIndex('sessionId', 'sessionId')
        } else if (oldVersion < 3) {
          // 从 v1/v2 升级到 v3：为已有 messages 存储创建 sessionId 索引
          const msgStore = transaction.objectStore('messages')
          if (!msgStore.indexNames.contains('sessionId')) {
            msgStore.createIndex('sessionId', 'sessionId')
          }
        }
      }
    },
  })

  return db
}

export async function persistSession(session: ChatSession): Promise<void> {
  const database = await getDB()
  await database.put('sessions', session)
}

export async function persistMessage(message: ChatMessage): Promise<void> {
  const database = await getDB()
  await database.put('messages', message)
}

export async function getAllSessions(): Promise<ChatSession[]> {
  const database = await getDB()
  return database.getAll('sessions')
}

export async function getSession(id: string): Promise<ChatSession | undefined> {
  const database = await getDB()
  return database.get('sessions', id)
}

export async function getMessagesBySession(sessionId: string): Promise<ChatMessage[]> {
  const database = await getDB()
  const index = database.transaction('messages').store.index('sessionId')
  return index.getAll(sessionId)
}

export async function deleteSession(id: string): Promise<void> {
  const database = await getDB()
  await database.delete('sessions', id)
  const msgs = await getMessagesBySession(id)
  const tx = database.transaction('messages', 'readwrite')
  for (const msg of msgs) {
    await tx.store.delete(msg.id)
  }
  await tx.done
}

export async function deleteMessage(id: string): Promise<void> {
  const database = await getDB()
  await database.delete('messages', id)
}

export async function clearAll(): Promise<void> {
  const database = await getDB()
  await database.clear('sessions')
  await database.clear('messages')
}
