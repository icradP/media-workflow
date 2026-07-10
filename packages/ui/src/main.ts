/**
 * Main entry — mount Media Workflow SPA
 */

import { createApp } from './app/app.js';
import './app/layout.js';
import './app/styles.css';

const storedTheme = localStorage.getItem('media-workflow-theme');
const preferredTheme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
document.documentElement.dataset.theme =
  storedTheme === 'light' || storedTheme === 'dark' ? storedTheme : preferredTheme;

const app = createApp();
app.mount().catch(err => {
  console.error('Failed to mount Media Workflow:', err);
  const status = document.getElementById('status-text');
  if (status) status.textContent = `Error: ${err}`;
});
