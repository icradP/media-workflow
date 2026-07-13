import type { ExecuteContext, Logger, ResourceTracker } from '../types/node';

/**
 * 创建默认的 ExecuteContext。
 */
export function createContext(
  signal: AbortSignal,
  logger?: Logger,
  resources?: ResourceTracker,
): ExecuteContext {
  return {
    signal,
    log: logger ?? defaultLogger(),
    resources: resources ?? defaultResourceTracker(),
  };
}

function defaultLogger(): Logger {
  return {
    debug: (...args) => console.debug('[media-workflow]', ...args),
    info: (...args) => console.info('[media-workflow]', ...args),
    warn: (...args) => console.warn('[media-workflow]', ...args),
    error: (...args) => console.error('[media-workflow]', ...args),
  };
}

function defaultResourceTracker(): ResourceTracker {
  const resources: { close(): void }[] = [];
  return {
    track(resource) {
      resources.push(resource);
    },
    disposeAll() {
      for (const r of resources) {
        try { r.close(); } catch { /* 释放失败不阻断其他资源 */ }
      }
      resources.length = 0;
    },
  };
}
