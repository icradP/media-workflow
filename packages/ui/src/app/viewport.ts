import type {
  AudioMediaTrack,
  MediaAsset,
  MediaSelection,
  MediaSample,
  MediaTrack,
  SelectedTrack,
  NodeExecutionEvent,
  VideoMediaTrack,
  DecodedVideoClip,
  DecodedVideoFrame,
} from '@media-workflow/core';
import { drawDecodedFrameToCanvas } from '@media-workflow/codec';

type NodeRenderer = (event: NodeExecutionEvent, element: HTMLElement) => void;
const resultElements = new Map<string, HTMLElement>();

const renderers = new Map<string, NodeRenderer>([
  ['auto_analyze', renderAutoAnalyze],
  ['stream_overview', renderStreamOverview],
  ['track_detail', renderTrackDetailEvent],
  ['sample_table', renderSampleTableEvent],
  ['media_select', renderSampleTableEvent],
  ['hex_view', renderHexEvent],
  ['video_preview', renderYuvPreviewEvent],
  ['wav_player', renderWavPlayerEvent],
  ['mp4_player', renderMp4PlayerEvent],
  ['file_export', renderFileExportEvent],
]);

type ResultCardAction = 'collapse' | 'expand' | 'close';

function viewportEl(): HTMLElement | null {
  return document.getElementById('viewport');
}

export function clearViewport(): void {
  const element = viewportEl();
  if (element) element.innerHTML = '';
  resultElements.clear();
}

export function renderExecutionEvent(event: NodeExecutionEvent): void {
  if (event.status === 'started') return;

  if (event.status === 'failed') {
    renderFailureEvent(event);
    return;
  }

  const renderer = renderers.get(event.node.id);
  if (!renderer) return;
  const element = resultElementFor(event);
  if (element && renderer) renderer(event, element);
}

function renderFailureEvent(event: NodeExecutionEvent): void {
  const element = resultElementFor(event);
  if (!element) return;
  element.innerHTML = `
    <h4 class="viewport-title viewport-title--error">执行失败</h4>
    <p class="viewport-note viewport-note--error">${escapeHtml(event.error?.message ?? 'Unknown error')}</p>
  `;
}

function resultElementFor(event: NodeExecutionEvent): HTMLElement | null {
  const viewport = viewportEl();
  if (!viewport) return null;

  const existing = resultElements.get(event.nodeId);
  if (existing) {
    const state = existing.parentElement?.querySelector<HTMLElement>('.result-card__state');
    if (state) {
      state.textContent = event.status === 'failed'
        ? 'Failed'
        : event.cacheHit
          ? 'Cached'
          : `${event.durationMs.toFixed(1)} ms`;
    }
    if (event.status === 'failed') {
      existing.parentElement?.classList.add('result-card--failed');
    }
    return existing;
  }

  const card = document.createElement('article');
  card.className = event.status === 'failed' ? 'result-card result-card--failed' : 'result-card';
  card.dataset.nodeId = event.nodeId;

  const header = document.createElement('header');
  header.className = 'result-card__header';
  const title = document.createElement('div');
  title.className = 'result-card__title';
  title.textContent = `${event.node.displayName} #${event.nodeId}`;
  const state = document.createElement('span');
  state.className = 'result-card__state';
  state.textContent = event.cacheHit ? 'Cached' : `${event.durationMs.toFixed(1)} ms`;
  const meta = document.createElement('div');
  meta.className = 'result-card__meta';
  meta.append(state, resultActionButton('collapse'), resultActionButton('expand'), resultActionButton('close'));
  header.append(title, meta);
  header.addEventListener('click', event => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>(
      '.result-card__action',
    );
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    handleResultCardAction(card, String(button.dataset.action) as ResultCardAction);
  });

  const body = document.createElement('div');
  body.className = 'result-card__body';
  card.append(header, body);
  viewport.append(card);
  resultElements.set(event.nodeId, body);
  return body;
}

function resultActionButton(action: ResultCardAction): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = 'result-card__action';
  button.type = 'button';
  button.dataset.action = action;
  const labels: Record<ResultCardAction, string> = {
    collapse: '折叠/显示',
    expand: '展开此结果',
    close: '关闭此结果',
  };
  const glyphs: Record<ResultCardAction, string> = {
    collapse: '−',
    expand: '□',
    close: '×',
  };
  button.title = labels[action];
  button.setAttribute('aria-label', labels[action]);
  button.textContent = glyphs[action];
  return button;
}

function handleResultCardAction(card: HTMLElement, action: ResultCardAction): void {
  if (action === 'close') {
    const nodeId = card.dataset.nodeId;
    if (nodeId) resultElements.delete(nodeId);
    card.remove();
    return;
  }

  if (action === 'collapse') {
    const isCollapsed = card.classList.toggle('result-card--collapsed');
    const button = card.querySelector<HTMLButtonElement>('[data-action="collapse"]');
    if (button) {
      button.textContent = isCollapsed ? '+' : '−';
      button.title = isCollapsed ? '显示此结果' : '折叠此结果';
      button.setAttribute('aria-label', button.title);
    }
    return;
  }

  const viewport = viewportEl();
  const wasExpanded = card.classList.contains('result-card--expanded');
  viewport?.querySelectorAll<HTMLElement>('.result-card--expanded').forEach(candidate => {
    candidate.classList.remove('result-card--expanded');
  });
  if (!wasExpanded) {
    card.classList.remove('result-card--collapsed');
    card.classList.add('result-card--expanded');
    card.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

function renderAutoAnalyze(event: NodeExecutionEvent, element: HTMLElement): void {
  const asset = event.outputs.asset as MediaAsset | undefined;
  if (asset) renderAssetSummary(asset, element);
}

function renderStreamOverview(event: NodeExecutionEvent, element: HTMLElement): void {
  const asset = event.inputs.asset as MediaAsset | undefined;
  if (!asset) return;
  renderAssetSummary(asset, element, true);
}

function renderTrackDetailEvent(event: NodeExecutionEvent, element: HTMLElement): void {
  const selectedTrack = event.inputs.selectedTrack as SelectedTrack | undefined;
  if (selectedTrack) renderTrackDetail(selectedTrack.track, element);
}

function renderSampleTableEvent(event: NodeExecutionEvent, element: HTMLElement): void {
  const selection = event.outputs.selection as MediaSelection | undefined;
  if (selection) renderSampleTable(selection.samples, element);
}

function renderHexEvent(event: NodeExecutionEvent, element: HTMLElement): void {
  const raw = event.outputs.preview;
  if (typeof raw !== 'string') return;
  try {
    const preview = JSON.parse(raw) as { offset: number; hex: string; ascii: string };
    element.innerHTML = `
      <h4 class="viewport-title">Hex View @ 0x${preview.offset.toString(16)}</h4>
      <pre class="viewport-hex">${escapeHtml(preview.hex)}\n${escapeHtml(preview.ascii)}</pre>
    `;
  } catch {
    element.innerHTML = `<pre class="viewport-hex">${escapeHtml(raw)}</pre>`;
  }
}

function renderYuvPreviewEvent(event: NodeExecutionEvent, element: HTMLElement): void {
  const raw = event.outputs.preview;
  if (typeof raw !== 'string') return;
  try {
    const preview = JSON.parse(raw) as {
      sourceSampleId?: string;
      ptsUs?: number;
      displayWidth?: number;
      displayHeight?: number;
      format?: string;
      byteLength?: number;
      mode?: string;
      backend?: string;
      liveStreamId?: string;
    };
    const canvasId = `yuv-canvas-${event.nodeId}`;
    const width = preview.displayWidth ?? 320;
    const height = preview.displayHeight ?? 180;
    element.innerHTML = `
      <h4 class="viewport-title">Video Preview · ${escapeHtml(preview.backend ?? 'webgpu')}</h4>
      <dl class="viewport-dl">
        <div><dt>Mode</dt><dd>${escapeHtml(preview.mode ?? 'batch')}</dd></div>
        ${preview.sourceSampleId
          ? `<div><dt>Sample</dt><dd>${escapeHtml(preview.sourceSampleId)}</dd></div>`
          : ''}
        ${preview.ptsUs !== undefined
          ? `<div><dt>PTS</dt><dd>${formatTimestamp(preview.ptsUs)}</dd></div>`
          : ''}
        <div><dt>Size</dt><dd>${width}×${height}</dd></div>
        ${preview.format
          ? `<div><dt>Format</dt><dd>${escapeHtml(preview.format)}</dd></div>`
          : ''}
        ${preview.byteLength !== undefined
          ? `<div><dt>Bytes</dt><dd>${preview.byteLength}</dd></div>`
          : ''}
        ${preview.liveStreamId
          ? `<div><dt>Live</dt><dd>${escapeHtml(preview.liveStreamId)}</dd></div>`
          : ''}
      </dl>
      <canvas id="${canvasId}" class="viewport-canvas" width="${width}" height="${height}"></canvas>
      <p class="viewport-note">Node canvas uses WebGPU (Canvas2D fallback). Live Play paces frames via Ring Buffer.</p>
    `;
    const video = event.inputs.video as DecodedVideoClip | undefined;
    const requested = Math.max(0, Math.floor(Number(event.params.frameIndex) || 0));
    const frame = video?.frames?.[
      Math.min(Math.max(0, (video.frames?.length ?? 1) - 1), requested)
    ] as DecodedVideoFrame | undefined;
    if (frame?.planes && frame.displayWidth && frame.displayHeight) {
      const canvas = document.getElementById(canvasId) as HTMLCanvasElement | null;
      if (canvas) void drawDecodedFrameToCanvas(canvas, frame);
    }
  } catch {
    element.innerHTML = `<pre class="viewport-hex">${escapeHtml(raw)}</pre>`;
  }
}

function renderWavPlayerEvent(event: NodeExecutionEvent, element: HTMLElement): void {
  const raw = event.outputs.preview;
  if (typeof raw !== 'string') return;

  try {
    const payload = JSON.parse(raw) as {
      fileName: string;
      mimeType: string;
      byteLength: number;
      sampleRate: number;
      channels: number;
      bitsPerSample: number;
      durationMs: number;
      autoplay?: boolean;
    };
    const file = resolveWavPlaybackFile(event.inputs.source);
    if (!file) {
      element.innerHTML = '<p class="viewport-note">WAV bytes are not available in this view.</p>';
      return;
    }

    const blob = new Blob([file.data.slice()], { type: payload.mimeType || 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const audioId = `wav-player-${event.nodeId}`;
    element.innerHTML = `
      <h4 class="viewport-title">WAV Player</h4>
      <dl class="viewport-dl">
        <div><dt>File</dt><dd>${escapeHtml(payload.fileName)}</dd></div>
        <div><dt>Rate</dt><dd>${payload.sampleRate} Hz</dd></div>
        <div><dt>Channels</dt><dd>${payload.channels}</dd></div>
        <div><dt>Duration</dt><dd>${formatSeconds(payload.durationMs / 1000)}</dd></div>
        <div><dt>Bytes</dt><dd>${payload.byteLength}</dd></div>
      </dl>
      <audio id="${audioId}" class="viewport-audio" controls ${payload.autoplay ? 'autoplay' : ''} src="${url}"></audio>
      <p class="viewport-note">Supports WAV Encoder output and loaded .wav media sources.</p>
    `;
    element.querySelector(`#${audioId}`)?.addEventListener('ended', () => {
      URL.revokeObjectURL(url);
    }, { once: true });
  } catch {
    element.innerHTML = `<pre class="viewport-hex">${escapeHtml(raw)}</pre>`;
  }
}

function resolveWavPlaybackFile(
  source: unknown,
): { data: Uint8Array } | null {
  if (!source || typeof source !== 'object') return null;
  if ('data' in source && source.data instanceof Uint8Array) {
    return { data: source.data };
  }
  return null;
}

function renderMp4PlayerEvent(event: NodeExecutionEvent, element: HTMLElement): void {
  const raw = event.outputs.preview;
  if (typeof raw !== 'string') return;

  try {
    const payload = JSON.parse(raw) as {
      fileName: string;
      mimeType: string;
      byteLength: number;
      durationMs: number;
      trackCount: number;
      videoTrackCount: number;
      audioTrackCount: number;
      autoplay?: boolean;
    };
    const file = resolveWavPlaybackFile(event.inputs.source);
    if (!file) {
      element.innerHTML = '<p class="viewport-note">MP4 bytes are not available in this view.</p>';
      return;
    }

    const blob = new Blob([file.data.slice()], { type: payload.mimeType || 'video/mp4' });
    const url = URL.createObjectURL(blob);
    const videoId = `mp4-player-${event.nodeId}`;
    element.innerHTML = `
      <h4 class="viewport-title">MP4 Player</h4>
      <dl class="viewport-dl">
        <div><dt>File</dt><dd>${escapeHtml(payload.fileName)}</dd></div>
        <div><dt>Tracks</dt><dd>${payload.videoTrackCount} video · ${payload.audioTrackCount} audio</dd></div>
        <div><dt>Duration</dt><dd>${formatSeconds(payload.durationMs / 1000)}</dd></div>
        <div><dt>Bytes</dt><dd>${payload.byteLength}</dd></div>
      </dl>
      <video id="${videoId}" class="viewport-video" controls ${payload.autoplay ? 'autoplay' : ''} src="${url}"></video>
      <p class="viewport-note">Supports MP4 Muxer output and loaded .mp4 media sources.</p>
    `;
    element.querySelector(`#${videoId}`)?.addEventListener('ended', () => {
      URL.revokeObjectURL(url);
    }, { once: true });
  } catch {
    element.innerHTML = `<pre class="viewport-hex">${escapeHtml(raw)}</pre>`;
  }
}

function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0.00 s';
  return `${seconds.toFixed(2)} s`;
}

function renderFileExportEvent(event: NodeExecutionEvent, element: HTMLElement): void {
  const raw = event.outputs.download;
  if (typeof raw !== 'string') return;
  try {
    const payload = JSON.parse(raw) as {
      fileName: string;
      mimeType: string;
      byteLength: number;
    };
    const file = event.inputs.file as { data?: Uint8Array } | undefined;
    const blob = file?.data
      ? new Blob([file.data.slice()], { type: payload.mimeType })
      : null;
    const url = blob ? URL.createObjectURL(blob) : '';
    element.innerHTML = `
      <h4 class="viewport-title">File Export</h4>
      <dl class="viewport-dl">
        <div><dt>File</dt><dd>${escapeHtml(payload.fileName)}</dd></div>
        <div><dt>MIME</dt><dd>${escapeHtml(payload.mimeType)}</dd></div>
        <div><dt>Bytes</dt><dd>${payload.byteLength}</dd></div>
      </dl>
      ${url
        ? `<a class="viewport-link" href="${url}" download="${escapeHtml(payload.fileName)}">Download ${escapeHtml(payload.fileName)}</a>`
        : '<p class="viewport-note">File bytes are not available in this view.</p>'}
    `;
  } catch {
    element.innerHTML = `<pre class="viewport-hex">${escapeHtml(raw)}</pre>`;
  }
}

function renderAssetSummary(
  asset: MediaAsset,
  element: HTMLElement,
  includeTracks = false,
): void {
  const duration = asset.container.durationUs === undefined
    ? '—'
    : formatDuration(asset.container.durationUs);
  const bitrate = asset.container.bitrate === undefined
    ? '—'
    : `${Math.round(asset.container.bitrate / 1_000)} kb/s`;
  const warningCount = asset.diagnostics.filter(item => item.severity !== 'info').length;

  const trackRows = includeTracks
    ? asset.tracks.map(track => `
        <tr>
          <td>${escapeHtml(track.trackId)}</td>
          <td>${track.kind}</td>
          <td>${escapeHtml(track.codec)}</td>
          <td>${track.sampleCount}</td>
          <td>${track.durationUs === undefined ? '—' : formatDuration(track.durationUs)}</td>
          <td>${track.bitrate === undefined ? '—' : `${Math.round(track.bitrate / 1_000)} kb/s`}</td>
          <td>${escapeHtml(trackDescription(track))}</td>
        </tr>
      `).join('')
    : '';

  element.innerHTML = `
    <h4 class="viewport-title">${includeTracks ? 'Stream Overview' : 'Media Analysis'}</h4>
    <dl class="viewport-dl">
      <div><dt>Container</dt><dd>${asset.container.format}</dd></div>
      <div><dt>Duration</dt><dd>${duration}</dd></div>
      <div><dt>Tracks</dt><dd>${asset.tracks.length}</dd></div>
      <div><dt>Samples</dt><dd>${asset.samples.length}</dd></div>
      <div><dt>Bitrate</dt><dd>${bitrate}</dd></div>
    </dl>
    ${warningCount > 0
      ? `<p class="viewport-note">${warningCount} analysis diagnostic(s). First: ${escapeHtml(asset.diagnostics[0]?.message ?? '')}</p>`
      : ''}
    ${includeTracks
      ? `<div class="viewport-scroll">
          <table class="viewport-table">
            <thead><tr><th>Track ID</th><th>Kind</th><th>Codec</th><th>Samples</th><th>Duration</th><th>Bitrate</th><th>Details</th></tr></thead>
            <tbody>${trackRows}</tbody>
          </table>
        </div>`
      : ''}
  `;
}

function renderTrackDetail(track: MediaTrack, element: HTMLElement): void {
  const details = track.kind === 'video'
    ? videoDetails(track)
    : track.kind === 'audio'
      ? audioDetails(track)
      : [];
  const cards: Array<[string, string]> = [
    ['Track ID', track.trackId],
    ['Kind', track.kind],
    ['Codec', `${track.codec} (${track.codecFamily})`],
    ['Samples', String(track.sampleCount)],
    ['Duration', track.durationUs === undefined ? '—' : formatDuration(track.durationUs)],
    ...details,
  ];

  element.innerHTML = `
    <h4 class="viewport-title">Track Detail</h4>
    <dl class="viewport-dl">
      ${cards.map(([label, value]) =>
        `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`,
      ).join('')}
    </dl>
  `;
}

function renderSampleTable(samples: MediaSample[], element: HTMLElement): void {
  const maxRows = 500;
  const rows = samples.slice(0, maxRows).map(sample => `
    <tr>
      <td>${sample.index}</td>
      <td>${escapeHtml(sample.trackId)}</td>
      <td>${formatTimestamp(sample.ptsUs)}</td>
      <td>${formatTimestamp(sample.dtsUs)}</td>
      <td>${sample.size}</td>
      <td>${sample.isKey ? '✓' : ''}</td>
      <td>${escapeHtml(sample.pictureType ?? '')}</td>
      <td>0x${sample.offset.toString(16)}</td>
    </tr>
  `).join('');

  element.innerHTML = `
    <h4 class="viewport-title">Sample Table (${samples.length})</h4>
    <div class="viewport-scroll">
      <table class="viewport-table">
        <thead><tr><th>#</th><th>Track</th><th>PTS</th><th>DTS</th><th>Size</th><th>Key</th><th>Type</th><th>Offset</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${samples.length > maxRows
      ? `<p class="viewport-note">Showing ${maxRows} of ${samples.length} samples.</p>`
      : ''}
  `;
}

function videoDetails(track: VideoMediaTrack): Array<[string, string]> {
  return [
    ['Resolution', track.width && track.height ? `${track.width}×${track.height}` : '—'],
    ['Frame rate', track.frameRate ? `${track.frameRate} fps` : '—'],
    ['Profile', track.profile ?? '—'],
  ];
}

function audioDetails(track: AudioMediaTrack): Array<[string, string]> {
  return [
    ['Sample rate', track.sampleRate ? `${track.sampleRate} Hz` : '—'],
    ['Channels', track.channels ? String(track.channels) : '—'],
    ['Layout', track.channelLayout ?? '—'],
  ];
}

function trackDescription(track: MediaTrack): string {
  if (track.kind === 'video') {
    return track.width && track.height ? `${track.width}×${track.height}` : '';
  }
  if (track.kind === 'audio') {
    return [
      track.sampleRate ? `${track.sampleRate} Hz` : '',
      track.channels ? `${track.channels} ch` : '',
    ].filter(Boolean).join(', ');
  }
  return '';
}

function formatDuration(microseconds: number): string {
  const seconds = microseconds / 1_000_000;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  return minutes > 0 ? `${minutes}:${remainder.toFixed(3).padStart(6, '0')}` : `${remainder.toFixed(3)} s`;
}

function formatTimestamp(microseconds: number): string {
  return `${(microseconds / 1_000_000).toFixed(3)} s`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
