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
        title VARCHAR(255) NOT NULL,
        description VARCHAR(500),
        content TEXT,
        filename VARCHAR(255),
        filepath VARCHAR(500),
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS calls (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        outcome VARCHAR(50) DEFAULT 'venda',
        notes TEXT,
        content TEXT,
        filename VARCHAR(255),
        filepath VARCHAR(500),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    const migrations = [
      "ALTER TABLE scripts ADD COLUMN IF NOT EXISTS title VARCHAR(255)",
      "ALTER TABLE scripts ADD COLUMN IF NOT EXISTS description VARCHAR(500)",
      "ALTER TABLE calls ADD COLUMN IF NOT EXISTS title VARCHAR(255)",
      "ALTER TABLE calls ADD COLUMN IF NOT EXISTS outcome VARCHAR(50) DEFAULT 'venda'",
      "ALTER TABLE calls ADD COLUMN IF NOT EXISTS notes TEXT",
      "ALTER TABLE calls ADD COLUMN IF NOT EXISTS content TEXT"
    ];
    for (const sql of migrations) { await client.query(sql).catch(() => {}); }
    console.log('DB initialized');
  } finally { client.release(); }
}
initDB().catch(console.error);

function signToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(header + '.' + body).digest('base64url');
  return header + '.' + body + '.' + sig;
}

function verifyToken(token) {
  try {
    const [header, body, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(header + '.' + body).digest('base64url');
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

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = file.fieldname === 'script' ? './data/scripts' : './data/calls';
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => { cb(null, Date.now() + '-' + file.originalname); }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..', 'frontend')));

app.get('/api/health', async (req, res) => {
  try {
    let scriptsCount = 0, callsCount = 0;
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) {
      const payload = verifyToken(auth.slice(7));
      if (payload) {
        const [s, c] = await Promise.all([
          pool.query('SELECT COUNT(*) FROM scripts WHERE user_id=$1', [payload.id]),
          pool.query('SELECT COUNT(*) FROM calls WHERE user_id=$1', [payload.id])
        ]);
        scriptsCount = parseInt(s.rows[0].count);
        callsCount = parseInt(c.rows[0].count);
      }
    }
    res.json({ status: 'ok', timestamp: new Date().toISOString(), sessions: wss.clients.size, knowledge: { scripts: scriptsCount, calls: callsCount } });
  } catch (err) {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), sessions: 0, knowledge: { scripts: 0, calls: 0 } });
  }
});

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
    res.json({ token: signToken({ id: user.id, email: user.email }), user });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Email ja cadastrado' });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const hash = crypto.createHash('sha256').update(password).digest('hex');
    const result = await pool.query('SELECT id, name, email, plan FROM users WHERE email=$1 AND password=$2', [email, hash]);
    if (!result.rows.length) return res.status(401).json({ error: 'Email ou senha incorretos' });
    const user = result.rows[0];
    res.json({ token: signToken({ id: user.id, email: user.email }), user });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, email, plan FROM users WHERE id=$1', [req.user.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
    res.json({ user: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/scripts', authMiddleware, async (req, res) => {
  const result = await pool.query(
    'SELECT id, title, description, content, filename, created_at AS "uploadedAt" FROM scripts WHERE user_id=$1 ORDER BY created_at DESC',
    [req.user.id]
  );
  res.json(result.rows);
});

app.post('/api/scripts', authMiddleware, upload.single('script'), async (req, res) => {
  try {
    const { title, description } = req.body;
    let content = req.body.content || null;
    const filepath = req.file ? req.file.path : null;
    const filename = req.file ? req.file.originalname : null;
    if (req.file && !content) { try { content = fs.readFileSync(req.file.path, 'utf8'); } catch {} }
    const result = await pool.query(
      'INSERT INTO scripts (user_id, title, description, content, filename, filepath) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, title, description, content, filename, created_at AS "uploadedAt"',
      [req.user.id, title || filename || 'Script', description || null, content, filename, filepath]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/scripts/:id', authMiddleware, async (req, res) => {
  await pool.query('DELETE FROM scripts WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  res.json({ success: true });
});

app.get('/api/calls', authMiddleware, async (req, res) => {
  const result = await pool.query(
    'SELECT id, title, outcome, notes, filename, created_at AS "uploadedAt" FROM calls WHERE user_id=$1 ORDER BY created_at DESC',
    [req.user.id]
  );
  res.json(result.rows);
});

app.post('/api/calls', authMiddleware, upload.single('call'), async (req, res) => {
  try {
    const { title, outcome, notes } = req.body;
    let content = req.body.content || null;
    const filepath = req.file ? req.file.path : null;
    const filename = req.file ? req.file.originalname : 'call';
    if (req.file && !content && req.file.mimetype === 'text/plain') { try { content = fs.readFileSync(req.file.path, 'utf8'); } catch {} }
    const result = await pool.query(
      'INSERT INTO calls (user_id, title, outcome, notes, content, filename, filepath) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, title, outcome, notes, filename, created_at AS "uploadedAt"',
      [req.user.id, title || filename, outcome || 'venda', notes || null, content, filename, filepath]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/calls/:id', authMiddleware, async (req, res) => {
  await pool.query('DELETE FROM calls WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  res.json({ success: true });
});

app.get('/api/knowledge', authMiddleware, async (req, res) => {
  try {
    const [scripts, calls] = await Promise.all([
      pool.query('SELECT title, description, content FROM scripts WHERE user_id=$1', [req.user.id]),
      pool.query('SELECT title, outcome, notes, content FROM calls WHERE user_id=$1', [req.user.id])
    ]);
    if (!scripts.rows.length && !calls.rows.length) return res.json({ summary: null, scriptsCount: 0, callsCount: 0 });
    let parts = [];
    if (scripts.rows.length) {
      parts.push('=== SCRIPTS (' + scripts.rows.length + ') ===');
      scripts.rows.forEach(s => { parts.push('- ' + s.title + (s.description ? ' (' + s.description + ')' : '')); if (s.content) parts.push(s.content.substring(0, 500)); });
    }
    if (calls.rows.length) {
      parts.push('\n=== CALLS (' + calls.rows.length + ') ===');
      calls.rows.forEach(c => { parts.push('- ' + c.title + ' [' + c.outcome + ']' + (c.notes ? ' - ' + c.notes : '')); if (c.content) parts.push(c.content.substring(0, 300)); });
    }
    res.json({ summary: parts.join('\n'), scriptsCount: scripts.rows.length, callsCount: calls.rows.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/analyze', authMiddleware, async (req, res) => {
  try {
    const { transcript } = req.body;
    if (!transcript) return res.status(400).json({ error: 'Transcript obrigatorio' });
    const [scripts, calls] = await Promise.all([
      pool.query('SELECT title, content FROM scripts WHERE user_id=$1 LIMIT 5', [req.user.id]),
      pool.query("SELECT title, outcome, content FROM calls WHERE user_id=$1 AND outcome='venda' LIMIT 3", [req.user.id])
    ]);
    let ctx = '';
    if (scripts.rows.length) ctx += 'Scripts:\n' + scripts.rows.map(s => s.title + ': ' + (s.content || '').substring(0, 300)).join('\n') + '\n\n';
    if (calls.rows.length) ctx += 'Calls:\n' + calls.rows.map(c => c.title + ': ' + (c.content || '').substring(0, 200)).join('\n');
    const prompt = 'Coach de vendas: analise a transcricao e retorne JSON com: resumo, momento_final, pontos_fortes (array), pontos_de_melhoria (array), probabilidade_fechamento (alta/media/baixa), proximo_passo_recomendado. Apenas JSON sem markdown.\n\n' + (ctx ? 'Contexto:\n' + ctx + '\n\n' : '') + 'Transcricao:\n' + transcript.substring(0, 6000);
    const completion = await openai.chat.completions.create({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], temperature: 0.3 });
    let analysis;
    try {
      analysis = JSON.parse(completion.choices[0].message.content.trim().replace(/^```json?\n?/, '').replace(/\n?```$/, ''));
    } catch {
      analysis = { resumo: completion.choices[0].message.content, momento_final: '-', pontos_fortes: [], pontos_de_melhoria: [], probabilidade_fechamento: 'media', proximo_passo_recomendado: 'Revisar manualmente' };
    }
    res.json({ success: true, analysis });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/stats', authMiddleware, async (req, res) => {
  try {
    const [s, c] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM scripts WHERE user_id=$1', [req.user.id]),
      pool.query('SELECT COUNT(*) FROM calls WHERE user_id=$1', [req.user.id])
    ]);
    res.json({ scripts: parseInt(s.rows[0].count), calls: parseInt(c.rows[0].count) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

wss.on('connection', (ws) => {
  console.log('WS connected. Total:', wss.clients.size);
  ws.on('close', () => console.log('WS disconnected. Total:', wss.clients.size));
});

app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

server.listen(PORT, () => console.log('Server running on port ' + PORT));
