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
      const sev      = a.severity || 'medium';
      const dateStr  = formatDate(a.published);

      const tagsHtml = (a.tags && a.tags.length)
        ? `<div class="article-modal-tags">${a.tags.map(t => `<span class="article-modal-tag">${escapeHtml(t)}</span>`).join('')}</div>`
        : '';

      const catsHtml = (a.categories && a.categories.length)
        ? `<div class="article-modal-categories">
             <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;flex-shrink:0"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
             ${escapeHtml(a.categories.join(' → '))}
           </div>`
        : '';

      // Summary section: show shimmer skeleton, populate after fetch
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
        <div class="article-modal-overlay" id="articleModalOverlay" role="dialog" aria-modal="true">
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
              <a class="article-modal-read-btn" href="${a.link}" target="_blank" rel="noopener noreferrer">
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

      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
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
            summaryEl.textContent = 'Full preview not available — click "Read Full Article" below.';
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

  // Expose to window for inline onclick handlers (featured card)
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
    if (liveFeed) {
      startLiveFeedTicker();
    }
    await loadCyberWeather();
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

    // Identify Featured Article
    let featuredArticle = filtered.find(a => a.severity === 'critical' || a.severity === 'high');
    if (!featuredArticle) {
      featuredArticle = filtered[0];
    }

    // Render Featured Article
    renderFeatured(featuredArticle);

    // Render Grid Articles
    const gridArticles = filtered.filter(a => a.id !== featuredArticle.id);

    if (gridArticles.length === 0) {
      publicGrid.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; padding: 24px; color: var(--text-3); font-family: 'JetBrains Mono', monospace; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 2px;">
          End of Signal Feed
        </div>
      `;
    } else {
      publicGrid.innerHTML = gridArticles.map(a => createSecondaryCardHTML(a)).join('');

      // Wire click events on the newly rendered cards
      publicGrid.querySelectorAll('.article-card[data-article-id]').forEach(card => {
        card.addEventListener('click', () => {
          const id = card.dataset.articleId;
          const art = articles.find(x => x.id === id);
          if (art) ArticleModal.open(art);
        });
      });
    }
  }

  // ─── Tag Classification Helper ──────────────────────────────
  function getTagClass(tag) {
    const t = tag.toLowerCase();

    if (t.includes('zero-day') || t.includes('critical') || t.includes('patch immediately') || t.includes('active exploit')) {
      return 'tag-critical';
    }
    if (t.includes('ransomware') || t.includes('malware') || t.includes('high impact') || t.includes('financial loss') || t.includes('backdoor')) {
      return 'tag-high';
    }
    if (t.includes('vulnerability') || t.includes('data exposure') || t.includes('cve')) {
      return 'tag-vulnerability';
    }
    if (t.includes('phishing') || t.includes('scam') || t.includes('user targeting') || t.includes('social')) {
      return 'tag-medium';
    }
    if (t.includes('industry news') || t.includes('low priority') || t.includes('routine')) {
      return 'tag-low';
    }
    if (t.startsWith('[') && (t.includes('cisco') || t.includes('microsoft') || t.includes('apple') || t.includes('google') || t.includes('okta') || t.includes('fortinet') || t.includes('palo alto') || t.includes('vmware') || t.includes('crowdstrike'))) {
      return 'tag-vendor';
    }
    return 'tag-medium';
  }

  function cleanTagText(tag) {
    return tag.replace(/^\[|\]$/g, '');
  }

  function renderTagPills(tags, containerClass) {
    if (!tags || tags.length === 0) return '';
    return `
      <div class="${containerClass}">
        ${tags.map(t => `<span class="tag-pill ${getTagClass(t)}">${escapeHtml(cleanTagText(t))}</span>`).join('')}
      </div>
    `;
  }

  // ─── Featured Article Renderer ──────────────────────────────
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
            <span style="color: var(--text-1); text-decoration: none;">${escapeHtml(a.title)}</span>
          </h2>
          ${renderTagPills(a.tags, 'featured-tags')}
          <p class="featured-desc">
            ${escapeHtml(a.description || 'No summary text available. Click to view full article.')}
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

  // ─── Secondary Card Renderer ────────────────────────────────
  function createSecondaryCardHTML(a) {
    const badgeBg = hexToRgba(a.sourceColor || '#00daf3', 0.15);
    const badgeColor = a.sourceColor || '#00daf3';
    const dateStr = formatDate(a.published);
    const borderColor = a.severity === 'critical' ? 'var(--red)' : a.severity === 'high' ? 'var(--yellow)' : 'var(--cyan)';

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
          ${renderTagPills(a.tags, 'card-tags')}
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

      liveFeed.scrollTop = liveFeed.scrollHeight;

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

  function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16) || 0;
    const g = parseInt(hex.slice(3, 5), 16) || 0;
    const b = parseInt(hex.slice(5, 7), 16) || 0;
    return `rgba(${r},${g},${b},${alpha})`;
  }

  // ─── Cyber Weather & Analytics ─────────────────────────────
  async function loadCyberWeather() {
  try {
    const res = await fetch('/api/cyber-weather');
    const data = await res.json();
    
    // Update weather widget
    const weatherIcon = document.getElementById('weatherIcon');
    const weatherScore = document.getElementById('weatherScore');
    const weatherDescription = document.getElementById('weatherDescription');
    
    if (weatherIcon) weatherIcon.textContent = data.weatherIcon || '☁️';
    if (weatherScore) weatherScore.textContent = data.score || '0.0';
    if (weatherDescription) weatherDescription.textContent = data.weatherDescription || 'Loading threat intelligence...';
    
    // Update top threats list
    const topThreatsList = document.getElementById('topThreatsList');
    if (topThreatsList) {
      if (data.topThreats && data.topThreats.length > 0) {
        topThreatsList.innerHTML = data.topThreats.map(threat => `
          <li>
            <a href="${threat.link}" target="_blank" class="threat-link">
              ${escapeHtml(threat.title)}
            </a>
            <span class="threat-severity-score">(${threat.severityScore})</span>
          </li>
        `).join('');
      } else {
        topThreatsList.innerHTML = '<li class="no-threats">No critical threats today</li>';
      }
    }
    
    // Render pie chart if function exists
    if (typeof renderPieChart === 'function') {
      renderPieChart(data.weeklyBreakdown);
    }
    
    // Update sectors list
    const sectorsList = document.getElementById('sectorsList');
    if (sectorsList) {
      if (data.mostAffectedSectors && data.mostAffectedSectors.length > 0) {
        sectorsList.innerHTML = data.mostAffectedSectors.map(s => `
          <li>• ${escapeHtml(s.sector)} (${s.count})</li>
        `).join('');
      } else {
        sectorsList.innerHTML = '<li class="no-data">No recent sector data</li>';
      }
    }
  } catch (error) {
    console.error('Failed to load cyber weather:', error);
    const weatherDescription = document.getElementById('weatherDescription');
    if (weatherDescription) {
      weatherDescription.textContent = 'Failed to load threat intelligence.';
    }
    const topThreatsList = document.getElementById('topThreatsList');
    if (topThreatsList) {
      topThreatsList.innerHTML = '<li class="no-threats">Unable to load threats</li>';
    }
    const sectorsList = document.getElementById('sectorsList');
    if (sectorsList) {
      sectorsList.innerHTML = '<li class="no-data">Unable to load sectors</li>';
    }
  }
}

  function renderPieChart(breakdown) {
    const svg = document.getElementById('threatPieChart');
    const legend = document.getElementById('pieChartLegend');

    if (!breakdown || breakdown.length === 0) {
      svg.innerHTML = '<text x="100" y="100" text-anchor="middle" fill="var(--text-3)" font-size="12">No data</text>';
      legend.innerHTML = '';
      return;
    }

    const colors = ['#00d4ff', '#00ff88', '#ffa502', '#ff4757', '#6c5ce7', '#e84393'];
    const total = breakdown.reduce((sum, item) => sum + item.count, 0);
    let currentAngle = 0;
    const centerX = 100;
    const centerY = 100;
    const radius = 80;

    let svgContent = '';
    let legendContent = '';

    breakdown.forEach((item, index) => {
      const percentage = (item.count / total) * 100;
      const angle = (item.count / total) * 360;
      const color = colors[index % colors.length];

      const startAngle = currentAngle;
      const endAngle = currentAngle + angle;

      const startRad = (startAngle - 90) * Math.PI / 180;
      const endRad = (endAngle - 90) * Math.PI / 180;

      const x1 = centerX + radius * Math.cos(startRad);
      const y1 = centerY + radius * Math.sin(startRad);
      const x2 = centerX + radius * Math.cos(endRad);
      const y2 = centerY + radius * Math.sin(endRad);

      const largeArcFlag = angle > 180 ? 1 : 0;

      const pathData = `
        M ${centerX} ${centerY}
        L ${x1} ${y1}
        A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2} ${y2}
        Z
      `;

      svgContent += `<path d="${pathData}" fill="${color}" stroke="var(--bg-deep)" stroke-width="2" class="pie-slice" data-category="${item.category}" data-percentage="${percentage.toFixed(0)}%"/>`;

      legendContent += `
        <div class="legend-item">
          <span class="legend-color" style="background: ${color}"></span>
          <span class="legend-label">${item.category}</span>
          <span class="legend-percentage">${percentage.toFixed(0)}%</span>
        </div>
      `;

      currentAngle += angle;
    });

    svgContent += `<circle cx="${centerX}" cy="${centerY}" r="40" fill="var(--bg-surface)"/>`;
    svgContent += `<text x="${centerX}" y="${centerY - 5}" text-anchor="middle" fill="var(--text-1)" font-size="14" font-weight="bold">${total}</text>`;
    svgContent += `<text x="${centerX}" y="${centerY + 12}" text-anchor="middle" fill="var(--text-3)" font-size="10">articles</text>`;

    svg.innerHTML = svgContent;
    legend.innerHTML = legendContent;

    svg.querySelectorAll('.pie-slice').forEach(slice => {
      slice.addEventListener('mouseenter', () => {
        slice.style.opacity = '0.8';
        slice.style.cursor = 'pointer';
      });
      slice.addEventListener('mouseleave', () => {
        slice.style.opacity = '1';
      });
    });
  }

  // Start init
  init();
})();