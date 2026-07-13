import { listMediaDevices } from '@media-workflow/codec';

interface DeviceCaptureNode {
  id: number;
  properties: Record<string, unknown>;
  addWidget: (
    type: string,
    name: string,
    value: unknown,
    callback: string | ((value?: unknown) => void),
    options?: Record<string, unknown>,
  ) => unknown;
  widgets?: Array<{ name: string; value: unknown; options?: Record<string, unknown> }>;
  setDirtyCanvas?: (dirty: boolean, dirtyBg?: boolean) => void;
  size: [number, number];
}

const DEFAULT_DEVICE = { value: '', label: '系统默认' };

export function attachDeviceCaptureUi(
  node: DeviceCaptureNode,
  onParamChange?: (nodeId: string) => void,
): void {
  node.addWidget('button', '刷新设备…', null, () => {
    void refreshDeviceWidgets(node, onParamChange);
  });
  void refreshDeviceWidgets(node, onParamChange);
}

async function refreshDeviceWidgets(
  node: DeviceCaptureNode,
  onParamChange?: (nodeId: string) => void,
): Promise<void> {
  let devices: Awaited<ReturnType<typeof listMediaDevices>> = [];
  try {
    devices = await listMediaDevices();
  } catch {
    devices = [];
  }

  const videoOptions = [
    DEFAULT_DEVICE,
    ...devices
      .filter(device => device.kind === 'videoinput')
      .map(device => ({ value: device.deviceId, label: device.label })),
  ];
  const audioOptions = [
    DEFAULT_DEVICE,
    ...devices
      .filter(device => device.kind === 'audioinput')
      .map(device => ({ value: device.deviceId, label: device.label })),
  ];

  upsertDeviceWidget(node, 'videoDeviceId', videoOptions, onParamChange);
  upsertDeviceWidget(node, 'audioDeviceId', audioOptions, onParamChange);
  node.setDirtyCanvas?.(true, true);
}

function upsertDeviceWidget(
  node: DeviceCaptureNode,
  property: 'videoDeviceId' | 'audioDeviceId',
  options: Array<{ value: string; label: string }>,
  onParamChange?: (nodeId: string) => void,
): void {
  const label = property === 'videoDeviceId' ? '摄像头' : '麦克风';
  const values = options.map(option => option.label);
  const currentValue = String(node.properties[property] ?? '');
  const selected = options.find(option => option.value === currentValue) ?? DEFAULT_DEVICE;
  node.properties[property] = selected.value;

  const existing = node.widgets?.find(widget => widget.name === label);
  if (existing) {
    existing.value = selected.label;
    existing.options = { values, property };
    return;
  }

  node.addWidget('combo', label, selected.label, value => {
    const picked = options.find(option => option.label === String(value ?? '')) ?? DEFAULT_DEVICE;
    node.properties[property] = picked.value;
    onParamChange?.(String(node.id));
  }, {
    values,
    property,
  });
}

export function deviceCaptureNodeWidth(): number {
  return 280;
}

export function deviceCaptureNodeHeight(): number {
  return 220;
}
