// ClipStack - Popup Script

const MAX = 200;
let allClips = [];
let searchQuery = '';

// ── Utilities ──────────────────────────────────────────────────────────────
function timeAgo(ts) {
  const diff = Date.now() - ts;
  if (diff < 5000)   return 'just now';
  if (diff < 60000)  return Math.floor(diff / 1000) + 's ago';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  return Math.floor(diff / 86400000) + 'd ago';
}

function detectType(text) {
  if (/^https?:\/\//i.test(text)) return '🔗 URL';
  if (/^[\w.+-]+@[\w-]+\.\w+$/.test(text)) return '✉️ Email';
  if (/^\d[\d\s\-().+]{6,}$/.test(text)) return '📞 Phone';
  if (text.split('\n').length > 2) return '📄 Multi-line';
  if (text.length > 120) return '📝 Long text';
  return null;
}

function escape(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function highlight(text, query) {
  if (!query) return escape(text);
  const escaped = escape(text);
  const escapedQ = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escaped.replace(new RegExp(escapedQ, 'gi'), m => `<mark>${m}</mark>`);
}

// ── Toast ──────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg = 'Copied!') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
}

// ── Copy to clipboard ──────────────────────────────────────────────────────
function copyText(text, btnEl) {
  navigator.clipboard.writeText(text).then(() => {
    showToast('Copied to clipboard!');
    if (btnEl) {
      btnEl.classList.add('copied');
      btnEl.textContent = '✓';
      setTimeout(() => {
        btnEl.classList.remove('copied');
        btnEl.textContent = '⧉';
      }, 1500);
    }
  });
}

// ── Delete item ────────────────────────────────────────────────────────────
function deleteItem(id) {
  chrome.storage.local.get({ history: [] }, ({ history }) => {
    const updated = history.filter(i => i.id !== id);
    chrome.storage.local.set({ history: updated }, () => {
      allClips = updated;
      renderList();
    });
  });
}

// ── Render ─────────────────────────────────────────────────────────────────
function renderList() {
  const wrap = document.getElementById('list-wrap');
  const countEl = document.getElementById('count');
  const footerCount = document.getElementById('footer-count');

  const filtered = searchQuery
    ? allClips.filter(c => c.text.toLowerCase().includes(searchQuery.toLowerCase()))
    : allClips;

  countEl.textContent = `${allClips.length} / ${MAX}`;

  if (allClips.length === 0) {
    wrap.innerHTML = `
      <div class="empty">
        <div class="empty-icon">📋</div>
        <div class="empty-title">No clips yet</div>
        <div class="empty-sub">Select text anywhere and press <strong>Ctrl+C</strong><br>to start building your history.</div>
      </div>`;
    footerCount.textContent = '';
    return;
  }

  if (filtered.length === 0) {
    wrap.innerHTML = `<div class="no-results">No clips match "<strong>${escape(searchQuery)}</strong>"</div>`;
    footerCount.textContent = '';
    return;
  }

  footerCount.textContent = searchQuery ? `${filtered.length} result${filtered.length !== 1 ? 's' : ''}` : '';

  wrap.innerHTML = filtered.map(item => {
    const type = detectType(item.text);
    return `
      <div class="clip-item" data-id="${item.id}" data-text="${encodeURIComponent(item.text)}">
        <div class="clip-body" data-action="copy">
          <div class="clip-text">${highlight(item.text, searchQuery)}</div>
          <div class="clip-meta">
            <span class="clip-time">${timeAgo(item.ts)}</span>
            <span class="clip-len">${item.text.length} chars</span>
            ${type ? `<span class="clip-type">${type}</span>` : ''}
          </div>
        </div>
        <div class="clip-actions">
          <button class="btn-icon" title="Copy" data-action="copy">⧉</button>
          <button class="btn-icon del" title="Delete" data-action="delete">✕</button>
        </div>
      </div>`;
  }).join('');

  // Attach events
  wrap.querySelectorAll('.clip-item').forEach(el => {
    const text = decodeURIComponent(el.dataset.text);
    const id = el.dataset.id;

    el.querySelectorAll('[data-action="copy"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const iconBtn = el.querySelector('button[data-action="copy"]');
        copyText(text, iconBtn);
      });
    });

    el.querySelector('[data-action="delete"]').addEventListener('click', (e) => {
      e.stopPropagation();
      el.style.opacity = '0.4';
      deleteItem(id);
    });
  });
}

// ── Load & auto-refresh ────────────────────────────────────────────────────
function load() {
  chrome.storage.local.get({ history: [] }, ({ history }) => {
    allClips = history;
    renderList();
  });
}

// ── Search ─────────────────────────────────────────────────────────────────
document.getElementById('searchInput').addEventListener('input', (e) => {
  searchQuery = e.target.value.trim();
  renderList();
});

// ── Clear all ──────────────────────────────────────────────────────────────
document.getElementById('clearBtn').addEventListener('click', () => {
  if (allClips.length === 0) return;
  chrome.storage.local.set({ history: [] }, () => {
    allClips = [];
    renderList();
    showToast('History cleared!');
  });
});

// ── Storage change listener (live updates) ─────────────────────────────────
chrome.storage.onChanged.addListener((changes) => {
  if (changes.history) {
    allClips = changes.history.newValue || [];
    renderList();
  }
});

// ── Init ───────────────────────────────────────────────────────────────────
load();
