import { DEFAULTS } from './assets/ascii-tiles/options.mjs';

// Background failure must not interrupt the camera, tracking or video feed.
const host = document.getElementById('glass-background');
const canvas = document.getElementById('glass-tiles');
let renderer;
let retired = false;

async function start() {
  try {
    const { AsciiTilesRenderer } = await import('./assets/ascii-tiles/renderer.js');
    if (retired) return;
    renderer = new AsciiTilesRenderer(host, canvas, {
      ...DEFAULTS,
      opacity: 1,
      dpr: 1,
    }, message => {
      host.dataset.state = message ? 'unavailable' : 'ready';
    });
    await renderer.ready;
    host.dataset.state = 'ready';
  } catch (error) {
    host.dataset.state = 'unavailable';
    console.warn('Glass background unavailable; keeping the camera and feed active.', error);
  }
}

start();
addEventListener('feed-swipe', () => renderer?.liftTiles());
addEventListener('pagehide', () => {
  retired = true;
  renderer?.dispose();
  renderer = null;
});
addEventListener('pageshow', event => {
  if (event.persisted) { retired = false; start(); }
});
