// Copied Clipboard - Page-context hook (MAIN world)
// Content scripts run in an isolated world and cannot observe the page's own
// navigator.clipboard.writeText() calls. Those are how most "Copy" buttons
// work (copy link, copy API key, copy 2FA code) and they often fire no copy
// event at all, so they were silently missing from history.

(() => {
  if (window.__copiedHooked) return;
  window.__copiedHooked = true;

  function report(text) {
    if (typeof text !== 'string' || !text.trim()) return;
    window.postMessage({ __copied: true, text }, '*');
  }

  const clip = navigator.clipboard;
  if (clip && typeof clip.writeText === 'function') {
    const originalWriteText = clip.writeText.bind(clip);
    clip.writeText = function (text) {
      // Report only on success, so a rejected write never enters history.
      return originalWriteText(text).then(
        (result) => {
          report(text);
          return result;
        },
        (err) => {
          throw err;
        }
      );
    };
  }

  if (clip && typeof clip.write === 'function') {
    const originalWrite = clip.write.bind(clip);
    clip.write = function (items) {
      return originalWrite(items).then(async (result) => {
        try {
          for (const item of items || []) {
            if (item.types && item.types.includes('text/plain')) {
              report(await (await item.getType('text/plain')).text());
            }
          }
        } catch (_) {
          /* Best effort only; never break the page's own clipboard write. */
        }
        return result;
      });
    };
  }

  // execCommand('copy') is the legacy path still used by older copy buttons.
  const originalExec = document.execCommand;
  document.execCommand = function (command, ...rest) {
    const result = originalExec.call(this, command, ...rest);
    if (result && String(command).toLowerCase() === 'copy') {
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
        const { selectionStart: s, selectionEnd: e, value } = el;
        if (typeof s === 'number' && typeof e === 'number' && e > s) {
          report(value.slice(s, e));
        }
      } else {
        report(window.getSelection()?.toString() || '');
      }
    }
    return result;
  };
})();
