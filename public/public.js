(function () {
  'use strict';

  async function init() {
    try {
      const res = await fetch('/api/public/articles');
      const data = await res.json();
      renderPublicArticles(data.articles || []);
    } catch (e) {
      document.getElementById('publicGrid').innerHTML = '<div class="empty-state"><h3>Failed to load intelligence feed.</h3></div>';
    }
  }

  function renderPublicArticles(articles) {
    const grid = document.getElementById('publicGrid');
    if (articles.length === 0) {
      grid.innerHTML = '<div class="empty-state"><h3>No approved intelligence found.</h3></div>';
      return;
    }

    grid.innerHTML = articles.map(a => {
      const badgeBg = hexToRgba(a.sourceColor || '#00d4ff', 0.15);
      const badgeColor = a.sourceColor || '#00d4ff';

      return `
      <a class="article-card" href="${a.link}" target="_blank" style="border-left: 3px solid var(--cyan)">
        <div class="card-content">
          <div class="card-meta">
            <span class="source-badge" style="background:${badgeBg};color:${badgeColor}">
              ${a.sourceIcon || '📰'} ${a.source}
            </span>
            <span class="card-time">${new Date(a.published).toLocaleString()}</span>
          </div>
          <div class="card-title">
            <span>${escapeHtml(a.title)}</span>
          </div>
          ${a.description ? `<div class="card-desc">${escapeHtml(a.description)}</div>` : ''}
        </div>
      </a>`;
    }).join('');
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

  init();
})();
