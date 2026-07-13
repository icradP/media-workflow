import { LiteGraph, type LGraphCanvas } from 'litegraph.js';

interface EditableNode {
  id: number;
  pos: [number, number];
  size: [number, number];
  properties: Record<string, unknown>;
  setDirtyCanvas?(foreground: boolean, background: boolean): void;
}

interface EditableWidget {
  name: string | null;
  label?: string;
  value: unknown;
  type?: string;
  last_y?: number;
  options?: {
    min?: number;
    max?: number;
    step?: number;
    values?: string[];
    property?: string;
  };
}

export interface InlineWidgetEditorOptions {
  onValueChange?: (nodeId: string) => void;
}

export function installInlineNodeWidgetEditor(
  canvas: LGraphCanvas,
  host: HTMLElement,
  options: InlineWidgetEditorOptions = {},
): void {
  const canvasWithPrompt = canvas as LGraphCanvas & {
    prompt: (
      title: string,
      value: string,
      callback: (value: string) => void,
      event?: MouseEvent,
      multiline?: boolean,
    ) => HTMLElement;
    node_widget: [EditableNode, EditableWidget] | null;
    convertOffsetToCanvas: (pos: [number, number]) => [number, number];
    ds: { scale: number };
    setDirty: (foreground: boolean, background: boolean) => void;
  };

  const originalPrompt = canvasWithPrompt.prompt.bind(canvasWithPrompt);
  let activeEditor: HTMLInputElement | HTMLTextAreaElement | null = null;

  canvasWithPrompt.prompt = function promptInline(
    this: typeof canvasWithPrompt,
    title: string,
    value: string,
    callback: (value: string) => void,
    event?: MouseEvent,
    multiline?: boolean,
  ): HTMLElement {
    const nodeWidget = this.node_widget;
    if (!nodeWidget || !nodeWidget[1].last_y) {
      return originalPrompt(title, value, callback, event, multiline);
    }

    closeActiveEditor();

    const [node, widget] = nodeWidget;
    const editor = createInlineEditor({
      host,
      canvas: this,
      node,
      widget,
      value: String(value ?? ''),
      multiline: Boolean(multiline),
      onCommit: nextValue => {
        callback(nextValue);
        syncWidgetProperty(node, widget, nextValue);
        options.onValueChange?.(String(node.id));
        this.setDirty(true, true);
        node.setDirtyCanvas?.(true, true);
      },
      onClose: () => {
        activeEditor = null;
      },
    });

    activeEditor = editor;
    return document.createElement('div');
  } as typeof canvasWithPrompt.prompt;

  host.addEventListener('pointerdown', event => {
    if (activeEditor && event.target !== activeEditor) {
      commitAndClose(activeEditor);
      activeEditor = null;
    }
  }, true);
}

function createInlineEditor(options: {
  host: HTMLElement;
  canvas: LGraphCanvas & {
    convertOffsetToCanvas: (pos: [number, number]) => [number, number];
    ds: { scale: number };
  };
  node: EditableNode;
  widget: EditableWidget;
  value: string;
  multiline: boolean;
  onCommit: (value: string) => void;
  onClose: () => void;
}): HTMLInputElement | HTMLTextAreaElement {
  const margin = 6;
  const height = LiteGraph.NODE_WIDGET_HEIGHT;
  const graphY = options.widget.last_y ?? 0;
  const graphPos: [number, number] = [
    options.node.pos[0] + margin,
    options.node.pos[1] + graphY,
  ];
  const canvasPos = options.canvas.convertOffsetToCanvas(graphPos);
  const canvasElement = options.canvas.canvas as HTMLCanvasElement;
  const canvasRect = canvasElement.getBoundingClientRect();
  const width = Math.max(120, (options.node.size[0] - margin * 2) * options.canvas.ds.scale);

  const editor = options.multiline
    ? document.createElement('textarea')
    : document.createElement('input');

  editor.className = 'node-widget-input';
  editor.value = options.value;
  if (!options.multiline) {
    const input = editor as HTMLInputElement;
    input.type = options.widget.type === 'number' ? 'number' : 'text';
    if (options.widget.type === 'number') {
      if (options.widget.options?.min !== undefined) {
        input.min = String(options.widget.options.min);
      }
      if (options.widget.options?.max !== undefined) {
        input.max = String(options.widget.options.max);
      }
      if (options.widget.options?.step !== undefined) {
        input.step = String(options.widget.options.step);
      }
    }
  }

  editor.style.left = `${canvasRect.left + canvasPos[0]}px`;
  editor.style.top = `${canvasRect.top + canvasPos[1]}px`;
  editor.style.width = `${width}px`;
  editor.style.height = `${height * options.canvas.ds.scale}px`;

  const commit = () => {
    const nextValue = normalizeWidgetValue(options.widget, editor.value);
    options.onCommit(nextValue);
    options.onClose();
    editor.remove();
  };

  editor.addEventListener('keydown', event => {
    const keyEvent = event as KeyboardEvent;
    if (keyEvent.key === 'Escape') {
      keyEvent.preventDefault();
      options.onClose();
      editor.remove();
      return;
    }
    if (keyEvent.key === 'Enter' && !options.multiline) {
      keyEvent.preventDefault();
      commit();
    }
  });
  editor.addEventListener('blur', () => {
    commit();
  });

  document.body.appendChild(editor);
  editor.focus();
  editor.select();
  return editor;
}

function normalizeWidgetValue(widget: EditableWidget, raw: string): string {
  if (widget.type === 'number') {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return String(widget.value ?? 0);
    const min = widget.options?.min;
    const max = widget.options?.max;
    const clamped = Math.min(
      max ?? Number.POSITIVE_INFINITY,
      Math.max(min ?? Number.NEGATIVE_INFINITY, parsed),
    );
    return String(clamped);
  }
  return raw;
}

function syncWidgetProperty(
  node: EditableNode,
  widget: EditableWidget,
  value: string,
): void {
  const property = widget.options?.property ?? widget.name;
  if (!property) return;

  const parsed = widget.type === 'number' ? Number(value) : value;
  node.properties[property] = parsed;
  widget.value = parsed;
}

function commitAndClose(editor: HTMLInputElement | HTMLTextAreaElement): void {
  editor.blur();
}

function closeActiveEditor(): void {
  const existing = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    '.node-widget-input',
  );
  existing?.blur();
}
