// Copied Clipboard - Background Service Worker
// Receives copy events and maintains history in chrome.storage.local.

const MAX_ITEMS = 200;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Every write is a read-modify-write on one storage key. Running two at once
// makes the second overwrite the first, which silently ate copies made in
// quick succession. Chaining them serializes all mutations.
let writeQueue = Promise.resolve();

function enqueue(mutate) {
  const next = writeQueue.then(mutate).catch((err) => {
    console.error('[Copied Clipboard] write failed:', err);
  });
  writeQueue = next;
  return next;
}

function prune(history, now) {
  return history
    .filter((item) => item.pinned || now - item.ts < MAX_AGE_MS)
    .slice(0, MAX_ITEMS);
}

async function addClip({ text, source, url }) {
  const { history = [] } = await chrome.storage.local.get({ history: [] });
  const now = Date.now();

  // Re-copying an existing clip moves it back to the top rather than
  // creating a duplicate. Preserve its pinned state when it does.
  const existing = history.find((item) => item.text === text);
  const rest = history.filter((item) => item.text !== text);

  const entry = {
    text,
    ts: now,
    id: existing?.id ?? `${now}-${Math.random().toString(36).slice(2, 10)}`,
    pinned: existing?.pinned ?? false,
    source: source || 'copy',
    origin: safeOrigin(url)
  };

  await chrome.storage.local.set({ history: prune([entry, ...rest], now) });
}

function safeOrigin(url) {
  try {
    return new URL(url).hostname;
  } catch (_) {
    return '';
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'NEW_COPY' || typeof msg.text !== 'string' || !msg.text) {
    return false;
  }

  // Returning true keeps the message channel (and this service worker) alive
  // until sendResponse fires, so the worker cannot be torn down mid-write.
  enqueue(() => addClip({ text: msg.text, source: msg.source, url: msg.url }))
    .then(() => sendResponse({ ok: true }))
    .catch(() => sendResponse({ ok: false }));
  return true;
});

// Sweep expired items on startup so old clips do not linger just because
// nothing has been copied recently.
chrome.runtime.onStartup.addListener(() => {
  enqueue(async () => {
    const { history = [] } = await chrome.storage.local.get({ history: [] });
    const pruned = prune(history, Date.now());
    if (pruned.length !== history.length) {
      await chrome.storage.local.set({ history: pruned });
    }
  });
});

// ── Inject into already-open tabs ──────────────────────────────────────────
// Content scripts declared in the manifest are only injected into pages loaded
// AFTER the extension starts. Every tab already open when the extension is
// installed, updated, or reloaded has no content script and silently stops
// recording copies, with no error and no visible sign. Re-inject explicitly so
// existing tabs keep working.

async function injectIntoOpenTabs() {
  let tabs;
  try {
    tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  } catch (err) {
    console.error('[Copied Clipboard] tab query failed:', err);
    return;
  }

  for (const tab of tabs) {
    if (!tab.id) continue;

    // The MAIN-world hook must be injected before the isolated-world script,
    // matching the order the manifest declares them in.
    for (const [file, world] of [['page-hook.js', 'MAIN'], ['content.js', 'ISOLATED']]) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: true },
          files: [file],
          world,
          injectImmediately: true
        });
      } catch (_) {
        // Expected on restricted pages (chrome://, the Web Store, the PDF
        // viewer) and on tabs that closed mid-loop. Both scripts guard against
        // double-injection, so re-running on an already-injected tab is safe.
      }
    }
  }
}

chrome.runtime.onInstalled.addListener(injectIntoOpenTabs);
chrome.runtime.onStartup.addListener(injectIntoOpenTabs);
