import type { ControlHandle, NodeDefinition } from '@media-workflow/core';
import { createControlHandle } from './handles.js';

/**
 * Generic edge/pulse source — one button emits a control pulse (0/1 gate style).
 * Wire into any consumer pin that reacts to signals (e.g. Muxer recordStart / recordStop).
 */
export const triggerButtonNode: NodeDefinition<
  Record<string, never>,
  { out: 'control' }
> = {
  id: 'trigger_button',
  category: 'realtime',
  displayName: 'Trigger',
  description: '通用信号按钮：点击发出一次脉冲，可接到任意门控输入（如 Muxer Record Start/Stop）。',
  inputs: {},
  outputs: {
    out: { type: 'control', label: 'Pulse' },
  },
  params: {
    label: { name: 'label', type: 'string', default: 'Trigger' },
  },
  cachePolicy: 'never',
  async execute(ctx, { params }) {
    const label = String(params.label || 'Trigger');
    const out: ControlHandle = createControlHandle('trigger_button', {
      label,
      params: { label },
      lastEvent: {
        kind: 'pulse',
        atMs: Date.now(),
        sourceId: `trigger_button:${label}`,
      },
    });
    ctx.log.info(`Trigger: ${label}`);
    return { out };
  },
};
