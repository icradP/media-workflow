/**
 * Worker Pool — 管理多个 Web Worker 实例
 */

export interface WorkerPool {
  /** 提交一个执行任务 */
  execute(nodeId: string, inputs: Record<string, unknown>, params: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** 终止所有 Worker */
  terminate(): void;
}

export function createWorkerPool(poolSize?: number): WorkerPool {
  const size = poolSize ?? navigator.hardwareConcurrency ?? 4;
  const workers: Worker[] = [];
  let roundRobin = 0;

  for (let i = 0; i < size; i++) {
    const worker = new Worker(new URL('./node_worker.ts', import.meta.url), { type: 'module' });
    workers.push(worker);
  }

  return {
    execute(nodeId, inputs, params) {
      const worker = workers[roundRobin % workers.length]!;
      roundRobin++;

      return new Promise((resolve, reject) => {
        const handler = (event: MessageEvent) => {
          worker.removeEventListener('message', handler);
          if (event.data.type === 'result') {
            resolve(event.data.outputs);
          } else if (event.data.type === 'error') {
            reject(new Error(event.data.error));
          }
        };
        worker.addEventListener('message', handler);
        worker.postMessage({ type: 'execute', nodeId, inputs, params });
      });
    },

    terminate() {
      for (const w of workers) w.terminate();
    },
  };
}
