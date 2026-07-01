(function () {
  'use strict';

  // ─── Local State ──────────────────────────────────────────
  let articles = [];
  let currentSeverityFilter = 'all';
  let searchQuery = '';

  // ─── Article Summary Modal ────────────────────────────────
  const ArticleModal = (function () {
    let overlay = null;

    function buildHTML(a) {
      const badgeBg  = hexToRgba(a.sourceColor || '#00d4ff', 0.18);
      const badgeClr = a.sourceColor || '#00d4ff';
      const dateStr  = formatDate(a.published);
      const sev      = a.severity || 'medium';

      const tagsHtml = (a.tags && a.tags.length)
        ? `<div class="article-modal-tags">${a.tags.map(t => `<span class="article-modal-tag">${escapeHtml(t)}</span>`).join('')}</div>`
        : '';

      const catsHtml = (a.categories && a.categories.length)
        ? `<div class="article-modal-categories">
             <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;flex-shrink:0"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
             ${escapeHtml(a.categories.join(' → '))}
           </div>`
        : '';

      // Summary section: always show loading skeleton initially;
      // open() will fill it in asynchronously once the fetch completes.
      const descHtml = `
        <div class="article-modal-section-label">Article Summary</div>
        <div class="article-modal-desc article-modal-loading" id="articleModalSummary"><span></span></div>`;

      const insightHtml = a.keyInsight
        ? `<div class="article-modal-insight">
             <div class="article-modal-insight-label">Analyst Assessment</div>
             <div class="article-modal-insight-text">${escapeHtml(a.keyInsight)}</div>
           </div>`
        : '';

      return `
        <div class="article-modal-overlay" id="articleModalOverlay" role="dialog" aria-modal="true" aria-label="Article Summary">
          <div class="article-modal">
            <div class="article-modal-accent ${sev}"></div>
            <div class="article-modal-header">
              <div class="article-modal-meta">
                <div class="article-modal-source-row">
                  <span class="article-modal-source-badge" style="background:${badgeBg};color:${badgeClr}">
                    ${a.sourceIcon || '📰'} ${escapeHtml(a.source)}
                  </span>
                  <span class="article-modal-severity ${sev}">${sev}</span>
                  <span class="article-modal-time">${dateStr}</span>
                </div>
                <div class="article-modal-title">${escapeHtml(a.title)}</div>
              </div>
              <button class="article-modal-close" id="articleModalClose" aria-label="Close">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:16px;height:16px">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
            <div class="article-modal-body">
              ${catsHtml}
              ${tagsHtml}
              ${descHtml}
              ${insightHtml}
            </div>
            <div class="article-modal-footer">
              <a class="article-modal-read-btn" href="${a.link}" target="_blank" rel="noopener noreferrer" id="articleModalReadBtn">
                Read Full Article
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:14px;height:14px">
                  <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
                </svg>
              </a>
              <button class="article-modal-dismiss" id="articleModalDismiss">Dismiss</button>
            </div>
          </div>
        </div>`;
    }

    function close() {
      if (!overlay) return;
      overlay.classList.add('closing');
      overlay.addEventListener('animationend', () => {
        overlay.remove();
        overlay = null;
      }, { once: true });
      document.removeEventListener('keydown', onKey);
    }

    function onKey(e) {
      if (e.key === 'Escape') close();
    }

    function open(article) {
      if (overlay) close();
      const wrapper = document.createElement('div');
      wrapper.innerHTML = buildHTML(article);
      overlay = wrapper.firstElementChild;
      document.body.appendChild(overlay);

      // Click outside the panel to close
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
      });
      document.getElementById('articleModalClose').addEventListener('click', close);
      document.getElementById('articleModalDismiss').addEventListener('click', close);
      document.addEventListener('keydown', onKey);

      // ─── Lazy-load article content ──────────────────────────
      const summaryEl = document.getElementById('articleModalSummary');
      if (summaryEl) {
        fetch('/api/public/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: article.link })
        })
        .then(r => r.json())
        .then(data => {
          if (!overlay || !overlay.isConnected) return;
          summaryEl.classList.remove('article-modal-loading');
          const text = data.preview || article.description;
          if (text) {
            summaryEl.textContent = text;
          } else {
            summaryEl.textContent = 'Full preview not available — click \'Read Full Article\' below.';
            summaryEl.style.color = 'var(--text-3)';
            summaryEl.style.fontStyle = 'italic';
          }
        })
        .catch(() => {
          if (!overlay || !overlay.isConnected) return;
          summaryEl.classList.remove('article-modal-loading');
          summaryEl.textContent = article.description || 'Preview unavailable — site may block automated access.';
          if (!article.description) {
            summaryEl.style.color = 'var(--text-3)';
            summaryEl.style.fontStyle = 'italic';
          }
        });
      }
    }

    return { open, close };
  })();

  // Expose to window for inline onclick handlers
  window._articleModalOpen = ArticleModal.open;

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
      // Wire click events — can't use inline onclick since articles[] lives in closure
      publicGrid.querySelectorAll('.article-card[data-article-id]').forEach(card => {
        card.addEventListener('click', () => {
          const id = card.dataset.articleId;
          const art = articles.find(x => x.id === id);
          if (art) ArticleModal.open(art);
        });
      });
    }
  }

  function renderFeatured(a) {
    if (!a) {
      featuredContainer.innerHTML = '';
      return;
    }

    window._featuredArticle = a;
    const badgeBg = hexToRgba(a.sourceColor || '#00daf3', 0.15);
    const badgeColor = a.sourceColor || '#00daf3';
    const dateStr = formatDate(a.published);

    featuredContainer.innerHTML = `
      <article class="featured-article-card" onclick="window._articleModalOpen(window._featuredArticle)" style="cursor:pointer">
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

          ${a.categories && a.categories.length > 0 ? `
          <div style="font-size: 0.75rem; color: var(--text-2); margin-top: 6px; display: flex; align-items: center; gap: 4px;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
            ${escapeHtml(a.categories.join(' → '))}
          </div>` : ''}
          
          ${a.tags && a.tags.length > 0 ? `
          <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px;">
            ${a.tags.map(t => `<span style="background: var(--cyan-dim); color: var(--cyan); padding: 3px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">${escapeHtml(t)}</span>`).join('')}
          </div>` : ''}

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
    const borderColor = a.severity === 'critical' ? 'var(--red)' : a.severity === 'high' ? 'var(--yellow)' : 'var(--cyan)';
    // Store article by id so the onclick can retrieve it
    const safeId = CSS.escape ? CSS.escape(a.id) : a.id;

    return `
      <div class="article-card" style="border-left: 3px solid ${borderColor}; cursor:pointer;" data-article-id="${escapeHtml(a.id)}">
        <div class="card-content">
          <div class="card-meta">
            <span class="source-badge" style="background:${badgeBg};color:${badgeColor}">
              ${a.sourceIcon || '📰'} ${a.source}
            </span>
            <span class="card-time">${dateStr}</span>
            <span class="severity-badge ${a.severity}">${a.severity}</span>
          </div>
          <div class="card-title" style="margin-top: 8px;">
            <span style="color: var(--text-1); font-size: 1.05rem;">${escapeHtml(a.title)}</span>
          </div>

          ${a.categories && a.categories.length > 0 ? `
          <div style="font-size: 0.7rem; color: var(--text-2); margin-top: 4px; display: flex; align-items: center; gap: 4px;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
            ${escapeHtml(a.categories.join(' → '))}
          </div>` : ''}
          
          ${a.tags && a.tags.length > 0 ? `
          <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px;">
            ${a.tags.map(t => `<span style="background: var(--cyan-dim); color: var(--cyan); padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; font-weight: 600;">${escapeHtml(t)}</span>`).join('')}
          </div>` : ''}

          ${a.description ? `<div class="card-desc" style="margin-top: 8px;">${escapeHtml(a.description)}</div>` : ''}
          
          ${a.keyInsight ? `
          <div class="key-insight-section">
            <div class="key-insight-header">Key Insight</div>
            <div class="key-insight-content">${escapeHtml(a.keyInsight)}</div>
          </div>` : ''}

          <div style="margin-top:10px; font-size:0.72rem; color:var(--cyan); opacity:0.7; display:flex; align-items:center; gap:5px;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:11px;height:11px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            Click to view summary
          </div>
        </div>
      </div>
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
