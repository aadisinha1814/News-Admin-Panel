const express = require('express');
const session = require('express-session');
const cors = require('cors');
const cron = require('node-cron');
const path = require('path');
const crypto = require('crypto');

const store = require('./store');
const feedEngine = require('./feedEngine');
const auth = require('./auth');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ────────────────────────────────────────────────────

app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: crypto.randomBytes(32).toString('hex'),
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
  if (req.session && req.session.user) {
    return res.redirect('/');
  }
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
    articles.sort((a,b) => new Date(b.published) - new Date(a.published));
    res.json({ success: true, articles });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get articles with optional filters
app.get('/api/articles', auth.requireAuth, (req, res) => {
  try {
    const { source, status, search } = req.query;
    const articles = store.getArticles({ source, status, search });
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

  // Initial fetch on startup
  console.log('[STARTUP] Running initial feed fetch...');
  isFetching = true;
  feedEngine.fetchAllSources()
    .then(({ articles, summary }) => {
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
});
