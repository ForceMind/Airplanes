/** Locally vendored modern combat, isolated from the WWII input/CSS/simulation. */
export function createModernHost(section) {
  const iframe = section.querySelector('iframe');
  const camera = section.querySelector('[data-modern="view"]');
  const pause = section.querySelector('[data-modern="pause"]');
  const status = section.querySelector('[role="status"]');
  let active = false, ready = false, paused = false, loadTimer;
  const labels = { top: '俯视', chase: '追尾', cockpit: '座舱' };
  function send(command) {
    if (active && ready) iframe.contentWindow?.postMessage({ type: 'airplanes:modern-command', command }, location.origin);
  }
  window.addEventListener('message', event => {
    if (!active || event.source !== iframe.contentWindow || event.origin !== location.origin || event.data?.type !== 'airplanes:modern-state') return;
    const { view } = event.data;
    if (!Object.hasOwn(labels, view)) return;
    ready = true; clearTimeout(loadTimer); status.hidden = true;
    camera.disabled = false; pause.disabled = false;
    paused = Boolean(event.data.paused);
    camera.textContent = `视角：${labels[view]}`;
    pause.textContent = paused ? '继续' : '暂停';
    section.dataset.view = view;
  });
  // A mouse/touch toolbar interaction must not steal the game's focus and
  // accidentally trigger its native blur-to-pause handler. Keyboard access stays available.
  for (const button of [camera, pause]) button.addEventListener('pointerdown', event => event.preventDefault());
  camera.addEventListener('click', () => send('view'));
  pause.addEventListener('click', () => send(paused ? 'resume' : 'pause'));
  iframe.addEventListener('load', () => { if (active) iframe.contentWindow?.focus(); });
  return {
    start() {
      if (active) return;
      active = true; ready = false; paused = false;
      section.hidden = false; camera.disabled = true; pause.disabled = true;
      status.hidden = false; status.textContent = '正在载入喷气空战…';
      const url = new URL('./modern/index.html', document.baseURI);
      url.searchParams.set('intro', 'false');
      // Start in the chase view shown by the user. Native Space / V / View still cycle all three.
      url.searchParams.set('view', 'chase');
      if (navigator.maxTouchPoints > 0 || matchMedia('(any-pointer: coarse)').matches) url.searchParams.set('touchControls', 'on');
      iframe.src = url.href;
      loadTimer = setTimeout(() => { if (active && !ready) status.textContent = '载入未完成。请返回版本入口后重试。'; }, 20000);
    },
    stop() {
      if (!active) return;
      send('pause'); active = false; ready = false; clearTimeout(loadTimer);
      // Navigating away destroys the child RAF, input listeners and audio contexts.
      iframe.src = 'about:blank'; section.hidden = true;
    },
    get active() { return active; },
  };
}
