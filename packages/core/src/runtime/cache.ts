/**
 * 简单的内容寻址缓存 — 基于输入 + 参数的哈希。
 *
 * 键 = `${nodeId}::${hash(JSON.stringify(inputs))}::${hash(JSON.stringify(params))}`
 */
export interface ExecutionCache {
  get(nodeId: string, inputs: Record<string, unknown>, params: Record<string, unknown>): ExecutionResult | undefined;
  set(nodeId: string, inputs: Record<string, unknown>, params: Record<string, unknown>, result: ExecutionResult): void;
  /** 清除指定节点的所有缓存条目 */
  invalidate(nodeId: string): void;
  /** 清空整个缓存 */
  clear(): void;
}

export interface ExecutionResult {
  outputs: Record<string, unknown>;
}

/**
 * 基于 Map 的内存缓存实现。
 * 对大数据量场景（数百帧），可替换为 LRU 实现。
 */
export function createMemoryCache(maxEntries = 5000): ExecutionCache {
  const cache = new Map<string, Map<string, ExecutionResult>>(); // nodeId → keyHash → result

  function makeKey(inputs: Record<string, unknown>, params: Record<string, unknown>): string {
    const stable = stableFingerprint({ inputs, params });
    return simpleHash(stable);
  }

  return {
    get(nodeId, inputs, params) {
      const nodeCache = cache.get(nodeId);
      if (!nodeCache) return undefined;
      return nodeCache.get(makeKey(inputs, params));
    },
    set(nodeId, inputs, params, result) {
      let nodeCache = cache.get(nodeId);
      if (!nodeCache) {
        nodeCache = new Map();
        cache.set(nodeId, nodeCache);
      }
      // 简单 LRU: 超过上限时清空该节点的缓存
      if (nodeCache.size >= maxEntries) {
        nodeCache.clear();
      }
      nodeCache.set(makeKey(inputs, params), result);
    },
    invalidate(nodeId) {
      cache.delete(nodeId);
    },
    clear() {
      cache.clear();
    },
  };
}

export function stableFingerprint(value: unknown): string {
  return fingerprintValue(value, new WeakSet<object>());
}

function fingerprintValue(value: unknown, seen: WeakSet<object>): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return `s:${value}`;
  if (typeof value === 'number') return `n:${Number.isNaN(value) ? 'NaN' : value}`;
  if (typeof value === 'boolean') return `b:${value}`;
  if (typeof value === 'bigint') return `i:${value}`;
  if (typeof value !== 'object') return `${typeof value}:${String(value)}`;

  if ('sourceId' in value && 'version' in value) {
    const source = value as { sourceId: unknown; version: unknown };
    return `source:${String(source.sourceId)}@${String(source.version)}`;
  }

  if ('source' in value) {
    const source = (value as { source?: unknown }).source;
    if (
      source &&
      typeof source === 'object' &&
      'sourceId' in source &&
      'version' in source
    ) {
      const identity = source as { sourceId: unknown; version: unknown };
      return `asset:${String(identity.sourceId)}@${String(identity.version)}`;
    }
  }

  if (ArrayBuffer.isView(value)) {
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return `bytes:${value.constructor.name}:${bytes.byteLength}:${hashBytes(bytes)}`;
  }
  if (value instanceof ArrayBuffer) {
    const bytes = new Uint8Array(value);
    return `buffer:${bytes.byteLength}:${hashBytes(bytes)}`;
  }
  if (seen.has(value)) return '[circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    const result = `[${value.map(item => fingerprintValue(item, seen)).join(',')}]`;
    seen.delete(value);
    return result;
  }

  const record = value as Record<string, unknown>;
  const result = `{${Object.keys(record)
    .sort()
    .map(key => `${key}:${fingerprintValue(record[key], seen)}`)
    .join(',')}}`;
  seen.delete(value);
  return result;
}

function hashBytes(bytes: Uint8Array): string {
  let hash = 2166136261;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/**
 * 简单字符串哈希 (djb2)
 */
function simpleHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}
