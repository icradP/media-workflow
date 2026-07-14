import { LiteGraph } from 'litegraph.js';

/**
 * Official LiteGraph flow-dot path (see events/timer → this.trigger / triggerSlot):
 * 1. node.triggerSlot(slot) stamps link._last_time + graph._last_trigger_time
 * 2. LGraphCanvas.startRendering() calls draw() every rAF
 * 3. While _last_trigger_time is fresh (<1s), drawBackCanvas() re-renders wires
 * 4. renderLink(..., flow) draws travelling dots from LiteGraph.getTime()
 *
 * We mirror that API for Live data wires (any pin), without inventing a custom particle system.
 */

interface LGraphNodeLike {
  id: number | string;
  inputs?: Array<{ name: string; type?: string; link?: number | null }>;
  outputs?: Array<{ name: string; type?: string; links?: number[] | null }>;
  /**
   * Official LiteGraph API — stamps flow animation on connected output links.
   * @see LGraphNode.prototype.triggerSlot in litegraph.js
   */
  triggerSlot?: (
    slot: number,
    param?: unknown,
    link_id?: number | null,
    options?: Record<string, unknown>,
  ) => void;
}

interface LLinkLike {
  id: number;
  origin_id?: number;
  target_id?: number;
  _last_time?: number;
}

interface GraphWithLinks {
  links?: Record<string, LLinkLike | undefined>;
  _last_trigger_time?: number;
  getNodeById?(id: number): LGraphNodeLike | null;
}

/**
 * Pulse LiteGraph link flow dots the official way: prefer node.triggerSlot(slot).
 * Falls back to stamping link._last_time when triggerSlot is unavailable.
 */
export function pulseLinkIds(graph: unknown, linkIds: Iterable<number | string>): void {
  const host = graph as GraphWithLinks;
  const links = host.links;
  if (!links) return;

  const now = LiteGraph.getTime();
  const byOriginSlot = new Map<string, { nodeId: number; slot: number; linkIds: number[] }>();
  const orphanLinkIds: number[] = [];

  for (const rawId of linkIds) {
    const id = Number(rawId);
    const link = links[String(id)];
    if (!link) continue;
    const originId = link.origin_id;
    const originNode = originId != null ? host.getNodeById?.(originId) : null;
    const slot = findOutputSlotForLink(originNode, id);
    if (originNode && slot >= 0 && typeof originNode.triggerSlot === 'function') {
      const key = `${originId}:${slot}`;
      const bucket = byOriginSlot.get(key) ?? {
        nodeId: originId!,
        slot,
        linkIds: [],
      };
      bucket.linkIds.push(id);
      byOriginSlot.set(key, bucket);
    } else {
      orphanLinkIds.push(id);
    }
  }

  for (const bucket of byOriginSlot.values()) {
    const node = host.getNodeById?.(bucket.nodeId);
    if (!node?.triggerSlot) continue;
    // Official API: one trigger per specific link keeps dots on that wire only.
    for (const linkId of bucket.linkIds) {
      node.triggerSlot(bucket.slot, null, linkId);
    }
  }

  // Fallback for partially constructed graphs / tests without triggerSlot.
  if (orphanLinkIds.length > 0) {
    for (const id of orphanLinkIds) {
      const link = links[String(id)];
      if (link) link._last_time = now;
    }
    host._last_trigger_time = now;
  }
}

function findOutputSlotForLink(node: LGraphNodeLike | null | undefined, linkId: number): number {
  if (!node?.outputs) return -1;
  for (let slot = 0; slot < node.outputs.length; slot++) {
    const links = node.outputs[slot]?.links;
    if (links?.includes(linkId)) return slot;
  }
  return -1;
}

/**
 * Control / gate pins carry discrete events, not continuous media.
 * Flow dots must not stay on for these — only pulse on explicit signal emit.
 */
const EPHEMERAL_PIN_TYPES = new Set(['control', 'boolean']);
const EPHEMERAL_PIN_NAMES = new Set(['control', 'armed', 'recordStart', 'recordStop']);

export function isEphemeralControlPin(slot: { name?: string; type?: string } | null | undefined): boolean {
  if (!slot) return false;
  if (slot.type && EPHEMERAL_PIN_TYPES.has(String(slot.type))) return true;
  if (slot.name && EPHEMERAL_PIN_NAMES.has(slot.name)) return true;
  return false;
}

/** Collect every link id attached to a node (all inputs + all outputs). */
export function collectIncidentLinkIds(
  graph: unknown,
  nodeId: string,
  options?: { includeEphemeral?: boolean },
): number[] {
  const host = graph as GraphWithLinks;
  const node = host.getNodeById?.(Number(nodeId));
  if (!node) return [];
  const includeEphemeral = options?.includeEphemeral === true;

  const linkIds: number[] = [];
  for (const input of node.inputs ?? []) {
    if (input.link == null) continue;
    if (!includeEphemeral && isEphemeralControlPin(input)) continue;
    linkIds.push(input.link);
  }
  for (const output of node.outputs ?? []) {
    if (!output.links?.length) continue;
    if (!includeEphemeral && isEphemeralControlPin(output)) continue;
    linkIds.push(...output.links);
  }
  return linkIds;
}

/** Pulse every media (non-control) link connected to the given nodes. */
export function pulseNodesIncidentLinks(
  graph: unknown,
  nodeIds: Iterable<string>,
): void {
  const linkIds: number[] = [];
  for (const nodeId of nodeIds) {
    linkIds.push(...collectIncidentLinkIds(graph, nodeId));
  }
  pulseLinkIds(graph, linkIds);
}

/**
 * Expand a seed set with upstream producers (BFS via media input links only),
 * then pulse every incident media link. Control / boolean wires are skipped.
 */
export function pulseFlowingNodeGraph(
  graph: unknown,
  seedNodeIds: Iterable<string>,
): void {
  const host = graph as GraphWithLinks;
  const flowing = new Set<string>();
  const queue: string[] = [];

  for (const id of seedNodeIds) {
    if (!flowing.has(id)) {
      flowing.add(id);
      queue.push(id);
    }
  }

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    const node = host.getNodeById?.(Number(nodeId));
    if (!node?.inputs || !host.links) continue;
    for (const input of node.inputs) {
      if (input.link == null) continue;
      if (isEphemeralControlPin(input)) continue;
      const link = host.links[String(input.link)];
      if (link?.origin_id == null) continue;
      const upstreamId = String(link.origin_id);
      if (flowing.has(upstreamId)) continue;
      flowing.add(upstreamId);
      queue.push(upstreamId);
    }
  }

  pulseNodesIncidentLinks(graph, flowing);
}

/** Briefly pulse Trigger → control gate links (discrete event, not continuous media). */
export function pulseControlOutputLinks(graph: unknown, signalNodeId: string): void {
  const host = graph as GraphWithLinks;
  const node = host.getNodeById?.(Number(signalNodeId));
  if (!node?.outputs) return;
  const linkIds: number[] = [];
  for (const output of node.outputs) {
    if (!isEphemeralControlPin(output)) continue;
    if (output.links?.length) linkIds.push(...output.links);
  }
  pulseLinkIds(graph, linkIds);
}

/**
 * Trigger all connected output slots on a node (official LiteGraphTimer/Event style).
 * Prefer this when you already know the producer node.
 */
export function triggerNodeOutputFlows(graph: unknown, nodeId: string): void {
  const host = graph as GraphWithLinks;
  const node = host.getNodeById?.(Number(nodeId));
  if (!node?.outputs || typeof node.triggerSlot !== 'function') {
    pulseNodesIncidentLinks(graph, [nodeId]);
    return;
  }
  for (let slot = 0; slot < node.outputs.length; slot++) {
    const links = node.outputs[slot]?.links;
    if (!links?.length) continue;
    node.triggerSlot(slot);
  }
}

/** Pulse named ports; empty filters pulse all incident links. */
export function pulseNodePortLinks(
  graph: unknown,
  nodeId: string,
  ports: { inputs?: string[]; outputs?: string[] } = {},
): void {
  const host = graph as GraphWithLinks;
  const node = host.getNodeById?.(Number(nodeId));
  if (!node) return;

  const hasFilter = Boolean(ports.inputs?.length || ports.outputs?.length);
  if (!hasFilter) {
    pulseNodesIncidentLinks(graph, [nodeId]);
    return;
  }

  const linkIds: number[] = [];
  if (ports.inputs?.length && node.inputs) {
    for (const name of ports.inputs) {
      const slot = node.inputs.find(input => input.name === name);
      if (slot?.link != null) linkIds.push(slot.link);
    }
  }
  if (ports.outputs?.length && node.outputs) {
    for (const name of ports.outputs) {
      const slotIndex = node.outputs.findIndex(output => output.name === name);
      if (slotIndex < 0) continue;
      const links = node.outputs[slotIndex]?.links;
      if (links?.length) linkIds.push(...links);
    }
  }
  pulseLinkIds(graph, linkIds);
}

export function formatTrackDurationSummary(track: {
  packets: Array<{ ptsUs: number; durationUs?: number }>;
}): string {
  const packets = track.packets;
  if (packets.length === 0) return '0 packets';
  let minPts = Infinity;
  let maxEnd = -Infinity;
  for (const packet of packets) {
    minPts = Math.min(minPts, packet.ptsUs);
    maxEnd = Math.max(maxEnd, packet.ptsUs + Math.max(0, packet.durationUs ?? 0));
  }
  const seconds = Math.max(0, (maxEnd - minPts) / 1_000_000);
  return `${packets.length} packets · ${seconds.toFixed(1)}s`;
}
