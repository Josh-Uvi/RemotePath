import express from 'express';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

interface SessionData {
  username: string;
  createdAt: number;
  expiresAt: number;
}

class SessionManager {
  private sessions = new Map<string, SessionData>();

  createSession(username: string): string {
    const token = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    this.sessions.set(token, {
      username,
      createdAt: now,
      expiresAt: now + 60 * 60 * 1000, // 1 hour
    });
    return token;
  }

  validateSession(token: string | undefined): string | null {
    if (!token) return null;
    const session = this.sessions.get(token);
    if (!session) return null;

    if (Date.now() > session.expiresAt) {
      this.sessions.delete(token);
      return null;
    }

    return session.username;
  }

  destroySession(token: string | undefined): void {
    if (token) {
      this.sessions.delete(token);
    }
  }

  cleanupExpiredSessions(): void {
    const now = Date.now();
    for (const [token, session] of this.sessions.entries()) {
      if (now > session.expiresAt) {
        this.sessions.delete(token);
      }
    }
  }
}

const sessionMgr = new SessionManager();
setInterval(() => sessionMgr.cleanupExpiredSessions(), 5 * 60 * 1000);

const validUsers: Record<string, string> = {
  admin: 'admin123',
  user: 'password',
};

const app = express();
app.set('trust proxy', 1);

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

function getCookieOptions(req: express.Request): express.CookieOptions {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  return {
    path: '/',
    httpOnly: true,
    secure: isHttps,
    sameSite: isHttps ? 'none' : 'lax',
    maxAge: 60 * 60 * 1000,
  };
}

function getClearCookieOptions(req: express.Request): express.CookieOptions {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  return {
    path: '/',
    httpOnly: true,
    secure: isHttps,
    sameSite: isHttps ? 'none' : 'lax',
  };
}

function extractSessionToken(req: express.Request): string | undefined {
  if (req.cookies?.session) {
    return req.cookies.session;
  }
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const headerToken = authHeader.substring(7).trim();
    if (headerToken) return headerToken;
  }
  if (typeof req.query.token === 'string' && req.query.token.trim()) {
    return req.query.token.trim();
  }
  if (typeof req.query.session === 'string' && req.query.session.trim()) {
    return req.query.session.trim();
  }
  return undefined;
}

// Security headers
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-ancestors *"
  );
  next();
});

app.use(express.json());
app.use(cookieParser());

// Handle malformed JSON
app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ success: false, error: 'Invalid request body' });
  }
  next(err);
});

// Authentication endpoints
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const trimmedUsername = typeof username === 'string' ? username.trim() : '';

  if (!trimmedUsername || typeof password !== 'string' || !password) {
    return res.status(400).json({
      success: false,
      error: 'Username and password required',
    });
  }

  const expectedPassword = validUsers[trimmedUsername];
  if (!expectedPassword || expectedPassword !== password) {
    return res.status(401).json({
      success: false,
      error: 'Invalid username or password',
    });
  }

  const token = sessionMgr.createSession(trimmedUsername);
  res.cookie('session', token, getCookieOptions(req));
  return res.status(200).json({
    success: true,
    message: 'Login successful',
    token,
  });
});

app.all('/api/login', (_req, res) => {
  res.status(405).json({ success: false, error: 'Method not allowed' });
});

app.post('/api/logout', (req, res) => {
  const token = extractSessionToken(req);
  if (token) {
    sessionMgr.destroySession(token);
  }
  res.clearCookie('session', getClearCookieOptions(req));
  return res.status(200).json({
    success: true,
    message: 'Logged out successfully',
  });
});

app.all('/api/logout', (_req, res) => {
  res.status(405).json({ success: false, error: 'Method not allowed' });
});

// Directory listing endpoint
app.get('/api/list', async (req, res) => {
  const token = extractSessionToken(req);
  const username = sessionMgr.validateSession(token);
  if (!username) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized',
    });
  }

  const requestedPath = typeof req.query.path === 'string' ? req.query.path : '/';
  const allowedBaseDir = process.env.ALLOWED_BASE_DIR
    ? path.resolve(process.env.ALLOWED_BASE_DIR)
    : process.cwd();

  const normalizedRequested = requestedPath.startsWith('/') ? requestedPath : '/' + requestedPath;
  const cleanPath = path.resolve(allowedBaseDir, '.' + normalizedRequested);

  if (!cleanPath.startsWith(allowedBaseDir)) {
    return res.status(403).json({
      success: false,
      error: 'Path traversal detected',
    });
  }

  try {
    const stat = await fs.promises.stat(cleanPath);
    if (!stat.isDirectory()) {
      return res.status(400).json({
        success: false,
        error: 'Failed to read directory',
      });
    }

    const entries = await fs.promises.readdir(cleanPath, { withFileTypes: true });
    const contents: Array<{
      name: string;
      type: string;
      size: number;
      modified: string;
    }> = [];

    for (const entry of entries) {
      try {
        const entryStat = await fs.promises.stat(path.join(cleanPath, entry.name));
        contents.push({
          name: entry.name,
          type: entry.isDirectory() ? 'dir' : 'file',
          size: entryStat.size,
          modified: entryStat.mtime.toISOString(),
        });
      } catch {
        // Skip entries that cannot be stat'd
      }
    }

    const dirName = path.basename(cleanPath) || 'root';

    return res.status(200).json({
      name: dirName,
      type: 'dir',
      size: 0,
      path: cleanPath,
      contents,
    });
  } catch {
    return res.status(400).json({
      success: false,
      error: 'Failed to read directory',
    });
  }
});

app.all('/api/list', (_req, res) => {
  res.status(405).json({ success: false, error: 'Method not allowed' });
});

// Page routes
app.get('/', (req, res) => {
  const token = extractSessionToken(req);
  const username = sessionMgr.validateSession(token);
  if (username) {
    return res.redirect(303, '/files');
  }
  return res.redirect(303, '/login');
});

app.get('/login', (_req, res) => {
  res.sendFile(path.resolve('./static/login.html'));
});

app.get(['/files', '/files/*'], (req, res) => {
  const token = extractSessionToken(req);
  const username = sessionMgr.validateSession(token);
  if (!username) {
    return res.redirect(303, '/login');
  }
  return res.sendFile(path.resolve('./static/files.html'));
});

// Serve static assets
app.use('/static', express.static(path.resolve('./static')));

// Catch-all
app.use((_req, res) => {
  res.status(404).send('Not Found');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on http://0.0.0.0:${PORT}`);
  console.log('Test credentials:');
  console.log('  Username: admin, Password: admin123');
  console.log('  Username: user, Password: password');
});
