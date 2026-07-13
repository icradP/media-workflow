import type { LGraphCanvas } from 'litegraph.js';

let graphCanvas: LGraphCanvas | null = null;
let resizeFrame = 0;

export function bindGraphCanvas(canvas: LGraphCanvas): void {
  graphCanvas = canvas;

  const wrap = document.getElementById('canvas-wrap');
  if (!wrap) return;

  const observer = new ResizeObserver(() => {
    scheduleCanvasResize();
  });
  observer.observe(wrap);
  scheduleCanvasResize();
}

export function scheduleCanvasResize(): void {
  if (!graphCanvas) return;
  if (resizeFrame) cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = 0;
    graphCanvas?.resize();
  });
}
