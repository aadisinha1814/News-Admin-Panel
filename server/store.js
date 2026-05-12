const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const ARTICLES_FILE = path.join(DATA_DIR, 'articles.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SOURCES_FILE = path.join(DATA_DIR, 'sources.json');

// Ensure data directory exists
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// ─── Articles Store ────────────────────────────────────────────────

function readArticles() {
  ensureDataDir();
  if (!fs.existsSync(ARTICLES_FILE)) {
    fs.writeFileSync(ARTICLES_FILE, JSON.stringify([], null, 2));
    return [];
  }
  try {
    const data = fs.readFileSync(ARTICLES_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function writeArticles(articles) {
  ensureDataDir();
  fs.writeFileSync(ARTICLES_FILE, JSON.stringify(articles, null, 2));
}

function addArticles(newArticles) {
  const existing = readArticles();
  const existingLinks = new Set(existing.map(a => a.link));
  const deduplicated = newArticles.filter(a => !existingLinks.has(a.link));
  const merged = [...deduplicated, ...existing];
  writeArticles(merged);

  // Update source stats
  const sources = readSources();
  const addedPerSource = {};
  deduplicated.forEach(a => {
    addedPerSource[a.source] = (addedPerSource[a.source] || 0) + 1;
  });
  sources.forEach(s => {
    if (addedPerSource[s.name]) {
      if(!s.stats) s.stats = { total: 0, new: 0 };
      s.stats.new += addedPerSource[s.name];
    }
  });
  writeSources(sources);

  return { added: deduplicated.length, total: merged.length };
}

function updateStatus(ids, status) {
  const articles = readArticles();
  let updated = 0;
  articles.forEach(article => {
    if (ids.includes(article.id)) {
      article.status = status;
      article.updatedAt = new Date().toISOString();
      updated++;
    }
  });
  writeArticles(articles);
  return updated;
}

function getArticles(filters = {}) {
  let articles = readArticles();

  if (filters.source) {
    articles = articles.filter(a => a.source === filters.source);
  }
  if (filters.status) {
    articles = articles.filter(a => a.status === filters.status);
  }
  if (filters.search) {
    const q = filters.search.toLowerCase();
    articles = articles.filter(a =>
      a.title.toLowerCase().includes(q) ||
      (a.description && a.description.toLowerCase().includes(q))
    );
  }

  return articles;
}

function getStats() {
  const articles = readArticles();
  const sources = readSources();
  
  const bySources = articles.reduce((acc, a) => {
    acc[a.source] = (acc[a.source] || 0) + 1;
    return acc;
  }, {});

  return {
    total: articles.length,
    pending: articles.filter(a => a.status === 'pending').length,
    approved: articles.filter(a => a.status === 'approved').length,
    discarded: articles.filter(a => a.status === 'discarded').length,
    sources: sources.map(s => ({
      name: s.name,
      icon: s.icon,
      color: s.color,
      total: bySources[s.name] || 0,
      new: s.stats?.new || 0
    }))
  };
}

function clearAll() {
  writeArticles([]);
}

// ─── Sources Store ───────────────────────────────────────────────────

const DEFAULT_SOURCES = [
  { name: 'Bleeping Computer', feedUrl: 'https://www.bleepingcomputer.com/feed/', type: 'rss', icon: '🖥️', color: '#e74c3c' },
  { name: 'GBHackers', feedUrl: 'https://gbhackers.com/feed/', type: 'rss', icon: '🛡️', color: '#2ecc71' },
  { name: 'Kaspersky Labs', feedUrl: 'https://kaspersky.com/blog/feed/', type: 'rss', icon: '🔬', color: '#00a88e' },
  { name: 'Cisco Talos', feedUrl: 'https://blog.talosintelligence.com/feed.xml', type: 'rss', icon: '🔵', color: '#049fd9' },
  { name: 'FBI Cyber Division', feedUrl: 'https://www.fbi.gov/feeds/fbi-in-the-news/rss.xml', siteUrl: 'https://www.ic3.gov/Home/IndustryAlerts', type: 'rss-with-fallback', icon: '🏛️', color: '#003366' },
  { name: 'SentinelLabs', feedUrl: 'https://www.sentinelone.com/labs/feed/', type: 'rss', icon: '🟣', color: '#6c5ce7' },
  { name: 'Security Affairs', feedUrl: 'https://securityaffairs.com/feed', type: 'rss', icon: '🔐', color: '#e67e22' },
  { name: 'The420.in', feedUrl: 'https://the420.in/feed/', type: 'rss', icon: '🇮🇳', color: '#ff6b35' },
  { name: 'Cyber Security News', feedUrl: 'https://cybersecuritynews.com/feed/', type: 'rss', icon: '📰', color: '#0984e3' },
  { name: 'The Hacker News', feedUrl: 'https://feeds.feedburner.com/TheHackersNews', type: 'rss', icon: '💀', color: '#2d3436' },
  { name: 'Forbes Cyber', feedUrl: null, siteUrl: 'https://www.forbes.com/cybersecurity/', type: 'scrape', icon: '📊', color: '#b71c1c' }
];

function readSources() {
  ensureDataDir();
  if (!fs.existsSync(SOURCES_FILE)) {
    const defaultData = DEFAULT_SOURCES.map(s => ({ ...s, stats: { total: 0, new: 0 } }));
    fs.writeFileSync(SOURCES_FILE, JSON.stringify(defaultData, null, 2));
    return defaultData;
  }
  try {
    const data = JSON.parse(fs.readFileSync(SOURCES_FILE, 'utf-8'));
    // Migrations in case older model exist
    return data.map(s => s.stats ? s : { ...s, stats: { total: 0, new: 0 } });
  } catch {
    return [];
  }
}

function writeSources(sources) {
  ensureDataDir();
  fs.writeFileSync(SOURCES_FILE, JSON.stringify(sources, null, 2));
}

function addSource(sourceInfo) {
  const sources = readSources();
  if (!sources.find(s => s.name === sourceInfo.name)) {
    sources.push({ ...sourceInfo, stats: { total: 0, new: 0 } });
    writeSources(sources);
    return true;
  }
  return false;
}

function resetNewCounts() {
  const sources = readSources();
  sources.forEach(s => s.stats.new = 0);
  writeSources(sources);
}

// ─── Users Store ───────────────────────────────────────────────────

function readUsers() {
  ensureDataDir();
  if (!fs.existsSync(USERS_FILE)) {
    // Create default admin user — password: admin123 (bcrypt hash)
    const bcrypt = require('bcryptjs');
    const defaultUsers = [
      {
        id: '1',
        username: 'admin',
        password: bcrypt.hashSync('admin123', 10),
        role: 'admin',
        createdAt: new Date().toISOString()
      }
    ];
    fs.writeFileSync(USERS_FILE, JSON.stringify(defaultUsers, null, 2));
    return defaultUsers;
  }
  try {
    const data = fs.readFileSync(USERS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function findUser(username) {
  const users = readUsers();
  return users.find(u => u.username === username);
}

module.exports = {
  readArticles,
  writeArticles,
  addArticles,
  updateStatus,
  getArticles,
  getStats,
  clearAll,
  readSources,
  addSource,
  resetNewCounts,
  readUsers,
  findUser
};
