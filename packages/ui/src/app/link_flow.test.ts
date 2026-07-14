import { describe, expect, it, vi } from 'vitest';
import {
  collectIncidentLinkIds,
  formatTrackDurationSummary,
  pulseFlowingNodeGraph,
  pulseLinkIds,
  triggerNodeOutputFlows,
} from './link_flow.js';

describe('formatTrackDurationSummary', () => {
  it('summarizes packet span', () => {
    expect(formatTrackDurationSummary({
      packets: [
        { ptsUs: 0, durationUs: 33_333 },
        { ptsUs: 996_667, durationUs: 33_333 },
      ],
    })).toBe('2 packets · 1.0s');
  });

  it('handles empty tracks', () => {
    expect(formatTrackDurationSummary({ packets: [] })).toBe('0 packets');
  });
});

describe('official triggerSlot flow pulse', () => {
  it('calls node.triggerSlot(slot, null, linkId) like LiteGraph demos', () => {
    const triggerSlot = vi.fn();
    const links: Record<string, { id: number; origin_id: number; target_id: number }> = {
      1: { id: 1, origin_id: 10, target_id: 20 },
      2: { id: 2, origin_id: 20, target_id: 30 },
      3: { id: 3, origin_id: 30, target_id: 40 },
    };
    const nodes: Record<string, {
      id: number;
      inputs?: Array<{ name: string; type?: string; link?: number | null }>;
      outputs?: Array<{ name: string; type?: string; links?: number[] | null }>;
      triggerSlot?: typeof triggerSlot;
    }> = {
      10: {
        id: 10,
        outputs: [{ name: 'out', links: [1] }],
        triggerSlot,
      },
      20: {
        id: 20,
        inputs: [{ name: 'in', link: 1 }],
        outputs: [{ name: 'track', links: [2] }],
        triggerSlot,
      },
      30: {
        id: 30,
        inputs: [{ name: 'pcm', link: 2 }],
        outputs: [{ name: 'stream', links: [3] }],
        triggerSlot,
      },
      40: { id: 40, inputs: [{ name: 'stream', link: 3 }] },
    };
    const graph = {
      links,
      getNodeById: (id: number) => nodes[String(id)] ?? null,
    };

    expect(collectIncidentLinkIds(graph, '30')).toEqual([2, 3]);
    pulseFlowingNodeGraph(graph, ['30', '40']);

    // Upstream 10→20, 20→30 and ring 30→40 should each triggerSlot once per link.
    expect(triggerSlot).toHaveBeenCalledWith(0, null, 1);
    expect(triggerSlot).toHaveBeenCalledWith(0, null, 2);
    expect(triggerSlot).toHaveBeenCalledWith(0, null, 3);

    triggerSlot.mockClear();
    triggerNodeOutputFlows(graph, '30');
    expect(triggerSlot).toHaveBeenCalledWith(0);
  });

  it('skips control wires from continuous media flow pulses', () => {
    const triggerSlot = vi.fn();
    const links: Record<string, { id: number; origin_id: number; target_id: number }> = {
      1: { id: 1, origin_id: 1, target_id: 2 },
      2: { id: 2, origin_id: 3, target_id: 2 },
    };
    const nodes: Record<string, {
      id: number;
      inputs?: Array<{ name: string; type?: string; link?: number | null }>;
      outputs?: Array<{ name: string; type?: string; links?: number[] | null }>;
      triggerSlot?: typeof triggerSlot;
    }> = {
      1: {
        id: 1,
        outputs: [{ name: 'stream', type: 'live_stream', links: [1] }],
        triggerSlot,
      },
      2: {
        id: 2,
        inputs: [
          { name: 'videoStream', type: 'live_stream', link: 1 },
          { name: 'recordStart', type: 'control', link: 2 },
        ],
        triggerSlot,
      },
      3: {
        id: 3,
        outputs: [{ name: 'out', type: 'control', links: [2] }],
        triggerSlot,
      },
    };
    const graph = {
      links,
      getNodeById: (id: number) => nodes[String(id)] ?? null,
    };

    // Seeding muxer must not BFS through recordStart → trigger, and must not pulse control wire.
    pulseFlowingNodeGraph(graph, ['2']);
    expect(triggerSlot).toHaveBeenCalledWith(0, null, 1);
    expect(triggerSlot).not.toHaveBeenCalledWith(0, null, 2);
    expect(collectIncidentLinkIds(graph, '2')).toEqual([1]);
    expect(collectIncidentLinkIds(graph, '2', { includeEphemeral: true })).toEqual([1, 2]);
  });

  it('falls back to _last_time when triggerSlot is missing', () => {
    const links: Record<string, {
      id: number;
      origin_id: number;
      target_id: number;
      _last_time?: number;
    }> = {
      7: { id: 7, origin_id: 1, target_id: 2 },
    };
    const graph = {
      links,
      _last_trigger_time: 0,
      getNodeById: () => ({ id: 1, outputs: [{ name: 'o', links: [7] }] }),
    };
    pulseLinkIds(graph, [7]);
    expect(links[7]!._last_time).toBeTypeOf('number');
    expect(graph._last_trigger_time).toBeTypeOf('number');
  });
});
