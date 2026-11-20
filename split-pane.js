(function () {
  'use strict';
  const STORAGE_KEY = 'resume-studio-split-v1';
  const MOBILE_WIDTH = 720;
  const HANDLE_WIDTH = 8;
  const MIN_PANE_WIDTH = 260;

  function init({ workspace, splitter, scroll, fit, notify }) {
    let share = 0.5;
    let preferred = 0.5;
    let pointerId = null;
    let warned = false;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const value = Number(stored);
      if (stored !== null && Number.isFinite(value) && value >= 0.2 && value <= 0.8)
        preferred = value;
    } catch {
      /* A disabled storage API must not prevent resizing. */
    }

    function bounds() {
      const width = Math.max(1, workspace.clientWidth - HANDLE_WIDTH);
      const min = Math.max(0.2, Math.min(0.5, MIN_PANE_WIDTH / width));
      return [min, 1 - min];
    }
    function apply(value, remember = false) {
      const [min, max] = bounds();
      share = Math.min(max, Math.max(min, value));
      if (remember) {
        preferred = share;
        try {
          localStorage.setItem(STORAGE_KEY, String(preferred));
        } catch {
          if (!warned) notify('布局比例无法保存到本地');
          warned = true;
        }
      }
      workspace.style.setProperty('--editor-size', `${share}fr`);
      workspace.style.setProperty('--preview-size', `${1 - share}fr`);
      splitter.setAttribute('aria-valuemin', String(Math.round(min * 100)));
      splitter.setAttribute('aria-valuemax', String(Math.round(max * 100)));
      splitter.setAttribute('aria-valuenow', String(Math.round(share * 100)));
      splitter.setAttribute(
        'aria-valuetext',
        `编辑 ${Math.round(share * 100)}%，预览 ${Math.round((1 - share) * 100)}%`,
      );
    }
    function end(event) {
      if (event && event.pointerId !== undefined && event.pointerId !== pointerId) return;
      if (pointerId !== null && splitter.hasPointerCapture(pointerId))
        splitter.releasePointerCapture(pointerId);
      pointerId = null;
      document.body.classList.remove('resizing');
    }
    splitter.addEventListener('pointerdown', (event) => {
      if (
        event.button !== 0 ||
        !event.isPrimary ||
        pointerId !== null ||
        innerWidth <= MOBILE_WIDTH
      )
        return;
      event.preventDefault();
      pointerId = event.pointerId;
      splitter.setPointerCapture(pointerId);
      splitter.focus({ preventScroll: true });
      document.body.classList.add('resizing');
    });
    splitter.addEventListener('pointermove', (event) => {
      if (event.pointerId !== pointerId) return;
      const rect = workspace.getBoundingClientRect();
      apply((event.clientX - rect.left - HANDLE_WIDTH / 2) / (rect.width - HANDLE_WIDTH), true);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
      splitter.addEventListener(type, end);
    splitter.addEventListener('dblclick', () => apply(0.5, true));
    splitter.addEventListener('keydown', (event) => {
      const [min, max] = bounds();
      const next = {
        ArrowLeft: share - 0.02,
        ArrowRight: share + 0.02,
        Home: min,
        End: max,
        Enter: 0.5,
      }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      apply(next, true);
    });
    window.addEventListener('resize', () => {
      end();
      if (innerWidth > MOBILE_WIDTH) apply(preferred);
      fit();
    });
    const observer = new ResizeObserver(fit);
    observer.observe(scroll);
    apply(preferred);
  }
  window.ResumeSplit = Object.freeze({ init });
})();
