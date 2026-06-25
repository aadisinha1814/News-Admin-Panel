(function () {
  'use strict';

  // Load articles
  async function init() {
    try {
      const res = await fetch('/api/public/articles');
      const data = await res.json();
      renderPublicArticles(data.articles || []);
    } catch (e) {
      document.getElementById('publicGrid').innerHTML = '<div class="empty-state"><h3>Failed to load intelligence feed.</h3></div>';
    }
  }

  // Render Articles
  function renderPublicArticles(articles) {
  const grid = document.getElementById('publicGrid');
  if (articles.length === 0) {
    grid.innerHTML = '<div class="empty-state"><h3>No approved intelligence found.</h3></div>';
    return;
  }
  grid.innerHTML = articles.map(a => {
        // Generate Tag HTML
        const tagsHtml = (a.tags && a.tags.length > 0) 
            ? a.tags.map(tag => `
                <span class="tag-pill" data-category="${tag.category.toLowerCase().replace(/\s+/g, '-')}">
                    ${tag.name}
                </span>
              `).join('') 
            : '';

        return `
        <div class="article-card" data-link="${a.link}">
            <div class="card-content">
                <div class="card-meta">
                    <span class="source-badge">${a.sourceIcon || '📰'} ${a.source}</span>
                    <span class="card-time">${new Date(a.published).toLocaleString()}</span>
                </div>
                <div class="card-title">
                    <a href="${a.link}" target="_blank" rel="noopener">${escapeHtml(a.title)}</a>
                </div>
                
                <!-- Use 'content' instead of 'description' now -->
                ${a.content ? `<div class="card-desc">${escapeHtml(a.content)}</div>` : ''}
                
                <!-- TAGS SECTION -->
                ${tagsHtml ? `<div class="card-tags">${tagsHtml}</div>` : ''}
            </div>
        </div>`;
  }).join('');

  // Add click handler to cards (but not to links inside them)
  grid.querySelectorAll('.article-card').forEach(card => {
    card.addEventListener('click', (e) => {
      // Don't navigate if clicking on a link inside the card
      if (e.target.closest('a')) return;
      
      const link = card.dataset.link;
      if (link) {
        window.open(link, '_blank', 'noopener,noreferrer');
      }
    });
  });
}

  // Secure
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
