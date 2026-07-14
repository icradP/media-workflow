type ParamChangeFn = (nodeId: string) => void;

interface WidgetHost {
  id: number | string;
  properties?: Record<string, unknown>;
  addWidget: (
    type: string,
    name: string,
    value: unknown,
    callback: (value?: unknown) => void,
    options?: Record<string, unknown>,
  ) => unknown;
  setDirtyCanvas?: (fg: boolean, bg: boolean) => void;
}

export type TriggerPulseEmit = (canvasNodeId: string) => void | Promise<void>;

/** Single pulse button — label comes from node.properties.label. */
export function attachTriggerButtonUi(
  node: WidgetHost,
  onPulse: TriggerPulseEmit,
  onParamChange?: ParamChangeFn,
): void {
  const label = String(node.properties?.label || 'Trigger');
  node.addWidget('button', label, null, () => {
    void onPulse(String(node.id));
    node.setDirtyCanvas?.(true, true);
    onParamChange?.(String(node.id));
  });
}
