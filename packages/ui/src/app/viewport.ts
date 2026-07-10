import type {
  AudioMediaTrack,
  MediaAsset,
  MediaSample,
  MediaTrack,
  NodeExecutionEvent,
  VideoMediaTrack,
} from '@media-workflow/core';

type NodeRenderer = (event: NodeExecutionEvent, element: HTMLElement) => void;
const resultElements = new Map<string, HTMLElement>();

const renderers = new Map<string, NodeRenderer>([
  ['auto_analyze', renderAutoAnalyze],
  ['stream_overview', renderStreamOverview],
  ['track_detail', renderTrackDetailEvent],
  ['frame_table', renderSampleTableEvent],
  ['frame_selector', renderSampleTableEvent],
  ['hex_view', renderHexEvent],
]);

function viewportEl(): HTMLElement | null {
  return document.getElementById('viewport');
}

export function clearViewport(): void {
  const element = viewportEl();
  if (element) element.innerHTML = '';
  resultElements.clear();
}

export function renderExecutionEvent(event: NodeExecutionEvent): void {
  if (event.status === 'failed') return;
  const renderer = renderers.get(event.node.id);
  if (!renderer) return;
  const element = resultElementFor(event);
  if (element && renderer) renderer(event, element);
}

function resultElementFor(event: NodeExecutionEvent): HTMLElement | null {
  const viewport = viewportEl();
  if (!viewport) return null;

  const existing = resultElements.get(event.nodeId);
  if (existing) {
    const state = existing.parentElement?.querySelector<HTMLElement>('.result-card__state');
    if (state) state.textContent = event.cacheHit ? 'Cached' : `${event.durationMs.toFixed(1)} ms`;
    return existing;
  }

  const card = document.createElement('article');
  card.className = 'result-card';
  card.dataset.nodeId = event.nodeId;

  const header = document.createElement('header');
  header.className = 'result-card__header';
  const title = document.createElement('div');
  title.className = 'result-card__title';
  title.textContent = `${event.node.displayName} #${event.nodeId}`;
  const state = document.createElement('span');
  state.className = 'result-card__state';
  state.textContent = event.cacheHit ? 'Cached' : `${event.durationMs.toFixed(1)} ms`;
  header.append(title, state);

  const body = document.createElement('div');
  body.className = 'result-card__body';
  card.append(header, body);
  viewport.append(card);
  resultElements.set(event.nodeId, body);
  return body;
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
  const track = event.inputs.track as MediaTrack | undefined;
  if (track) renderTrackDetail(track, element);
}

function renderSampleTableEvent(event: NodeExecutionEvent, element: HTMLElement): void {
  const samples = event.outputs.samples as MediaSample[] | undefined;
  if (samples) renderSampleTable(samples, element);
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
