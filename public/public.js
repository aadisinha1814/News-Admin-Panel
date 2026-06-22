(function () {
  'use strict';

  // ─── Local State ──────────────────────────────────────────
  let articles = [];
  let currentSeverityFilter = 'all';
  let searchQuery = '';

  // ─── DOM References ───────────────────────────────────────
  const publicGrid = document.getElementById('publicGrid');
  const featuredContainer = document.getElementById('featuredArticleContainer');
  const searchInput = document.getElementById('publicSearchInput');
  const activeSignalsBadge = document.getElementById('activeSignalsBadge');
  const severityFilters = document.getElementById('severityFilters');
  const liveFeed = document.getElementById('live-feed');

  // ─── Initialize ───────────────────────────────────────────
  async function init() {
    setupEventListeners();
    await loadArticles();
    startLiveFeedTicker();
  }

  // ─── Data Loading ─────────────────────────────────────────
  async function loadArticles() {
    try {
      const res = await fetch('/api/public/articles');
      const data = await res.json();
      articles = data.articles || [];
      render();
    } catch (e) {
      publicGrid.innerHTML = `
        <div class="empty-state">
          <h3>Link Synchronization Failure</h3>
          <p>Could not retrieve intelligence nodes from main server.</p>
        </div>
      `;
    }
  }

  // ─── Filtering & Rendering ────────────────────────────────
  function render() {
    // 1. Filter articles based on state
    let filtered = articles;

    // Severity Filter
    if (currentSeverityFilter !== 'all') {
      if (currentSeverityFilter === 'medium-low') {
        filtered = filtered.filter(a => a.severity === 'medium' || a.severity === 'low');
      } else {
        filtered = filtered.filter(a => a.severity === currentSeverityFilter);
      }
    }

    // Search Filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(a =>
        a.title.toLowerCase().includes(query) ||
        (a.description && a.description.toLowerCase().includes(query)) ||
        a.source.toLowerCase().includes(query)
      );
    }

    // Update indicators
    activeSignalsBadge.textContent = `Approved Signals: ${filtered.length}`;

    if (filtered.length === 0) {
      featuredContainer.innerHTML = '';
      publicGrid.innerHTML = `
        <div class="empty-state" style="grid-column: 1/-1;">
          <h3>No Signals Registered</h3>
          <p>Try refining search query or severity tier.</p>
        </div>
      `;
      return;
    }

    // 2. Identify Featured Article (Most recent Critical or High article in the current filtered set)
    let featuredArticle = filtered.find(a => a.severity === 'critical' || a.severity === 'high');
    
    // If none, fallback to the very first item
    if (!featuredArticle) {
      featuredArticle = filtered[0];
    }

    // 3. Render Featured Article
    renderFeatured(featuredArticle);

    // 4. Render Grid Articles (All filtered items except the featured one)
    const gridArticles = filtered.filter(a => a.id !== featuredArticle.id);
    
    if (gridArticles.length === 0) {
      publicGrid.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; padding: 24px; color: var(--text-3); font-family: 'JetBrains Mono', monospace; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 2px;">
          End of Signal Feed
        </div>
      `;
    } else {
      publicGrid.innerHTML = gridArticles.map(a => createSecondaryCardHTML(a)).join('');
    }
  }

  function renderFeatured(a) {
    if (!a) {
      featuredContainer.innerHTML = '';
      return;
    }

    const badgeBg = hexToRgba(a.sourceColor || '#00daf3', 0.15);
    const badgeColor = a.sourceColor || '#00daf3';
    const dateStr = formatDate(a.published);

    featuredContainer.innerHTML = `
      <article class="featured-article-card" onclick="window.open('${a.link}', '_blank')">
        <div class="featured-image-container" style="background-image: url('https://lh3.googleusercontent.com/aida-public/AB6AXuDEpiOOpUJkcv4cxYTnPsXJblbfCvpwT5B7kRze8-aqOc2hGIYye10D4WhbnYpUplbLJXwk9PHD685pOug_1mCyoyLRiNR9ohh_x4YUdeftyXTw0LH0N24VBNiQuVOByVas4AnRVQMK6hOPnmyNW5VBneXlWEmh2Wq6x1-lYW1pxEdmmvX7tF7NIJzq_C1SBdc3JvyxcMMyunb9ueSzoP4jViyP0a0W8Bix5F05Dw1LFqp6DFJhKjfLcTe2n3YNi1eXpiYlV3WEd4qC')">
          <span class="featured-badge-overlay">${a.severity} Priority</span>
        </div>
        <div class="featured-content">
          <div class="featured-meta">
            <span class="source-badge" style="background:${badgeBg};color:${badgeColor}">
              ${a.sourceIcon || '📰'} ${a.source}
            </span>
            <span class="card-time">${dateStr}</span>
          </div>
          <h2 class="featured-title">
            <a href="${a.link}" target="_blank" onclick="event.stopPropagation()">${escapeHtml(a.title)}</a>
          </h2>
          <p class="featured-desc">
            ${escapeHtml(a.description || 'No summary text available. Click report link to analyze raw source code.')}
          </p>
          ${a.keyInsight ? `
          <div class="featured-insight">
            <div class="featured-insight-title">Actionable Key Insight</div>
            <div class="featured-insight-text">${escapeHtml(a.keyInsight)}</div>
          </div>` : ''}
        </div>
      </article>
    `;
  }

  function createSecondaryCardHTML(a) {
    const badgeBg = hexToRgba(a.sourceColor || '#00daf3', 0.15);
    const badgeColor = a.sourceColor || '#00daf3';
    const dateStr = formatDate(a.published);

    return `
      <a class="article-card" href="${a.link}" target="_blank" style="border-left: 3px solid ${a.severity === 'critical' ? 'var(--red)' : a.severity === 'high' ? 'var(--yellow)' : 'var(--cyan)'}; text-decoration: none;">
        <div class="card-content">
          <div class="card-meta">
            <span class="source-badge" style="background:${badgeBg};color:${badgeColor}">
              ${a.sourceIcon || '📰'} ${a.source}
            </span>
            <span class="card-time">${dateStr}</span>
            <span class="severity-badge ${a.severity}">${a.severity}</span>
          </div>
          <div class="card-title" style="margin-top: 8px;">
            <span style="text-decoration: none; color: var(--text-1); font-size: 1.05rem;">${escapeHtml(a.title)}</span>
          </div>
          ${a.description ? `<div class="card-desc" style="margin-top: 8px;">${escapeHtml(a.description)}</div>` : ''}
          
          ${a.keyInsight ? `
          <div class="key-insight-section">
            <div class="key-insight-header">Key Insight</div>
            <div class="key-insight-content">${escapeHtml(a.keyInsight)}</div>
          </div>` : ''}
        </div>
      </a>
    `;
  }

  // ─── Event Listeners ───────────────────────────────────────
  function setupEventListeners() {
    // Search input
    searchInput.addEventListener('input', () => {
      searchQuery = searchInput.value.trim();
      render();
    });

    // Sidebar filters
    severityFilters.querySelectorAll('.status-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        // Toggle active styling
        severityFilters.querySelectorAll('.status-tab').forEach(b => {
          b.classList.remove('active');
        });

        btn.classList.add('active');

        currentSeverityFilter = btn.dataset.severity;
        render();
      });
    });
  }

  // ─── Live Activity Log Simulation ──────────────────────────
  function startLiveFeedTicker() {
    const liveFeedTemplates = [
      "[INFO] Scanning worldwide subnets for abnormal entropy...",
      "[INFO] Connection established from SOC gateway.",
      "[TRACE] Analyzing network traffic anomaly on AS15169...",
      "[GEO] Encrypted trace initiated on endpoint cluster.",
      "[WARN] Multiple failed admin credentials registered from root nodes.",
      "[INFO] Signature verification pipeline 100% synchronized.",
      "[TRACE] Re-indexing unapproved CVE items in local schema...",
      "[INFO] Backup integrity check passed. 0 sectors corrupted."
    ];

    setInterval(() => {
      // Sometimes push a real article alert
      const rand = Math.random();
      let logMsg = '';
      let styleColor = '';

      if (rand > 0.6 && articles.length > 0) {
        const art = articles[Math.floor(Math.random() * articles.length)];
        const labels = { critical: '[CRIT]', high: '[WARN]', medium: '[INFO]', low: '[INFO]' };
        const label = labels[art.severity] || '[INFO]';
        logMsg = `${label} Approved article vector: ${art.title.substring(0, 50)}...`;
        
        if (art.severity === 'critical') styleColor = 'var(--red)';
        else if (art.severity === 'high') styleColor = 'var(--yellow)';
        else styleColor = 'var(--cyan)';
      } else {
        logMsg = liveFeedTemplates[Math.floor(Math.random() * liveFeedTemplates.length)];
        if (logMsg.includes('[WARN]')) styleColor = 'var(--yellow)';
        else if (logMsg.includes('[TRACE]')) styleColor = 'var(--cyan)';
        else styleColor = 'var(--text-2)';
      }

      const div = document.createElement('div');
      div.className = 'mono-feed-item';
      div.style.color = styleColor;
      div.textContent = logMsg;
      liveFeed.appendChild(div);

      // Scroll to bottom
      liveFeed.scrollTop = liveFeed.scrollHeight;

      // Restrict log lines length
      if (liveFeed.children.length > 25) {
        liveFeed.removeChild(liveFeed.children[0]);
      }
    }, 4500);
  }

  // ─── Helpers ──────────────────────────────────────────────
  function formatDate(dateStr) {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' UTC';
    } catch (e) {
      return dateStr;
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  // Helper function to convert hex to rgba
  function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16) || 0;
    const g = parseInt(hex.slice(3, 5), 16) || 0;
    const b = parseInt(hex.slice(5, 7), 16) || 0;
    return `rgba(${r},${g},${b},${alpha})`;
  }

  // Start init
  init();
})();
