const bcrypt = require('bcryptjs');
const store = require('./store');

// ─── Authentication Middleware ─────────────────────────────────────

function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  // For API requests, return 401
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  // For page requests, redirect to login
  return res.redirect('/login.html');
}

// ─── Login Handler ─────────────────────────────────────────────────

async function login(req, res) {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const user = store.findUser(username);
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const isValid = bcrypt.compareSync(password, user.password);
  if (!isValid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  req.session.user = {
    id: user.id,
    username: user.username,
    role: user.role
  };

  return res.json({
    success: true,
    user: {
      username: user.username,
      role: user.role
    }
  });
}

// ─── Logout Handler ────────────────────────────────────────────────

function logout(req, res) {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to logout' });
    }
    res.json({ success: true });
  });
}

// ─── Check Auth Status ─────────────────────────────────────────────

function checkAuth(req, res) {
  if (req.session && req.session.user) {
    return res.json({ authenticated: true, user: req.session.user });
  }
  return res.json({ authenticated: false });
}

module.exports = {
  requireAuth,
  login,
  logout,
  checkAuth
};
