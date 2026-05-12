const RSSParser = require('rss-parser');
const cheerio = require('cheerio');
const { v4: uuidv4 } = require('uuid');
const store = require('./store');

const parser = new RSSParser({
  timeout: 15000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Accept': 'application/rss+xml, application/xml, text/xml, */*'
  }
});

// ─── Source Configuration ──────────────────────────────────────────
// Sources are now dynamically managed by store.js

// ─── RSS Feed Parser ───────────────────────────────────────────────

async function fetchRSSFeed(source) {
  try {
    const feed = await parser.parseURL(source.feedUrl);
    const articles = feed.items.map(item => ({
      id: uuidv4(),
      source: source.name,
      sourceIcon: source.icon,
      sourceColor: source.color,
      title: cleanText(item.title || 'Untitled'),
      link: item.link || '',
      published: item.pubDate || item.isoDate || new Date().toISOString(),
      description: cleanText(truncate(item.contentSnippet || item.content || '', 300)),
      status: 'pending',
      fetchedAt: new Date().toISOString()
    }));
    return { success: true, source: source.name, articles, count: articles.length };
  } catch (error) {
    console.error(`[FEED ERROR] ${source.name}: ${error.message}`);
    return { success: false, source: source.name, articles: [], error: error.message };
  }
}

// ─── RSS with Fallback (FBI) ───────────────────────────────────────

async function fetchRSSWithFallback(source) {
  // Try RSS first
  const rssResult = await fetchRSSFeed(source);
  if (rssResult.success && rssResult.articles.length > 0) {
    return rssResult;
  }

  // Fallback: try scraping
  console.log(`[FALLBACK] ${source.name}: RSS failed, attempting scrape...`);
  try {
    const response = await fetchWithTimeout(source.siteUrl, 15000);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    const $ = cheerio.load(html);
    const articles = [];

    $('a').each((_, el) => {
      const $el = $(el);
      const title = $el.text().trim();
      const link = $el.attr('href');
      if (title && link && title.length > 20 && title.length < 300) {
        const fullLink = link.startsWith('http') ? link : `https://www.ic3.gov${link}`;
        articles.push({
          id: uuidv4(),
          source: source.name,
          sourceIcon: source.icon,
          sourceColor: source.color,
          title: cleanText(title),
          link: fullLink,
          published: new Date().toISOString(),
          description: '',
          status: 'pending',
          fetchedAt: new Date().toISOString()
        });
      }
    });

    // Deduplicate by link
    const seen = new Set();
    const unique = articles.filter(a => {
      if (seen.has(a.link)) return false;
      seen.add(a.link);
      return true;
    });

    return { success: unique.length > 0, source: source.name, articles: unique.slice(0, 20), count: unique.length };
  } catch (error) {
    console.error(`[SCRAPE ERROR] ${source.name}: ${error.message}`);
    return { success: false, source: source.name, articles: [], error: error.message };
  }
}

// ─── Forbes Scraper ────────────────────────────────────────────────

async function scrapeForbesCyber(source) {
  try {
    const response = await fetchWithTimeout(source.siteUrl, 15000);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    const $ = cheerio.load(html);
    const articles = [];

    // Forbes article cards typically have these selectors
    $('article a, .stream-item a, .card a, [class*="story"] a, [class*="article"] a').each((_, el) => {
      const $el = $(el);
      const title = $el.text().trim() || $el.attr('title') || '';
      let link = $el.attr('href') || '';

      if (title && title.length > 15 && title.length < 300 && link) {
        if (!link.startsWith('http')) {
          link = `https://www.forbes.com${link}`;
        }
        articles.push({
          id: uuidv4(),
          source: source.name,
          sourceIcon: source.icon,
          sourceColor: source.color,
          title: cleanText(title),
          link: link,
          published: new Date().toISOString(),
          description: '',
          status: 'pending',
          fetchedAt: new Date().toISOString()
        });
      }
    });

    // Deduplicate
    const seen = new Set();
    const unique = articles.filter(a => {
      if (seen.has(a.link)) return false;
      seen.add(a.link);
      return true;
    });

    return { success: unique.length > 0, source: source.name, articles: unique.slice(0, 20), count: unique.length };
  } catch (error) {
    console.error(`[SCRAPE ERROR] ${source.name}: ${error.message}`);
    return { success: false, source: source.name, articles: [], error: error.message };
  }
}

// ─── Master Fetch All ──────────────────────────────────────────────

async function fetchAllSources() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`[FETCH] Starting fetch cycle at ${new Date().toLocaleString()}`);
  console.log(`${'═'.repeat(60)}`);

  const sourcesList = store.readSources();
  const results = await Promise.allSettled(
    sourcesList.map(source => {
      switch (source.type) {
        case 'rss':
          return fetchRSSFeed(source);
        case 'rss-with-fallback':
          return fetchRSSWithFallback(source);
        case 'scrape':
          return scrapeForbesCyber(source);
        default:
          return fetchRSSFeed(source);
      }
    })
  );

  const summary = {
    timestamp: new Date().toISOString(),
    sources: [],
    totalArticles: 0,
    successCount: 0,
    failCount: 0
  };

  const allArticles = [];

  results.forEach((result, index) => {
    const sourceInfo = sourcesList[index];
    if (result.status === 'fulfilled' && result.value) {
      const r = result.value;
      summary.sources.push({
        name: r.source,
        success: r.success,
        count: r.articles.length,
        error: r.error || null
      });
      if (r.success) {
        summary.successCount++;
        summary.totalArticles += r.articles.length;
        allArticles.push(...r.articles);
      } else {
        summary.failCount++;
      }
      console.log(`  ${r.success ? '✓' : '✗'} ${r.source}: ${r.articles.length} articles${r.error ? ` (${r.error})` : ''}`);
    } else {
      summary.failCount++;
      summary.sources.push({
        name: sourceInfo.name,
        success: false,
        count: 0,
        error: result.reason?.message || 'Unknown error'
      });
      console.log(`  ✗ ${sourceInfo.name}: Promise rejected`);
    }
  });

  console.log(`\n[FETCH] Complete: ${summary.successCount}/${sourcesList.length} sources, ${summary.totalArticles} articles`);
  console.log(`${'═'.repeat(60)}\n`);

  return { articles: allArticles, summary };
}

// ─── Utility Functions ─────────────────────────────────────────────

function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(text, maxLength) {
  if (!text || text.length <= maxLength) return text;
  return text.substring(0, maxLength).replace(/\s+\S*$/, '') + '...';
}

async function fetchWithTimeout(url, timeout = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

function getSources() {
  return store.readSources().map(s => {
    const articles = store.readArticles();
    const total = articles.filter(a => a.source === s.name).length;
    return {
      name: s.name,
      icon: s.icon,
      color: s.color,
      type: s.type,
      feedUrl: s.feedUrl,
      siteUrl: s.siteUrl || null,
      total: total,
      new: s.stats?.new || 0
    };
  });
}

module.exports = {
  fetchAllSources,
  getSources
};
