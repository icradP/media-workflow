import type { PinType, PinValue } from './pins';

/**
 * 节点输入定义
 */
export interface NodeInput {
  type: PinType;
  label: string;
  /** 可选输入——未连线时 execute 收到的值为 undefined */
  optional?: boolean;
}

/**
 * 节点输出定义
 */
export interface NodeOutput {
  type: PinType;
  label: string;
}

/**
 * 节点参数定义（UI 控件）
 */
export type NodeParamDef =
  | { name: string; type: 'number'; default: number; min?: number; max?: number; step?: number }
  | { name: string; type: 'string'; default: string }
  | { name: string; type: 'boolean'; default: boolean }
  | { name: string; type: 'enum'; default: string; values: string[] };

/**
 * 节点定义 — 每个 node 文件默认导出一个此类型
 */
export interface NodeDefinition<
  TInputs extends Record<string, PinType> = Record<string, PinType>,
  TOutputs extends Record<string, PinType> = Record<string, PinType>,
> {
  /** 全局唯一 ID，如 "flv_parser" */
  id: string;
  /** 分类 */
  category: NodeCategory;
  /** UI 显示名 */
  displayName: string;
  /** 输入 Pin 定义 */
  inputs: Record<keyof TInputs & string, NodeInput>;
  /** 输出 Pin 定义 */
  outputs: Record<keyof TOutputs & string, NodeOutput>;
  /** 参数定义 */
  params?: Record<string, NodeParamDef>;
  /** 指定在 Worker 中执行 */
  worker?: string;
  /** 是否为流式节点 */
  streaming?: boolean;
  /** 节点描述 */
  description?: string;
  /**
   * 执行节点。
   *
   * @param ctx   执行上下文（logger、AbortSignal、resourceTracker）
   * @param options.inputs   输入值映射: { inputName: PinValue }
   * @param options.params   参数值映射:   { paramName: value }
   * @returns 输出值映射: { outputName: PinValue }
   */
  execute(
    ctx: ExecuteContext,
    options: {
      inputs: { [K in keyof TInputs & string]: PinValue<TInputs[K]> | undefined };
      params: Record<string, unknown>;
    },
  ): Promise<{ [K in keyof TOutputs & string]: PinValue<TOutputs[K]> }>;
}

export type NodeCategory =
  | 'source'
  | 'parser'
  | 'demux'
  | 'decoder'
  | 'analysis'
  | 'display'
  | 'utility';

/**
 * 执行上下文 — 由 Runtime 注入，node 通过它访问平台能力
 */
export interface ExecuteContext {
  /** 取消信号 */
  signal: AbortSignal;
  /** 日志（前端绑定到 console，测试中可 mock） */
  log: Logger;
  /** 资源追踪器——VideoFrame 等需手动 close 的资源由此注册 */
  resources: ResourceTracker;
}

export interface Logger {
  debug(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

export interface ResourceTracker {
  /** 注册一个需要手动释放的资源 */
  track(resource: { close(): void }): void;
  /** 调用所有已注册资源的 close() */
  disposeAll(): void;
}
