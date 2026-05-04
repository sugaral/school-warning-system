type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const DEFAULT_TTL_MS = 30_000;

const studentsCache = new Map<string, CacheEntry<any>>();
const detailCache = new Map<string, CacheEntry<any>>();

function getValidEntry<T>(map: Map<string, CacheEntry<T>>, key: string) {
  const entry = map.get(key);
  if (!entry) {
    return null;
  }
  if (entry.expiresAt <= Date.now()) {
    map.delete(key);
    return null;
  }
  return entry.value;
}

function setEntry<T>(map: Map<string, CacheEntry<T>>, key: string, value: T, ttlMs = DEFAULT_TTL_MS) {
  map.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}

export function getCachedWarningStudents(key: string) {
  return getValidEntry(studentsCache, key);
}

export function setCachedWarningStudents(key: string, value: any, ttlMs?: number) {
  setEntry(studentsCache, key, value, ttlMs);
}

export function getCachedWarningStudentDetail(key: string) {
  return getValidEntry(detailCache, key);
}

export function setCachedWarningStudentDetail(key: string, value: any, ttlMs?: number) {
  setEntry(detailCache, key, value, ttlMs);
}

export function clearWarningStudentDetailCache(key: string) {
  detailCache.delete(key);
}

export function clearWarningStudentsCache() {
  studentsCache.clear();
}

export function clearWarningsPageCache() {
  studentsCache.clear();
  detailCache.clear();
}
