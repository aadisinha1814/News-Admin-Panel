const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const ARTICLES_FILE = path.join(DATA_DIR, 'articles.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

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
  return {
    total: articles.length,
    pending: articles.filter(a => a.status === 'pending').length,
    approved: articles.filter(a => a.status === 'approved').length,
    discarded: articles.filter(a => a.status === 'discarded').length,
    bySources: articles.reduce((acc, a) => {
      acc[a.source] = (acc[a.source] || 0) + 1;
      return acc;
    }, {})
  };
}

function clearAll() {
  writeArticles([]);
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
  readUsers,
  findUser
};
