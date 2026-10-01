export interface CacheEntry<T> {
  value: T
  timestamp: number
  ttl: number
}

export class CacheService {
  private l1 = new Map<string, CacheEntry<unknown>>()
  private maxL1Size: number

  constructor(maxL1Size = 100) {
    this.maxL1Size = maxL1Size
  }

  get<T>(key: string): T | null {
    const entry = this.l1.get(key)
    if (!entry) {
      const sessionEntry = this.getFromSessionStorage<T>(key)
      if (sessionEntry) {
        this.l1.set(key, { value: sessionEntry, timestamp: Date.now(), ttl: 5 * 60 * 1000 })
        return sessionEntry
      }
      return null
    }
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.l1.delete(key)
      return null
    }
    return entry.value as T
  }

  set<T>(key: string, value: T, ttl = 5 * 60 * 1000): void {
    if (this.l1.size >= this.maxL1Size) {
      const oldest = this.l1.keys().next().value
      if (oldest) this.l1.delete(oldest)
    }
    this.l1.set(key, { value, timestamp: Date.now(), ttl })
    this.saveToSessionStorage(key, value)
  }

  invalidate(key: string): void {
    this.l1.delete(key)
    this.removeFromSessionStorage(key)
  }

  clear(): void {
    this.l1.clear()
  }

  private getFromSessionStorage<T>(key: string): T | null {
    try {
      const raw = sessionStorage.getItem(`cache:${key}`)
      if (!raw) return null
      const entry: CacheEntry<T> = JSON.parse(raw)
      if (Date.now() - entry.timestamp > entry.ttl) {
        sessionStorage.removeItem(`cache:${key}`)
        return null
      }
      return entry.value
    } catch {
      return null
    }
  }

  private saveToSessionStorage(key: string, value: unknown): void {
    try {
      const entry: CacheEntry<unknown> = { value, timestamp: Date.now(), ttl: 5 * 60 * 1000 }
      sessionStorage.setItem(`cache:${key}`, JSON.stringify(entry))
    } catch {
      // SessionStorage 可能已满
    }
  }

  private removeFromSessionStorage(key: string): void {
    try {
      sessionStorage.removeItem(`cache:${key}`)
    } catch {
      // 忽略错误
    }
  }
}

export const globalCache = new CacheService()
