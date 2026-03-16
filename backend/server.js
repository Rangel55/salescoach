require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Pool } = require('pg');
const { OpenAI } = require('openai');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'salescoach_secret_2026';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── PostgreSQL ───────────────────────────────────────────────────────────────
const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function initDB() {
        const client = await pool.connect();
        try {
                  await client.query(`
                        CREATE TABLE IF NOT EXISTS users (
                                id SERIAL PRIMARY KEY,
                                        name VARCHAR(255),
                                                email VARCHAR(255) UNIQUE NOT NULL,
                                                        password VARCHAR(255) NOT NULL,
                                                                plan VARCHAR(50) DEFAULT 'free',
                                                                        created_at TIMESTAMP DEFAULT NOW()
                                                                              );
                                                                                    CREATE TABLE IF NOT EXISTS scripts (
                                                                                            id SERIAL PRIMARY KEY,
                                                                                                    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                                                                                                            name VARCHAR(255) NOT NULL,
                                                                                                                    content TEXT,
                                                                                                                            filename VARCHAR(255),
                                                                                                                                    filepath VARCHAR(500),
                                                                                                                                            created_at TIMESTAMP DEFAULT NOW()
                                                                                                                                                  );
                                                                                                                                                        CREATE TABLE IF NOT EXISTS calls (
                                                                                                                                                                id SERIAL PRIMARY KEY,
                                                                                                                                                                        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                                                                                                                                                                                script_id INTEGER REFERENCES scripts(id) ON DELETE SET NULL,
                                                                                                                                                                                        filename VARCHAR(255) NOT NULL,
                                                                                                                                                                                                filepath VARCHAR(500),
                                                                                                                                                                                                        duration INTEGER,
                                                                                                                                                                                                                analysis TEXT,
                                                                                                                                                                                                                        score INTEGER,
                                                                                                                                                                                                                                status VARCHAR(50) DEFAULT 'pending',
                                                                                                                                                                                                                                        created_at TIMESTAMP DEFAULT NOW()
                                                                                                                                                                                                                                              );
                                                                                                                                                                                                                                                  `);
                  console.log('DB initialized');
        } finally {
                  client.release();
        }
}
initDB().catch(console.error);

// ── JWT helpers ──────────────────────────────────────────────────────────────
function signToken(payload) {
        const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
        const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
        const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
        return `${header}.${body}.${sig}`;
}
function verifyToken(token) {
        try {
                  const [header, body, sig] = token.split('.');
                  const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
                  if (sig !== expected) return null;
                  return JSON.parse(Buffer.from(body, 'base64url').toString());
        } catch { return null; }
}
function authMiddleware(req, res, next) {
        const auth = req.headers.authorization;
        if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
        const payload = verifyToken(auth.slice(7));
        if (!payload) return res.status(401).json({ error: 'Invalid token' });
        req.user = payload;
        next();
}

// ── Storage uploads ──────────────────────────────────────────────────────────
const storage = multer.diskStorage({
        destination: (req, file, cb) => {
                  const dir = file.fieldname === 'script' ? './data/scripts' : './data/calls';
                  fs.mkdirSync(dir, { recursive: true });
                  cb(null, dir);
        },
        filename: (req, file, cb) => { cb(null, Date.now() + '-' + file.originalname); }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// ── Middlewares ──────────────────────────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ── Auth: Register ────────────────────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
        try {
                  const { name, email, password } = req.body;
                  if (!email || !password) return res.status(400).json({ error: 'Email e senha obrigatorios' });
                  const hash = crypto.createHash('sha256').update(password).digest('hex');
                  const result = await pool.query(
                              'INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id, name, email, plan',
                              [name || email.split('@')[0], email, hash]
                            );
                  const user = result.rows[0];
                  const token = signToken({ id: user.id, email: user.email });
                  res.json({ token, user });
        } catch (err) {
                  if (err.code === '23505') return res.status(400).json({ error: 'Email ja cadastrado' });
                  res.status(500).json({ error: err.message });
        }
});

// ── Auth: Login ───────────────────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
        try {
                  const { email, password } = req.body;
                  const hash = crypto.createHash('sha256').update(password).digest('hex');
                  const result = await pool.query('SELECT id, name, email, plan FROM users WHERE email=$1 AND password=$2', [email, hash]);
                  if (!result.rows.length) return res.status(401).json({ error: 'Email ou senha incorretos' });
                  const user = result.rows[0];
                  const token = signToken({ id: user.id, email: user.email });
                  res.json({ token, user });
        } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Auth: Me ──────────────────────────────────────────────────────────────────
app.get('/api/auth/me', authMiddleware, async (req, res) => {
        try {
                  const result = await pool.query('SELECT id, name, email, plan FROM users WHERE id=$1', [req.user.id]);
                  if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
                  res.json(result.rows[0]);
        } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Scripts ───────────────────────────────────────────────────────────────────
app.get('/api/scripts', authMiddleware, async (req, res) => {
        const result = await pool.query('SELECT * FROM scripts WHERE user_id=$1 ORDER BY created_at DESC', [req.user.id]);
        res.json(result.rows);
});

app.post('/api/scripts', authMiddleware, upload.single('script'), async (req, res) => {
        try {
                  const { name, content } = req.body;
                  const filepath = req.file ? req.file.path : null;
                  const filename = req.file ? req.file.originalname : null;
                  const result = await pool.query(
                              'INSERT INTO scripts (user_id, name, content, filename, filepath) VALUES ($1,$2,$3,$4,$5) RETURNING *',
                              [req.user.id, name || filename || 'Script', content || null, filename, filepath]
                            );
                  res.json(result.rows[0]);
        } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/scripts/:id', authMiddleware, async (req, res) => {
        await pool.query('DELETE FROM scripts WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
        res.json({ success: true });
});

// ── Calls ─────────────────────────────────────────────────────────────────────
app.get('/api/calls', authMiddleware, async (req, res) => {
        const result = await pool.query('SELECT * FROM calls WHERE user_id=$1 ORDER BY created_at DESC', [req.user.id]);
        res.json(result.rows);
});

app.post('/api/calls', authMiddleware, upload.single('call'), async (req, res) => {
        try {
                  const { script_id } = req.body;
                  const filepath = req.file ? req.file.path : null;
                  const filename = req.file ? req.file.originalname : 'call';
                  const result = await pool.query(
                              'INSERT INTO calls (user_id, script_id, filename, filepath, status) VALUES ($1,$2,$3,$4,$5) RETURNING *',
                              [req.user.id, script_id || null, filename, filepath, 'pending']
                            );
                  res.json(result.rows[0]);
        } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/calls/:id', authMiddleware, async (req, res) => {
        await pool.query('DELETE FROM calls WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
        res.json({ success: true });
});

// ── Dashboard stats ───────────────────────────────────────────────────────────
app.get('/api/stats', authMiddleware, async (req, res) => {
        try {
                  const [scripts, calls, avgScore] = await Promise.all([
                              pool.query('SELECT COUNT(*) FROM scripts WHERE user_id=$1', [req.user.id]),
                              pool.query('SELECT COUNT(*) FROM calls WHERE user_id=$1', [req.user.id]),
                              pool.query('SELECT AVG(score) FROM calls WHERE user_id=$1 AND score IS NOT NULL', [req.user.id])
                            ]);
                  res.json({
                              scripts: parseInt(scripts.rows[0].count),
                              calls: parseInt(calls.rows[0].count),
                              avgScore: avgScore.rows[0].avg ? Math.round(avgScore.rows[0].avg) : null
                  });
        } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── SPA fallback ──────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
        if (!req.path.startsWith('/api')) {
                  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
        }
});

// ── Start server ──────────────────────────────────────────────────────────────
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
