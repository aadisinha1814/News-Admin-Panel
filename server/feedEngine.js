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

// ─── Concurrency Limiter ──────────────────────────────────────────
// Prevents all 11 RSS feeds firing simultaneously at startup.
// Processes sources in batches of CONCURRENCY_LIMIT at a time.
const CONCURRENCY_LIMIT = 3;

async function runWithConcurrencyLimit(tasks, limit) {
  const results = new Array(tasks.length);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < tasks.length) {
      // JS is single-threaded: nextIndex++ is atomic — no race condition possible
      const index = nextIndex++;
      const [result] = await Promise.allSettled([tasks[index]()]);
      results[index] = result; // placed at its original position — order preserved
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

// ─── Cybersecurity Keyword Filter ──────────────────────────────────────
// Used for sources like The420.in that mix cyber news with general content.
const CYBER_KEYWORDS = [
  // Core topics
  'cyber', 'hack', 'hacker', 'hacking', 'security', 'infosec',
  // Threats
  'malware', 'ransomware', 'spyware', 'trojan', 'virus', 'worm', 'botnet',
  'phishing', 'smishing', 'vishing', 'scam', 'fraud', 'social engineering',
  'apt', 'threat', 'attack', 'exploit', 'zero-day', 'zero day',
  // Vulnerabilities
  'vulnerability', 'cve', 'patch', 'flaw', 'bypass', 'rce',
  'remote code execution', 'privilege escalation', 'injection',
  // Incidents
  'breach', 'data leak', 'data theft', 'exfiltration', 'compromise',
  'ddos', 'denial of service', 'intrusion', 'incident',
  // Defence / tools
  'firewall', 'vpn', 'encryption', 'antivirus', 'endpoint',
  'siem', 'soc', 'penetration test', 'pentest', 'bug bounty',
  // Entities commonly covered
  'cert', 'nciipc', 'interpol', 'darkweb', 'dark web', 'tor',
  'cryptocurrency scam', 'crypto scam', 'deepfake', 'identity theft',
  'otp fraud', 'sim swap', 'cyber crime', 'cybercrime',
];

function isCyberRelated(title, description) {
  const text = ((title || '') + ' ' + (description || '')).toLowerCase();
  return CYBER_KEYWORDS.some(kw => text.includes(kw));
}

// ─── Source Configuration ──────────────────────────────────────────
// Sources are now dynamically managed by store.js

// ─── RSS Feed Parser ───────────────────────────────────────────────

async function fetchRSSFeed(source) {
  try {
    const feed = await parser.parseURL(source.feedUrl);
    let articles = feed.items.map(item => {
      const title = cleanText(item.title || 'Untitled');
      const description = cleanText(truncate(item.contentSnippet || item.content || '', 300));
      const generated = store.generateKeyInsightAndSeverity(title, description);
      return {
        id: uuidv4(),
        source: source.name,
        sourceIcon: source.icon,
        sourceColor: source.color,
        title,
        link: item.link || '',
        published: item.pubDate || item.isoDate || new Date().toISOString(),
        description,
        status: 'pending',
        severity: generated.severity,
        keyInsight: generated.keyInsight,
        fetchedAt: new Date().toISOString()
      };
    });

    // Apply cybersecurity keyword filter for sources that mix general news
    if (source.filterCyber) {
      const before = articles.length;
      articles = articles.filter(a => isCyberRelated(a.title, a.description));
      console.log(`  [FILTER] ${source.name}: kept ${articles.length}/${before} cyber-relevant articles`);
    }

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
        const cleanTitle = cleanText(title);
        const generated = store.generateKeyInsightAndSeverity(cleanTitle, '');
        articles.push({
          id: uuidv4(),
          source: source.name,
          sourceIcon: source.icon,
          sourceColor: source.color,
          title: cleanTitle,
          link: fullLink,
          published: new Date().toISOString(),
          description: '',
          status: 'pending',
          severity: generated.severity,
          keyInsight: generated.keyInsight,
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

// Note: scrapeForbesCyber() was removed — Forbes Cyber is configured as type 'rss'
// using a Google News RSS search URL which works perfectly as a standard RSS feed.

// ─── Master Fetch All ──────────────────────────────────────────────

async function fetchAllSources() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`[FETCH] Starting fetch cycle at ${new Date().toLocaleString()}`);
  console.log(`${'═'.repeat(60)}`);

  const sourcesList = store.readSources();

  // Build task functions (not promises) so concurrency limiter controls when they start
  const tasks = sourcesList.map(source => () => {
    switch (source.type) {
      case 'rss':               return fetchRSSFeed(source);
      case 'rss-with-fallback': return fetchRSSWithFallback(source);
      default:                  return fetchRSSFeed(source);
    }
  });

  // Run with at most CONCURRENCY_LIMIT concurrent requests
  const results = await runWithConcurrencyLimit(tasks, CONCURRENCY_LIMIT);

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
  const sources = store.readSources();
  // Read articles once and build a count map — avoids N+1 readArticles() calls
  const articles = store.readArticles();
  const countBySrc = articles.reduce((acc, a) => {
    acc[a.source] = (acc[a.source] || 0) + 1;
    return acc;
  }, {});

  return sources.map(s => ({
    name: s.name,
    icon: s.icon,
    color: s.color,
    type: s.type,
    feedUrl: s.feedUrl,
    siteUrl: s.siteUrl || null,
    total: countBySrc[s.name] || 0,
    new: s.stats?.new || 0
  }));
}

module.exports = {
  fetchAllSources,
  getSources
};
