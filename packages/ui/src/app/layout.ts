/**
 * Layout initialization — handles canvas resize and global setup.
 */

export function initLayout() {
  const canvasWrap = document.getElementById('canvas-wrap');
  if (!canvasWrap) return;

  // Make canvas fill the container
  const resize = () => {
    const rect = canvasWrap.getBoundingClientRect();
    const canvas = canvasWrap.querySelector('canvas');
    if (canvas) {
      canvas.width = rect.width;
      canvas.height = rect.height;
    }
  };

  window.addEventListener('resize', resize);
  // Initial resize after mount
  setTimeout(resize, 100);
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', initLayout);
}
