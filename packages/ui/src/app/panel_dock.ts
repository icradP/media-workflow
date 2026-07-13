import { scheduleCanvasResize } from './canvas_layout.js';

type PanelId = 'palette' | 'inspector' | 'results';
type PanelMode = 'docked' | 'collapsed' | 'floating';

interface PanelLayout {
  mode: PanelMode;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DockState {
  palette: PanelLayout;
  inspector: PanelLayout;
  results: PanelLayout;
}

const STORAGE_KEY = 'media-workflow-panel-dock-v3';

const PANEL_CONFIG: Record<
  PanelId,
  { elementId: string; defaultWidth: number; defaultHeight: number; label: string }
> = {
  palette: { elementId: 'palette', defaultWidth: 248, defaultHeight: 520, label: '节点库' },
  inspector: { elementId: 'properties', defaultWidth: 320, defaultHeight: 520, label: '检查器' },
  results: { elementId: 'status', defaultWidth: 720, defaultHeight: 280, label: '分析结果' },
};

const DEFAULT_STATE: DockState = {
  palette: { mode: 'docked', x: 16, y: 72, width: 248, height: 520 },
  inspector: { mode: 'docked', x: 0, y: 72, width: 320, height: 520 },
  results: { mode: 'docked', x: 16, y: 0, width: 720, height: 280 },
};

export function initPanelDock(): void {
  const app = document.getElementById('app');
  if (!app) return;

  const state = loadDockState();
  ensurePanelControls();
  ensureDockTabs();
  ensureResultsResizeHandle();
  bindPanelActions(app, state);
  bindDockTabs(app, state);
  applyDockState(app, state);

  window.addEventListener('resize', () => {
    clampFloatingPanels(state);
    syncFloatingPanelStyles(state);
    scheduleCanvasResize();
  });
}

function loadDockState(): DockState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_STATE);
    const parsed = JSON.parse(raw) as Partial<DockState>;
    return {
      palette: { ...DEFAULT_STATE.palette, ...parsed.palette },
      inspector: { ...DEFAULT_STATE.inspector, ...parsed.inspector },
      results: { ...DEFAULT_STATE.results, ...parsed.results },
    };
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

function saveDockState(state: DockState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function panelElement(id: PanelId): HTMLElement | null {
  return document.getElementById(PANEL_CONFIG[id].elementId);
}

function ensurePanelControls(): void {
  for (const [id, config] of Object.entries(PANEL_CONFIG) as Array<[PanelId, typeof PANEL_CONFIG.palette]>) {
    const panel = panelElement(id);
    if (!panel || panel.querySelector('.panel-actions')) continue;

    const header = panel.querySelector('.panel-header, .results-header');
    if (!header) continue;

    const actions = document.createElement('div');
    actions.className = 'panel-actions';
    actions.dataset.panel = id;
    actions.innerHTML = `
      <button type="button" class="panel-action" data-action="collapse" title="收起面板" aria-label="收起${config.label}">−</button>
      <button type="button" class="panel-action" data-action="popout" title="弹出面板" aria-label="弹出${config.label}">↗</button>
    `;
    header.append(actions);
  }
}

function ensureDockTabs(): void {
  const canvasWrap = document.getElementById('canvas-wrap');
  if (!canvasWrap || canvasWrap.querySelector('.dock-tab')) return;

  for (const id of ['palette', 'inspector'] as PanelId[]) {
    const config = PANEL_CONFIG[id];
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = `dock-tab dock-tab--${id === 'palette' ? 'left' : 'right'}`;
    tab.dataset.panel = id;
    tab.hidden = true;
    tab.title = `展开${config.label}`;
    tab.setAttribute('aria-label', `展开${config.label}`);
    tab.textContent = config.label;
    canvasWrap.append(tab);
  }
}

function ensureResultsResizeHandle(): void {
  const panel = panelElement('results');
  if (!panel || panel.querySelector('.panel-resize-handle')) return;

  const handle = document.createElement('div');
  handle.className = 'panel-resize-handle';
  handle.title = '拖动调整高度';
  handle.setAttribute('aria-label', '拖动调整分析结果面板高度');
  panel.prepend(handle);
}

function bindPanelActions(app: HTMLElement, state: DockState): void {
  app.addEventListener('click', event => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('.panel-action');
    if (!button) return;

    const actions = button.closest<HTMLElement>('.panel-actions');
    const panelId = actions?.dataset.panel as PanelId | undefined;
    if (!panelId) return;

    const action = button.dataset.action;
    if (action === 'collapse') {
      toggleCollapse(panelId, state);
    } else if (action === 'popout') {
      toggleFloating(panelId, state);
    }

    applyDockState(app, state);
    saveDockState(state);
  });
}

function bindDockTabs(app: HTMLElement, state: DockState): void {
  app.addEventListener('click', event => {
    const tab = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('.dock-tab');
    if (!tab) return;
    const panelId = tab.dataset.panel as PanelId | undefined;
    if (!panelId) return;
    state[panelId].mode = 'docked';
    applyDockState(app, state);
    saveDockState(state);
  });

  const resultsHandle = panelElement('results')?.querySelector<HTMLElement>('.panel-resize-handle');
  if (!resultsHandle) return;

  let resizing = false;
  let startY = 0;
  let startHeight = 0;

  resultsHandle.addEventListener('pointerdown', event => {
    if (state.results.mode !== 'docked') return;
    resizing = true;
    startY = event.clientY;
    startHeight = state.results.height;
    resultsHandle.setPointerCapture(event.pointerId);
    document.body.classList.add('panel-resizing');
  });

  resultsHandle.addEventListener('pointermove', event => {
    if (!resizing) return;
    const delta = startY - event.clientY;
    state.results.height = clamp(
      startHeight + delta,
      120,
      Math.max(180, window.innerHeight - 180),
    );
    app.style.setProperty('--results-height', `${state.results.height}px`);
    scheduleCanvasResize();
  });

  const stopResize = (event: PointerEvent) => {
    if (!resizing) return;
    resizing = false;
    resultsHandle.releasePointerCapture(event.pointerId);
    document.body.classList.remove('panel-resizing');
    saveDockState(state);
  };
  resultsHandle.addEventListener('pointerup', stopResize);
  resultsHandle.addEventListener('pointercancel', stopResize);
}

function toggleCollapse(panelId: PanelId, state: DockState): void {
  const layout = state[panelId];
  if (layout.mode === 'collapsed') {
    layout.mode = 'docked';
    return;
  }
  if (layout.mode === 'floating') {
    layout.mode = 'docked';
    return;
  }
  layout.mode = 'collapsed';
}

function toggleFloating(panelId: PanelId, state: DockState): void {
  const layout = state[panelId];
  const config = PANEL_CONFIG[panelId];
  const panel = panelElement(panelId);
  if (!panel) return;

  if (layout.mode === 'floating') {
    layout.mode = 'docked';
    return;
  }

  const rect = panel.getBoundingClientRect();
  layout.mode = 'floating';
  layout.x = Math.max(12, rect.left);
  layout.y = Math.max(56, rect.top);
  layout.width = Math.max(220, rect.width || config.defaultWidth);
  layout.height = Math.max(160, rect.height || config.defaultHeight);
  clampFloatingPanel(panelId, layout);
}

function applyDockState(app: HTMLElement, state: DockState): void {
  app.dataset.paletteMode = state.palette.mode;
  app.dataset.inspectorMode = state.inspector.mode;
  app.dataset.resultsMode = state.results.mode;

  app.style.setProperty(
    '--palette-width',
    state.palette.mode === 'docked' ? `${PANEL_CONFIG.palette.defaultWidth}px` : '0px',
  );
  app.style.setProperty(
    '--inspector-width',
    state.inspector.mode === 'docked' ? `${PANEL_CONFIG.inspector.defaultWidth}px` : '0px',
  );
  app.style.setProperty(
    '--results-height',
    state.results.mode === 'docked'
      ? `${state.results.height}px`
      : state.results.mode === 'collapsed'
        ? '42px'
        : '0px',
  );

  for (const id of Object.keys(PANEL_CONFIG) as PanelId[]) {
    const panel = panelElement(id);
    if (!panel) continue;
    const layout = state[id];
    const collapsed = layout.mode === 'collapsed';
    const floating = layout.mode === 'floating';

    panel.classList.toggle('panel--collapsed', collapsed);
    panel.classList.toggle('panel--floating', floating);
    panel.dataset.mode = layout.mode;

    if (floating) {
      panel.style.left = `${layout.x}px`;
      panel.style.top = `${layout.y}px`;
      panel.style.width = `${layout.width}px`;
      panel.style.height = `${layout.height}px`;
      makePanelDraggable(panel, id, state);
    } else {
      panel.style.left = '';
      panel.style.top = '';
      panel.style.width = '';
      panel.style.height = '';
    }

    const collapseButton = panel.querySelector<HTMLButtonElement>('[data-action="collapse"]');
    if (collapseButton) {
      const expanded = layout.mode === 'docked' || layout.mode === 'floating';
      collapseButton.textContent = expanded ? '−' : '+';
      collapseButton.title = expanded ? '收起面板' : '展开面板';
      collapseButton.setAttribute('aria-label', collapseButton.title);
    }

    const popoutButton = panel.querySelector<HTMLButtonElement>('[data-action="popout"]');
    if (popoutButton) {
      const floatingActive = layout.mode === 'floating';
      popoutButton.textContent = floatingActive ? '⤓' : '↗';
      popoutButton.title = floatingActive ? '收回面板' : '弹出面板';
      popoutButton.setAttribute('aria-label', popoutButton.title);
      popoutButton.disabled = layout.mode === 'collapsed';
    }

    const tab = document.querySelector<HTMLButtonElement>(`.dock-tab[data-panel="${id}"]`);
    if (tab) tab.hidden = layout.mode !== 'collapsed';
  }

  scheduleCanvasResize();
}

function syncFloatingPanelStyles(state: DockState): void {
  for (const id of Object.keys(PANEL_CONFIG) as PanelId[]) {
    if (state[id].mode !== 'floating') continue;
    const panel = panelElement(id);
    const layout = state[id];
    if (!panel) continue;
    panel.style.left = `${layout.x}px`;
    panel.style.top = `${layout.y}px`;
    panel.style.width = `${layout.width}px`;
    panel.style.height = `${layout.height}px`;
  }
}

const dragBindings = new WeakSet<HTMLElement>();

function makePanelDraggable(panel: HTMLElement, panelId: PanelId, state: DockState): void {
  if (dragBindings.has(panel)) return;
  dragBindings.add(panel);

  const handle = panel.querySelector<HTMLElement>('.panel-header, .results-header');
  if (!handle) return;

  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;

  handle.addEventListener('pointerdown', event => {
    if ((event.target as HTMLElement).closest('.panel-action, .panel-actions, button, input, select, label')) {
      return;
    }
    if (state[panelId].mode !== 'floating') return;
    dragging = true;
    const rect = panel.getBoundingClientRect();
    offsetX = event.clientX - rect.left;
    offsetY = event.clientY - rect.top;
    handle.setPointerCapture(event.pointerId);
    panel.classList.add('panel--dragging');
  });

  handle.addEventListener('pointermove', event => {
    if (!dragging) return;
    const layout = state[panelId];
    layout.x = clamp(event.clientX - offsetX, 8, window.innerWidth - 120);
    layout.y = clamp(event.clientY - offsetY, 56, window.innerHeight - 80);
    panel.style.left = `${layout.x}px`;
    panel.style.top = `${layout.y}px`;
  });

  const stopDrag = (event: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    handle.releasePointerCapture(event.pointerId);
    panel.classList.remove('panel--dragging');
    saveDockState(state);
  };
  handle.addEventListener('pointerup', stopDrag);
  handle.addEventListener('pointercancel', stopDrag);
}

function clampFloatingPanels(state: DockState): void {
  for (const id of Object.keys(PANEL_CONFIG) as PanelId[]) {
    if (state[id].mode === 'floating') clampFloatingPanel(id, state[id]);
  }
}

function clampFloatingPanel(panelId: PanelId, layout: PanelLayout): void {
  const minWidth = panelId === 'results' ? 360 : 220;
  const minHeight = panelId === 'results' ? 160 : 220;
  layout.width = clamp(layout.width, minWidth, window.innerWidth - 24);
  layout.height = clamp(layout.height, minHeight, window.innerHeight - 72);
  layout.x = clamp(layout.x, 8, window.innerWidth - layout.width - 8);
  layout.y = clamp(layout.y, 56, window.innerHeight - layout.height - 8);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
