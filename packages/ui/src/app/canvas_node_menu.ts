import type { NodeDefinition } from '@media-workflow/core';
import type { LGraph, LGraphCanvas } from 'litegraph.js';

const CATEGORY_COLORS: Record<string, string> = {
  source: '#4ecdc4',
  analyze: '#7c5cff',
  select: '#ff9f43',
  decode: '#54a0ff',
  inspect: '#feca57',
  transform: '#10ac84',
  realtime: '#00d2d3',
  parser: '#7c5cff',
  demux: '#ff9f43',
  decoder: '#54a0ff',
  analysis: '#f368e0',
  display: '#feca57',
  utility: '#8b93a7',
  encoder: '#10ac84',
  export: '#10ac84',
};

export interface CanvasNodeMenuOptions {
  categories: Map<string, NodeDefinition[]>;
  onAddNode: (nodeId: string, graphPos: [number, number]) => void;
  getSelectedNodeIds?: () => string[];
  onSetNodesIgnored?: (nodeIds: string[], ignored: boolean) => void;
}

interface CanvasWithGraph extends LGraphCanvas {
  canvas: HTMLCanvasElement;
  graph: LGraph & {
    getNodeOnPos(x: number, y: number, nodes?: unknown[], margin?: number): unknown;
  };
  convertEventToCanvasOffset(event: MouseEvent): [number, number];
  _doNothing?: (event: Event) => void;
}

interface LiteGraphNodeRef {
  id: number;
  title?: string;
}

let activeMenu: HTMLElement | null = null;
let activeDismiss: ((event: Event) => void) | null = null;

export function installCanvasNodeMenu(
  canvas: LGraphCanvas,
  options: CanvasNodeMenuOptions,
): void {
  const canvasApi = canvas as CanvasWithGraph;
  const canvasElement = canvasApi.canvas;

  if (canvasApi._doNothing) {
    canvasElement.removeEventListener('contextmenu', canvasApi._doNothing);
  }

  canvasElement.addEventListener('contextmenu', event => {
    event.preventDefault();
    event.stopPropagation();

    const graphPos = canvasApi.convertEventToCanvasOffset(event);
    const hitNode = canvasApi.graph.getNodeOnPos(graphPos[0], graphPos[1]) as LiteGraphNodeRef | null;
    if (hitNode) {
      openNodeContextMenu({
        clientX: event.clientX,
        clientY: event.clientY,
        hitNode,
        getSelectedNodeIds: options.getSelectedNodeIds,
        onSetNodesIgnored: options.onSetNodesIgnored,
      });
      return;
    }

    openCanvasNodeMenu({
      clientX: event.clientX,
      clientY: event.clientY,
      graphPos,
      categories: options.categories,
      onAddNode: options.onAddNode,
    });
  });
}

function openCanvasNodeMenu(options: {
  clientX: number;
  clientY: number;
  graphPos: [number, number];
  categories: Map<string, NodeDefinition[]>;
  onAddNode: (nodeId: string, graphPos: [number, number]) => void;
}): void {
  closeCanvasNodeMenu();

  const menu = document.createElement('div');
  menu.className = 'canvas-node-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', '添加节点');

  const search = document.createElement('input');
  search.className = 'canvas-node-menu__search';
  search.type = 'search';
  search.placeholder = '搜索节点…';
  search.setAttribute('aria-label', '搜索节点');
  menu.append(search);

  const list = document.createElement('div');
  list.className = 'canvas-node-menu__list';
  menu.append(list);

  const renderList = (query: string) => {
    list.innerHTML = '';
    const normalized = query.trim().toLowerCase();
    let hasVisible = false;

    for (const [category, nodes] of options.categories) {
      const visibleNodes = nodes.filter(node => matchesNodeQuery(node, normalized));
      if (visibleNodes.length === 0) continue;
      hasVisible = true;

      const group = document.createElement('section');
      group.className = 'canvas-node-menu__group';

      const label = document.createElement('div');
      label.className = 'canvas-node-menu__category';
      label.textContent = category;
      label.style.setProperty('--node-color', CATEGORY_COLORS[category] ?? '#8b93a7');
      group.append(label);

      for (const node of visibleNodes) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'canvas-node-menu__item';
        button.setAttribute('role', 'menuitem');
        button.dataset.nodeId = node.id;
        button.innerHTML = `
          <span class="canvas-node-menu__item-name">${escapeHtml(node.displayName)}</span>
          <span class="canvas-node-menu__item-desc">${escapeHtml(node.description ?? node.id)}</span>
        `;
        button.addEventListener('click', () => {
          options.onAddNode(node.id, options.graphPos);
          closeCanvasNodeMenu();
        });
        group.append(button);
      }

      list.append(group);
    }

    if (!hasVisible) {
      const empty = document.createElement('div');
      empty.className = 'canvas-node-menu__empty';
      empty.textContent = '没有匹配的节点';
      list.append(empty);
    }
  };

  renderList('');
  search.addEventListener('input', () => renderList(search.value));

  const maxLeft = Math.max(12, window.innerWidth - 280);
  const maxTop = Math.max(12, window.innerHeight - 360);
  menu.style.left = `${Math.min(options.clientX, maxLeft)}px`;
  menu.style.top = `${Math.min(options.clientY, maxTop)}px`;

  document.body.append(menu);
  activeMenu = menu;
  search.focus();

  const dismiss = (event: Event) => {
    if (event.target instanceof Node && menu.contains(event.target)) return;
    closeCanvasNodeMenu();
  };

  activeDismiss = dismiss;
  window.setTimeout(() => {
    document.addEventListener('pointerdown', dismiss, true);
    document.addEventListener('keydown', onMenuKeydown, true);
  }, 0);
}

function onMenuKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    closeCanvasNodeMenu();
  }
}

function closeCanvasNodeMenu(): void {
  activeMenu?.remove();
  activeMenu = null;
  if (activeDismiss) {
    document.removeEventListener('pointerdown', activeDismiss, true);
    activeDismiss = null;
  }
  document.removeEventListener('keydown', onMenuKeydown, true);
}

function openNodeContextMenu(options: {
  clientX: number;
  clientY: number;
  hitNode: LiteGraphNodeRef;
  getSelectedNodeIds?: () => string[];
  onSetNodesIgnored?: (nodeIds: string[], ignored: boolean) => void;
}): void {
  if (!options.onSetNodesIgnored) return;

  closeCanvasNodeMenu();

  const targetIds = resolveContextTargetIds(options.hitNode, options.getSelectedNodeIds);
  if (targetIds.length === 0) return;

  const menu = document.createElement('div');
  menu.className = 'canvas-node-menu canvas-node-menu--context';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', '节点操作');

  const title = document.createElement('div');
  title.className = 'canvas-node-menu__context-title';
  title.textContent = targetIds.length > 1
    ? `已选 ${targetIds.length} 个节点`
    : (options.hitNode.title ?? `节点 #${options.hitNode.id}`);
  menu.append(title);

  const actions = document.createElement('div');
  actions.className = 'canvas-node-menu__context-actions';
  menu.append(actions);

  const ignoreButton = document.createElement('button');
  ignoreButton.type = 'button';
  ignoreButton.className = 'canvas-node-menu__context-item';
  ignoreButton.setAttribute('role', 'menuitem');
  ignoreButton.textContent = targetIds.length > 1 ? '忽略执行（选中）' : '忽略执行';
  ignoreButton.addEventListener('click', () => {
    options.onSetNodesIgnored?.(targetIds, true);
    closeCanvasNodeMenu();
  });
  actions.append(ignoreButton);

  const restoreButton = document.createElement('button');
  restoreButton.type = 'button';
  restoreButton.className = 'canvas-node-menu__context-item';
  restoreButton.setAttribute('role', 'menuitem');
  restoreButton.textContent = targetIds.length > 1 ? '恢复执行（选中）' : '恢复执行';
  restoreButton.addEventListener('click', () => {
    options.onSetNodesIgnored?.(targetIds, false);
    closeCanvasNodeMenu();
  });
  actions.append(restoreButton);

  const maxLeft = Math.max(12, window.innerWidth - 220);
  const maxTop = Math.max(12, window.innerHeight - 160);
  menu.style.left = `${Math.min(options.clientX, maxLeft)}px`;
  menu.style.top = `${Math.min(options.clientY, maxTop)}px`;

  document.body.append(menu);
  activeMenu = menu;

  const dismiss = (event: Event) => {
    if (event.target instanceof Node && menu.contains(event.target)) return;
    closeCanvasNodeMenu();
  };

  activeDismiss = dismiss;
  window.setTimeout(() => {
    document.addEventListener('pointerdown', dismiss, true);
    document.addEventListener('keydown', onMenuKeydown, true);
  }, 0);
}

function resolveContextTargetIds(
  hitNode: LiteGraphNodeRef,
  getSelectedNodeIds?: () => string[],
): string[] {
  const hitId = String(hitNode.id);
  const selectedIds = getSelectedNodeIds?.() ?? [];
  if (selectedIds.length > 0 && selectedIds.includes(hitId)) {
    return selectedIds;
  }
  return [hitId];
}

function matchesNodeQuery(node: NodeDefinition, query: string): boolean {
  if (!query) return true;
  const haystack = [
    node.id,
    node.displayName,
    node.description ?? '',
    node.category,
  ].join(' ').toLowerCase();
  return haystack.includes(query);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
