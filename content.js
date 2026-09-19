// ClipStack - Content Script
// Captures copied text from page selections, form fields, and programmatic
// clipboard writes, then forwards it to the background service worker.

(() => {
  // Guard against double-injection (SPA navigations, re-injection on update).
  if (window.__clipstackInstalled) return;
  window.__clipstackInstalled = true;

  const MAX_LEN = 100000;

  // Copying the same text twice in a row fires multiple events on some sites
  // (e.g. a copy button that also triggers a selection copy). Collapse those.
  let lastText = '';
  let lastSentAt = 0;

  function send(text, source) {
    if (typeof text !== 'string') return;
    const trimmed = text.trim();
    if (!trimmed) return;
    if (trimmed.length > MAX_LEN) return;

    const now = Date.now();
    if (trimmed === lastText && now - lastSentAt < 1000) return;
    lastText = trimmed;
    lastSentAt = now;

    try {
      chrome.runtime.sendMessage(
        { type: 'NEW_COPY', text: trimmed, source, url: location.href },
        // Swallow "Extension context invalidated" after a reload/update.
        () => void chrome.runtime.lastError
      );
    } catch (_) {
      /* Extension was reloaded; the next copy will re-establish the port. */
    }
  }

  // ── 1. Selection copies, including inside <input> / <textarea> ────────────
  // window.getSelection() returns empty for text selected inside form fields,
  // which is why those copies were previously dropped entirely.
  function readCopiedText(e) {
    // Sites that build their own payload put it on the event's clipboardData.
    const injected = e.clipboardData && e.clipboardData.getData('text/plain');
    if (injected) return injected;

    const el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
      const { selectionStart: s, selectionEnd: end, value } = el;
      if (typeof s === 'number' && typeof end === 'number' && end > s) {
        return value.slice(s, end);
      }
    }

    return window.getSelection()?.toString() || '';
  }

  document.addEventListener(
    'copy',
    (e) => {
      // The event fires BEFORE the site may overwrite clipboardData, so read
      // again on the next tick to catch sites that rewrite the payload.
      const immediate = readCopiedText(e);
      setTimeout(() => send(immediate, 'copy'), 0);
    },
    true // capture phase: run before a page handler can stopPropagation()
  );

  document.addEventListener('cut', (e) => send(readCopiedText(e), 'cut'), true);

  // ── 2. Programmatic copies relayed from the MAIN-world hook ───────────────
  window.addEventListener('message', (e) => {
    // Only trust messages from this same frame; any page can postMessage.
    if (e.source !== window) return;
    const data = e.data;
    if (!data || data.__clipstack !== true) return;
    send(data.text, 'programmatic');
  });
})();
