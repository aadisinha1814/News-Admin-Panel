const express = require('express');
const session = require('express-session');
const cors = require('cors');
const cron = require('node-cron');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const store = require('./store');
const feedEngine = require('./feedEngine');
const auth = require('./auth');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Session Secret (persisted across restarts) ─────────────────────
// A new random secret on every restart would invalidate all active sessions.
const SESSION_SECRET_FILE = path.join(__dirname, '..', 'data', 'session-secret.txt');

function getOrCreateSessionSecret() {
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (fs.existsSync(SESSION_SECRET_FILE)) {
    return fs.readFileSync(SESSION_SECRET_FILE, 'utf-8').trim();
  }
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(SESSION_SECRET_FILE, secret);
  console.log('[SESSION] New session secret generated and saved.');
  return secret;
}

// ─── Middleware ────────────────────────────────────────────────────

// Allow only localhost origins — prevents any other website from making
// authenticated cross-origin requests using the user's session cookie.
const ALLOWED_ORIGINS = [
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`,
  'http://localhost',
  'http://127.0.0.1',
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow same-origin requests (no Origin header) and whitelisted origins
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: Origin '${origin}' is not allowed`));
  },
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: getOrCreateSessionSecret(),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// ─── Public Routes (no auth) ──────────────────────────────────────

// Login page
app.get('/login.html', (req, res) => {

  // If already logged in → go to admin dashboard
  if (req.session && req.session.user) {
    return res.redirect('/admin');
  }

  // Otherwise show login page
  res.sendFile(path.join(__dirname, '..', 'public', 'login.html'));
});

// Login CSS
app.get('/login.css', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'login.css'));
});

// Auth API endpoints
app.post('/api/auth/login', auth.login);
app.post('/api/auth/logout', auth.logout);
app.get('/api/auth/check', auth.checkAuth);

// ─── Protected Static Files ───────────────────────────────────────

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.get('/admin', auth.requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});

app.get('/admin.html', auth.requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});

app.use(express.static(path.join(__dirname, '..', 'public')));

// ─── API Routes ──────────────────────────────────────────────────

// Get approved articles (public)
app.get('/api/public/articles', (req, res) => {
  try {
    const articles = store.getArticles({ status: 'approved' });
    // sort by latest
    articles.sort((a, b) => new Date(b.published) - new Date(a.published));
    res.json({ success: true, articles });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get articles with optional filters
app.get('/api/articles', auth.requireAuth, (req, res) => {
  try {
    const { source, status, search, category } = req.query;
    const articles = store.getArticles({ source, status, search, category });
    res.json({ success: true, articles, count: articles.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get dashboard stats
app.get('/api/stats', auth.requireAuth, (req, res) => {
  try {
    const stats = store.getStats();
    res.json({ success: true, stats });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get sources list
app.get('/api/sources', auth.requireAuth, (req, res) => {
  try {
    const sources = feedEngine.getSources();
    res.json({ success: true, sources });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Approve articles
app.post('/api/articles/approve', auth.requireAuth, (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids)) {
      return res.status(400).json({ error: 'ids array is required' });
    }
    const updated = store.updateStatus(ids, 'approved');
    res.json({ success: true, updated });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Discard articles
app.post('/api/articles/discard', auth.requireAuth, (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids)) {
      return res.status(400).json({ error: 'ids array is required' });
    }
    const updated = store.updateStatus(ids, 'discarded');
    res.json({ success: true, updated });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Reset article status to pending
app.post('/api/articles/reset', auth.requireAuth, (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids)) {
      return res.status(400).json({ error: 'ids array is required' });
    }
    const updated = store.updateStatus(ids, 'pending');
    res.json({ success: true, updated });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update article details
app.post('/api/articles/update', auth.requireAuth, (req, res) => {
  try {
    const { id, updates } = req.body;
    if (!id || !updates) {
      return res.status(400).json({ error: 'id and updates are required' });
    }
    const success = store.updateArticle(id, updates);
    res.json({ success });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Manual fetch trigger
let isFetching = false;
let lastFetchSummary = null;

app.post('/api/fetch', auth.requireAuth, async (req, res) => {
  if (isFetching) {
    return res.status(429).json({ error: 'Fetch already in progress' });
  }
  try {
    isFetching = true;
    const { articles, summary } = await feedEngine.fetchAllSources();
    store.resetNewCounts();
    const result = store.addArticles(articles);
    lastFetchSummary = { ...summary, ...result };
    res.json({ success: true, summary: lastFetchSummary });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    isFetching = false;
  }
});

// Get last fetch status
app.get('/api/fetch/status', auth.requireAuth, (req, res) => {
  res.json({
    isFetching,
    lastFetchSummary
  });
});

// ─── Article Content Preview ──────────────────────────────────────────
// Fetches the article's external URL and extracts main body text so the
// summary modal can show real content rather than the RSS snippet.
// No auth required — used by both the public feed and admin panel.
app.post('/api/public/preview', async (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ preview: null, error: 'Valid URL required' });
  }
  try {
    const cheerio = require('cheerio');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    let response;
    try {
      response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,*/*;q=0.9',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    const $ = cheerio.load(html);

    // Strip everything that isn't article content
    $('script,style,nav,header,footer,aside,iframe,.ad,.ads,.advertisement,.sidebar,.widget,.cookie-banner,.popup,.modal,.newsletter,.related-posts,.comments,.social-share,.breadcrumb,.tags-list,form').remove();

    // Try specific article-body containers in priority order
    let text = '';
    const candidates = [
      'article .content', 'article .body', '.article-body', '.post-content',
      '.entry-content', '.story-body', '.article__body', '.post-body',
      '.article-text', 'article', '[role="main"] p', 'main'
    ];
    for (const sel of candidates) {
      const el = $(sel);
      if (el.length) {
        const t = el.text().trim();
        if (t.length > 120) { text = t; break; }
      }
    }

    // Fallback: collect all substantial paragraphs
    if (!text) {
      text = $('p')
        .map((_, el) => $(el).text().trim())
        .get()
        .filter(t => t.length > 60)
        .join(' ');
    }

    // Normalise whitespace and trim to 650 chars at a word boundary
    text = text.replace(/\s+/g, ' ').trim();
    if (text.length > 650) {
      text = text.substring(0, 650).replace(/\s+\S*$/, '') + '…';
    }

    res.json({ preview: text || null });
  } catch (err) {
    // Timeout, network error, or parse failure — return null gracefully
    res.json({ preview: null });
  }
});

// ─── Cron Job: Auto-fetch every 30 minutes ─────────────────────────


cron.schedule('*/30 * * * *', async () => {
  if (isFetching) {
    console.log('[CRON] Skipping — fetch already in progress');
    return;
  }
  console.log('[CRON] Auto-fetch triggered');
  isFetching = true;
  try {
    const { articles, summary } = await feedEngine.fetchAllSources();
    store.resetNewCounts();
    const result = store.addArticles(articles);
    lastFetchSummary = { ...summary, ...result };
    console.log(`[CRON] Added ${result.added} new articles (total: ${result.total})`);
  } catch (error) {
    console.error('[CRON] Fetch failed:', error.message);
  } finally {
    isFetching = false;
  }
});

// ─── Start Server ──────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║          CYBER NEWS PIPELINE — Admin Panel               ║
║──────────────────────────────────────────────────────────║
║  Server running at: http://localhost:${PORT}                ║
║  Default login:     admin / admin123                     ║
║  Auto-fetch:        Every 30 minutes                     ║
╚══════════════════════════════════════════════════════════╝
  `);

  // Initial fetch on startup — delayed 5s so the server is ready to serve requests first
  console.log('[STARTUP] Server ready. Initial feed fetch will begin in 5 seconds...');
  setTimeout(() => {
    if (isFetching) return;
    isFetching = true;
    console.log('[STARTUP] Running initial feed fetch...');
    feedEngine.fetchAllSources()
      .then(({ articles, summary }) => {
        store.resetNewCounts();
        const result = store.addArticles(articles);
        lastFetchSummary = { ...summary, ...result };
        console.log(`[STARTUP] Loaded ${result.added} articles from ${summary.successCount} sources`);
      })
      .catch(err => {
        console.error('[STARTUP] Initial fetch failed:', err.message);
      })
      .finally(() => {
        isFetching = false;
      });
  }, 5000);
});
