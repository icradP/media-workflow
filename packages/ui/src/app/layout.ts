/**
 * Layout initialization — canvas sizing is handled by canvas_layout.ts.
 */

export function initLayout(): void {
  // Reserved for future global layout hooks.
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', initLayout);
}
