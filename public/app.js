// ═══════════════════════════════════════════════════════════
//  Cyber News Pipeline — Frontend Application
// ═══════════════════════════════════════════════════════════

(function() {
  'use strict';

  // ─── State ──────────────────────────────────────────────
  let articles = [];
  let selectedIds = new Set();
  let currentSource = null;
  let currentStatus = 'pending';
  let searchQuery = '';
  let sources = [];

  // ─── DOM References ─────────────────────────────────────
  const $ = id => document.getElementById(id);
  const grid = $('articlesGrid');
  const loadingState = $('loadingState');
  const emptyState = $('emptyState');
  const searchInput = $('searchInput');
  const selectAll = $('selectAll');
  const bulkCount = $('bulkCount');
  const bulkApprove = $('bulkApprove');
  const bulkDiscard = $('bulkDiscard');
  const fetchBtn = $('fetchBtn');
  const fetchIndicator = $('fetchIndicator');
  const sourceList = $('sourceList');
  const statusTabs = $('statusTabs');
  const toastContainer = $('toastContainer');
  const userAvatarBtn = $('userAvatarBtn');
  const userDropdown = $('userDropdown');
  const logoutBtn = $('logoutBtn');

  // ─── Initialize ─────────────────────────────────────────
  async function init() {
    startClock();
    checkAuth();
    setupEventListeners();
    await loadSources();
    await loadArticles();
    await loadStats();
    // Auto-refresh every 5 minutes
    setInterval(() => { loadArticles(); loadStats(); }, 300000);
  }

  // ─── Auth ───────────────────────────────────────────────
  async function checkAuth() {
    try {
      const res = await fetch('/api/auth/check');
      const data = await res.json();
      if (!data.authenticated) {
        window.location.href = '/login.html';
        return;
      }
      if (data.user) {
        $('dropdownUsername').textContent = data.user.username;
      }
    } catch { window.location.href = '/login.html'; }
  }

  async function logout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {}
    window.location.href = '/login.html';
  }

  // ─── Data Loading ───────────────────────────────────────
  async function loadArticles() {
    try {
      const params = new URLSearchParams();
      if (currentSource) params.set('source', currentSource);
      if (currentStatus && currentStatus !== 'all') params.set('status', currentStatus);
      if (searchQuery) params.set('search', searchQuery);
      const res = await fetch(`/api/articles?${params}`);
      if (res.status === 401) return window.location.href = '/login.html';
      const data = await res.json();
      articles = data.articles || [];
      renderArticles();
    } catch (e) {
      console.error('Load failed:', e);
      showToast('Failed to load articles', 'error');
    }
  }

  async function loadStats() {
    try {
      const res = await fetch('/api/stats');
      if (res.status === 401) return;
      const data = await res.json();
      const s = data.stats;
      animateNumber($('statTotal'), s.total);
      animateNumber($('statPending'), s.pending);
      animateNumber($('statApproved'), s.approved);
      animateNumber($('statDiscarded'), s.discarded);
      // Update source metrics (Total | New)
      document.querySelectorAll('.source-count').forEach(el => {
        const name = el.dataset.source;
        const srcData = s.sources.find(x => x.name === name);
        if (srcData) {
          el.textContent = `${srcData.total} | ${srcData.new}`;
        }
      });
    } catch {}
  }

  async function loadSources() {
    try {
      const res = await fetch('/api/sources');
      if (res.status === 401) return;
      const data = await res.json();
      sources = data.sources || [];
      renderSources();
    } catch {}
  }

  // ─── Render Sources ─────────────────────────────────────
  function renderSources() {
    sourceList.innerHTML = sources.map(s => `
      <div class="source-item${currentSource === s.name ? ' active' : ''}" data-source="${s.name}">
        <span class="source-icon">${s.icon}</span>
        <span class="source-name">${s.name}</span>
        <span class="source-count" data-source="${s.name}">0 | 0</span>
      </div>
    `).join('');

    sourceList.querySelectorAll('.source-item').forEach(el => {
      el.addEventListener('click', () => {
        const name = el.dataset.source;
        currentSource = currentSource === name ? null : name;
        document.querySelectorAll('.source-item').forEach(e => e.classList.remove('active'));
        if (currentSource) el.classList.add('active');
        loadArticles();
      });
    });
  }

  // ─── Render Articles ────────────────────────────────────
  function renderArticles() {
    loadingState.style.display = 'none';
    if (articles.length === 0) {
      grid.innerHTML = '';
      emptyState.style.display = 'flex';
      return;
    }
    emptyState.style.display = 'none';
    grid.innerHTML = articles.map(a => createArticleCard(a)).join('');
    attachCardListeners();
    updateBulkUI();
  }

  function createArticleCard(a) {
    const time = timeAgo(a.published);
    const isSelected = selectedIds.has(a.id);
    const statusClass = `status-${a.status}`;
    const badgeBg = hexToRgba(a.sourceColor || '#00d4ff', 0.15);
    const badgeColor = a.sourceColor || '#00d4ff';

    return `
    <div class="article-card ${statusClass}${isSelected ? ' selected' : ''}" data-id="${a.id}">
      <label class="card-checkbox">
        <input type="checkbox" ${isSelected ? 'checked' : ''} data-id="${a.id}">
        <span class="custom-checkbox"></span>
      </label>
      <div class="card-content">
        <div class="card-meta">
          <span class="source-badge" style="background:${badgeBg};color:${badgeColor}">
            ${a.sourceIcon || '📰'} ${a.source}
          </span>
          <span class="card-time">${time}</span>
          <span class="card-status-badge ${a.status}">${a.status}</span>
        </div>
        <div class="card-title">
          <a href="${a.link}" target="_blank" rel="noopener">${escapeHtml(a.title)}</a>
        </div>
        ${a.description ? `<div class="card-desc">${escapeHtml(a.description)}</div>` : ''}
      </div>
      <div class="card-actions">
        ${a.status !== 'approved' ? `
          <button class="action-btn approve-btn" data-action="approve" data-id="${a.id}" title="Approve">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          </button>` : ''}
        ${a.status !== 'discarded' ? `
          <button class="action-btn discard-btn" data-action="discard" data-id="${a.id}" title="Discard">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>` : ''}
        ${a.status !== 'pending' ? `
          <button class="action-btn reset-btn" data-action="reset" data-id="${a.id}" title="Reset to Pending">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 105.64-11.36L1 10"/></svg>
          </button>` : ''}
      </div>
    </div>`;
  }

  function attachCardListeners() {
    // Checkboxes
    grid.querySelectorAll('.card-checkbox input').forEach(cb => {
      cb.addEventListener('change', () => {
        const id = cb.dataset.id;
        if (cb.checked) selectedIds.add(id); else selectedIds.delete(id);
        cb.closest('.article-card').classList.toggle('selected', cb.checked);
        updateBulkUI();
      });
    });
    // Action buttons
    grid.querySelectorAll('.action-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.action;
        const id = btn.dataset.id;
        await performAction(action, [id]);
      });
    });
  }

  // ─── Actions ────────────────────────────────────────────
  async function performAction(action, ids) {
    const endpoint = action === 'approve' ? '/api/articles/approve'
                   : action === 'discard' ? '/api/articles/discard'
                   : '/api/articles/reset';
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids })
      });
      if (res.status === 401) return window.location.href = '/login.html';
      const data = await res.json();
      if (data.success) {
        const label = action === 'approve' ? 'Approved' : action === 'discard' ? 'Discarded' : 'Reset';
        showToast(`${label} ${data.updated} article${data.updated !== 1 ? 's' : ''}`, 'success');
        selectedIds.clear();
        await loadArticles();
        await loadStats();
      }
    } catch (e) {
      showToast('Action failed: ' + e.message, 'error');
    }
  }

  async function triggerFetch() {
    fetchBtn.classList.add('spinning');
    fetchIndicator.classList.add('fetching');
    fetchIndicator.querySelector('span').textContent = 'Fetching...';
    showToast('Fetching articles from all sources...', 'info');
    try {
      const res = await fetch('/api/fetch', { method: 'POST' });
      if (res.status === 429) {
        showToast('Fetch already in progress', 'info');
        return;
      }
      const data = await res.json();
      if (data.success) {
        const s = data.summary;
        showToast(`Fetched ${s.added} new articles from ${s.successCount} sources`, 'success');
        await loadArticles();
        await loadStats();
      }
    } catch (e) {
      showToast('Fetch failed: ' + e.message, 'error');
    } finally {
      fetchBtn.classList.remove('spinning');
      fetchIndicator.classList.remove('fetching');
      fetchIndicator.querySelector('span').textContent = 'Idle';
    }
  }

  // ─── Event Listeners ───────────────────────────────────
  function setupEventListeners() {
    // Search
    let searchTimeout;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        searchQuery = searchInput.value.trim();
        loadArticles();
      }, 350);
    });

    // Select All
    selectAll.addEventListener('change', () => {
      const cards = grid.querySelectorAll('.card-checkbox input');
      cards.forEach(cb => {
        cb.checked = selectAll.checked;
        const id = cb.dataset.id;
        if (selectAll.checked) selectedIds.add(id); else selectedIds.delete(id);
        cb.closest('.article-card').classList.toggle('selected', selectAll.checked);
      });
      updateBulkUI();
    });

    // Bulk actions
    bulkApprove.addEventListener('click', () => performAction('approve', [...selectedIds]));
    bulkDiscard.addEventListener('click', () => performAction('discard', [...selectedIds]));

    // Fetch button
    fetchBtn.addEventListener('click', triggerFetch);

    // Status tabs
    statusTabs.querySelectorAll('.status-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        statusTabs.querySelectorAll('.status-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentStatus = tab.dataset.status;
        loadArticles();
      });
    });

    // Clear filters
    $('clearFilters').addEventListener('click', () => {
      currentSource = null;
      currentStatus = 'pending';
      searchQuery = '';
      searchInput.value = '';
      document.querySelectorAll('.source-item').forEach(e => e.classList.remove('active'));
      statusTabs.querySelectorAll('.status-tab').forEach(t => t.classList.remove('active'));
      statusTabs.querySelector('[data-status="pending"]').classList.add('active');
      loadArticles();
    });

    // User menu
    userAvatarBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      userDropdown.classList.toggle('open');
    });
    document.addEventListener('click', () => userDropdown.classList.remove('open'));
    logoutBtn.addEventListener('click', logout);

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === '/') { e.preventDefault(); searchInput.focus(); }
      if (e.key === 'r' || e.key === 'R') { e.preventDefault(); triggerFetch(); }
      if (e.key === 'Escape') {
        selectedIds.clear();
        selectAll.checked = false;
        grid.querySelectorAll('.article-card.selected').forEach(c => c.classList.remove('selected'));
        grid.querySelectorAll('.card-checkbox input').forEach(c => c.checked = false);
        updateBulkUI();
        searchInput.blur();
      }
    });
  }

  // ─── UI Helpers ─────────────────────────────────────────
  function updateBulkUI() {
    const count = selectedIds.size;
    bulkCount.textContent = `${count} selected`;
    bulkApprove.disabled = count === 0;
    bulkDiscard.disabled = count === 0;
    selectAll.checked = count > 0 && count === grid.querySelectorAll('.card-checkbox input').length;
  }

  function animateNumber(el, target) {
    const current = parseInt(el.textContent) || 0;
    if (current === target) return;
    const diff = target - current;
    const steps = Math.min(Math.abs(diff), 30);
    const step = diff / steps;
    let i = 0;
    const timer = setInterval(() => {
      i++;
      el.textContent = Math.round(current + step * i);
      if (i >= steps) { el.textContent = target; clearInterval(timer); }
    }, 20);
  }

  function showToast(message, type = 'info') {
    const icons = {
      success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
      error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
      info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
    };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `${icons[type] || icons.info}<span>${message}</span>`;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(20px)';
      toast.style.transition = 'all .3s';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  function startClock() {
    const clockEl = $('liveClock');
    function update() {
      const now = new Date();
      clockEl.textContent = now.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
    }
    update();
    setInterval(update, 1000);
  }

  function timeAgo(dateStr) {
    if (!dateStr) return '';
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const diff = Math.max(0, now - then);
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString('en-US', { month:'short', day:'numeric' });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1,3), 16) || 0;
    const g = parseInt(hex.slice(3,5), 16) || 0;
    const b = parseInt(hex.slice(5,7), 16) || 0;
    return `rgba(${r},${g},${b},${alpha})`;
  }

  // ─── Start ──────────────────────────────────────────────
  init();
})();
