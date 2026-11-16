/* Local adapter only: the combat implementation is the captured upstream v9. */
(() => {
  'use strict';
  const embedded = window.parent !== window;
  const origin = location.origin;
  const notify = () => {
    if (!embedded || typeof window.__view !== 'function') return;
    const state = window.__game?.();
    parent.postMessage({ type: 'airplanes:modern-state', view: window.__view(),
      paused: Boolean(window.__paused?.()), started: Boolean(state?.started),
      dead: Boolean(state?.dead), wave: state?.wave ?? 0 }, origin);
  };
  window.addEventListener('message', event => {
    if (!embedded || event.source !== parent || event.origin !== origin) return;
    const data = event.data;
    if (!data || data.type !== 'airplanes:modern-command') return;
    if (data.command === 'view') window.__airplanesCycleView?.();
    else if (data.command === 'pause') window.__togglePause?.(true);
    else if (data.command === 'resume') window.__togglePause?.(false);
    else if (data.command !== 'focus') return;
    document.querySelector('#root [tabindex="0"]')?.focus({ preventScroll: true });
    notify();
  });
  const timer = setInterval(notify, 250);
  window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
  notify();
})();
