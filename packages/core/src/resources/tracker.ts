import type { ResourceTracker } from '../types/node';

/**
 * VideoFrame 引用计数资源追踪器。
 *
 * 用于管理 WebCodecs VideoFrame 等需要手动 close 的资源。
 * 当多个下游节点引用了同一帧时，追踪引用计数，
 * 只有所有引用者都释放后才真正 close。
 */
export function createResourceTracker(): ResourceTracker {
  const resources = new Map<object, { resource: { close(): void }; refCount: number }>();

  return {
    track(resource: { close(): void }) {
      const existing = resources.get(resource);
      if (existing) {
        existing.refCount++;
      } else {
        resources.set(resource, { resource, refCount: 1 });
      }
    },

    disposeAll() {
      for (const [, entry] of resources) {
        try {
          for (let i = 0; i < entry.refCount; i++) {
            entry.resource.close();
          }
        } catch {
          // 释放失败不阻断
        }
      }
      resources.clear();
    },
  };
}
