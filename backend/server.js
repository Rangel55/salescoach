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
  req.user = payload; next();
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => { const dir = file.fieldname === 'script' ? './data/scripts' : './data/calls'; fs.mkdirSync(dir, { recursive: true }); cb(null, dir); },
  filename: (req, file, cb) => { cb(null, Date.now() + '-' + file.originalname); }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..', 'frontend')));

app.get('/api/health', async (req, res) => {
  try {
    let sc = 0, cc = 0;
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) {
      const p = verifyToken(auth.slice(7));
      if (p) { const [s, c] = await Promise.all([pool.query('SELECT COUNT(*) FROM scripts WHERE user_id=$1', [p.id]), pool.query('SELECT COUNT(*) FROM calls WHERE user_id=$1', [p.id])]); sc = parseInt(s.rows[0].count); cc = parseInt(c.rows[0].count); }
    }
    res.json({ status: 'ok', timestamp: new Date().toISOString(), sessions: wss.clients.size, knowledge: { scripts: sc, calls: cc } });
  } catch { res.json({ status: 'ok', timestamp: new Date().toISOString(), sessions: 0, knowledge: { scripts: 0, calls: 0 } }); }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email e senha obrigatorios' });
    const hash = crypto.createHash('sha256').update(password).digest('hex');
    const r = await pool.query('INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id, name, email, plan', [name || email.split('@')[0], email, hash]);
    res.json({ token: signToken({ id: r.rows[0].id, email: r.rows[0].email }), user: r.rows[0] });
  } catch (err) { if (err.code === '23505') return res.status(400).json({ error: 'Email ja cadastrado' }); res.status(500).json({ error: err.message }); }
});
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const hash = crypto.createHash('sha256').update(password).digest('hex');
    const r = await pool.query('SELECT id, name, email, plan FROM users WHERE email=$1 AND password=$2', [email, hash]);
    if (!r.rows.length) return res.status(401).json({ error: 'Email ou senha incorretos' });
    res.json({ token: signToken({ id: r.rows[0].id, email: r.rows[0].email }), user: r.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const r = await pool.query('SELECT id, name, email, plan FROM users WHERE id=$1', [req.user.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'User not found' });
    res.json({ user: r.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/scripts', authMiddleware, async (req, res) => { const r = await pool.query('SELECT id, title, description, content, filename, created_at AS "uploadedAt" FROM scripts WHERE user_id=$1 ORDER BY created_at DESC', [req.user.id]); res.json(r.rows); });
app.post('/api/scripts', authMiddleware, upload.single('script'), async (req, res) => {
  try {
    const { title, description } = req.body; let content = req.body.content || null;
    const filepath = req.file ? req.file.path : null; const filename = req.file ? req.file.originalname : null;
    if (req.file && !content) { try { content = fs.readFileSync(req.file.path, 'utf8'); } catch {} }
    const r = await pool.query('INSERT INTO scripts (user_id, title, description, content, filename, filepath) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, title, description, content, filename, created_at AS "uploadedAt"', [req.user.id, title || filename || 'Script', description || null, content, filename, filepath]);
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.delete('/api/scripts/:id', authMiddleware, async (req, res) => { await pool.query('DELETE FROM scripts WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]); res.json({ success: true }); });
app.get('/api/calls', authMiddleware, async (req, res) => { const r = await pool.query('SELECT id, title, outcome, notes, filename, created_at AS "uploadedAt" FROM calls WHERE user_id=$1 ORDER BY created_at DESC', [req.user.id]); res.json(r.rows); });
app.post('/api/calls', authMiddleware, upload.single('call'), async (req, res) => {
  try {
    const { title, outcome, notes } = req.body; let content = req.body.content || null;
    const filepath = req.file ? req.file.path : null; const filename = req.file ? req.file.originalname : 'call';
    if (req.file && !content && req.file.mimetype === 'text/plain') { try { content = fs.readFileSync(req.file.path, 'utf8'); } catch {} }
    const r = await pool.query('INSERT INTO calls (user_id, title, outcome, notes, content, filename, filepath) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, title, outcome, notes, filename, created_at AS "uploadedAt"', [req.user.id, title || filename, outcome || 'venda', notes || null, content, filename, filepath]);
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.delete('/api/calls/:id', authMiddleware, async (req, res) => { await pool.query('DELETE FROM calls WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]); res.json({ success: true }); });
app.get('/api/knowledge', authMiddleware, async (req, res) => {
  try {
    const [scripts, calls] = await Promise.all([pool.query('SELECT title, description, content FROM scripts WHERE user_id=$1', [req.user.id]), pool.query('SELECT title, outcome, notes, content FROM calls WHERE user_id=$1', [req.user.id])]);
    if (!scripts.rows.length && !calls.rows.length) return res.json({ summary: null, scriptsCount: 0, callsCount: 0 });
    let parts = [];
    if (scripts.rows.length) { parts.push('=== SCRIPTS (' + scripts.rows.length + ') ==='); scripts.rows.forEach(s => { parts.push('- ' + s.title + (s.description ? ' (' + s.description + ')' : '')); if (s.content) parts.push(s.content.substring(0, 500)); }); }
    if (calls.rows.length) { parts.push('\n=== CALLS (' + calls.rows.length + ') ==='); calls.rows.forEach(c => { parts.push('- ' + c.title + ' [' + c.outcome + ']' + (c.notes ? ' - ' + c.notes : '')); if (c.content) parts.push(c.content.substring(0, 300)); }); }
    res.json({ summary: parts.join('\n'), scriptsCount: scripts.rows.length, callsCount: calls.rows.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/analyze', authMiddleware, async (req, res) => {
  try {
    const { transcript } = req.body;
    if (!transcript) return res.status(400).json({ error: 'Transcript obrigatorio' });
    const [scripts, calls] = await Promise.all([pool.query('SELECT title, content FROM scripts WHERE user_id=$1 LIMIT 5', [req.user.id]), pool.query("SELECT title, outcome, content FROM calls WHERE user_id=$1 AND outcome='venda' LIMIT 3", [req.user.id])]);
    let ctx = '';
    if (scripts.rows.length) ctx += 'Scripts:\n' + scripts.rows.map(s => s.title + ': ' + (s.content || '').substring(0, 300)).join('\n') + '\n\n';
    if (calls.rows.length) ctx += 'Calls:\n' + calls.rows.map(c => c.title + ': ' + (c.content || '').substring(0, 200)).join('\n');
    const prompt = 'Coach de vendas: analise a transcricao e retorne JSON com: resumo, momento_final, pontos_fortes (array), pontos_de_melhoria (array), probabilidade_fechamento (alta/media/baixa), proximo_passo_recomendado. Apenas JSON sem markdown.\n\n' + (ctx ? 'Contexto:\n' + ctx + '\n\n' : '') + 'Transcricao:\n' + transcript.substring(0, 6000);
    const completion = await openai.chat.completions.create({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], temperature: 0.3 });
    let analysis;
    try { analysis = JSON.parse(completion.choices[0].message.content.trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '')); }
    catch { analysis = { resumo: completion.choices[0].message.content, momento_final: '-', pontos_fortes: [], pontos_de_melhoria: [], probabilidade_fechamento: 'media', proximo_passo_recomendado: 'Revisar manualmente' }; }
    res.json({ success: true, analysis });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});
app.get('/api/stats', authMiddleware, async (req, res) => {
  try { const [s, c] = await Promise.all([pool.query('SELECT COUNT(*) FROM scripts WHERE user_id=$1', [req.user.id]), pool.query('SELECT COUNT(*) FROM calls WHERE user_id=$1', [req.user.id])]); res.json({ scripts: parseInt(s.rows[0].count), calls: parseInt(c.rows[0].count) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── WebSocket — Coaching em tempo real ────────────────────────────────────────
// A IA so fala quando tem algo VALIOSO: objecao, sinal de compra, risco, oportunidade.
// Cada insight tem: momento, alerta, texto direto, evidencia real, e pergunta exata.
const sessions = new Map();

async function loadKnowledgeForUser(userId) {
  try {
    const [scripts, calls] = await Promise.all([
      pool.query('SELECT title, content FROM scripts WHERE user_id=$1 LIMIT 8', [userId]),
      pool.query("SELECT title, outcome, notes, content FROM calls WHERE user_id=$1 AND outcome='venda' LIMIT 5", [userId])
    ]);
    let k = '';
    if (scripts.rows.length) { k += '=== PLAYBOOKS E SCRIPTS DO VENDEDOR ===\n'; scripts.rows.forEach(s => { k += '--- ' + s.title + ' ---\n' + (s.content || '').substring(0, 800) + '\n\n'; }); }
    if (calls.rows.length) { k += '=== CALLS VENCEDORAS (referencia de comportamento) ===\n'; calls.rows.forEach(c => { k += '--- ' + c.title + (c.notes ? ' | ' + c.notes : '') + ' ---\n' + (c.content || '').substring(0, 500) + '\n\n'; }); }
    return k;
  } catch { return ''; }
}

// Prompt do coaching — regras claras de quando falar e o que gerar
function buildCoachingPrompt(transcript, knowledge, insightsJaEntregues) {
  const hist = insightsJaEntregues.length > 0
    ? '\n\nInsights ja entregues nesta sessao (NAO repita nem derive deles):\n' + insightsJaEntregues.slice(-5).map((v, i) => (i + 1) + '. ' + v).join('\n')
    : '';
  const kb = knowledge
    ? '\n\n=== BASE DE CONHECIMENTO DO VENDEDOR ===\n' + knowledge
    : '';

  return `Voce e o AI Sales Coach — um especialista silencioso que acompanha a call em tempo real.
Voce so intervem quando ha algo CONCRETO e VALIOSO a dizer. Silencio e melhor que ruido.

GATILHOS QUE JUSTIFICAM UM INSIGHT (precisa ter pelo menos um):
1. Objecao do cliente que o vendedor nao respondeu ou respondeu mal
2. Sinal de compra claro (urgencia, budget, dor forte, abertura) que o vendedor ignorou
3. Pergunta critica que o vendedor deveria ter feito e nao fez
4. Risco de perda iminente (cliente esfriando, concorrente mencionado, decisor ausente)
5. Momento de fechamento chegando e vendedor nao esta se posicionando

SEM NENHUM DESSES GATILHOS: responda exatamente {"skip": true}

NUNCA GERE:
- Sugestoes genericas ("continue ouvindo", "seja empatico", "faca perguntas abertas")
- Repetir ou derivar insights ja entregues
- Insights nao ancorados em algo especifico do que foi dito

QUANDO GERAR, retorne este JSON (sem markdown, campos obrigatorios):
{
  "skip": false,
  "momento": "<prospeccao | descoberta | apresentacao | objecao | negociacao | fechamento>",
  "alerta": "<oportunidade | perigo | neutro>",
  "insight": "<o que esta acontecendo e por que e critico — maximo 12 palavras, linguagem direta>",
  "motivo": "<trecho EXATO do que foi dito que justifica este insight>",
  "pergunta_sugerida": "<a pergunta precisa que o vendedor deve fazer agora, ou null>"
}

DEFINICOES:
- oportunidade: cliente mostrou dor real, urgencia, budget ou abertura — avance agora
- perigo: objecao ignorada, cliente desengajando, concorrente ou alternativa mencionada
- neutro: ajuste tecnico de melhoria sem urgencia critica
- prospeccao: apresentacoes, rapport, sem descoberta de dor ainda
- descoberta: mapeando problemas, contexto, impacto, urgencia, criterios
- apresentacao: vendedor demonstrando solucao ou produto
- objecao: cliente levantou resistencia — preco, timing, confianca, necessidade
- negociacao: discutindo termos, condicoes, prazo, desconto
- fechamento: definindo proximo passo concreto ou avancando para assinatura${kb}${hist}

=== TRANSCRICAO ATUAL DA CALL ===
${transcript.substring(0, 4000)}

Analise a transcricao. Responda APENAS com o JSON.`;
}

wss.on('connection', async (ws, req) => {
  const params = new URL(req.url, 'http://localhost').searchParams;
  const sessionId = params.get('sessionId') || ('sess_' + Date.now());
  const tokenParam = params.get('token');
  let userId = null;
  if (tokenParam) { const p = verifyToken(tokenParam); if (p) userId = p.id; }

  const session = {
    ws, userId,
    fullTranscript: '',
    knowledge: '',
    insightsEntregues: [],
    speechCount: 0,
    lastInsightAt: 0,
    minIntervalMs: 12000,  // minimo 12s entre analises automaticas
    pendingAnalysis: false
  };
  sessions.set(sessionId, session);
  if (userId) { loadKnowledgeForUser(userId).then(k => { session.knowledge = k; }); }
  console.log('[WS] Iniciada:', sessionId, '| user:', userId, '| total:', wss.clients.size);

  ws.on('message', async (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    switch (msg.type) {
      case 'START_SESSION':
        ws.send(JSON.stringify({ type: 'CONNECTED', sessionId }));
        break;
      case 'TRANSCRIPT_CHUNK': {
        const text = (msg.text || '').trim();
        if (!text || text.length < 8) break;
        session.fullTranscript += ' ' + text;
        session.speechCount++;
        const now = Date.now();
        // Analisa automaticamente apos 4 falas e respeitando o intervalo minimo
        if (session.speechCount >= 4 && (now - session.lastInsightAt) >= session.minIntervalMs && !session.pendingAnalysis) {
          session.pendingAnalysis = true;
          session.lastInsightAt = now;
          analyzeTranscript(session, false).then(insight => {
            session.pendingAnalysis = false;
            if (insight && !insight.skip) {
              session.insightsEntregues.push(insight.insight);
              if (session.insightsEntregues.length > 20) session.insightsEntregues.shift();
              ws.send(JSON.stringify({ type: 'INSIGHT', ...insight }));
            }
          }).catch(err => { session.pendingAnalysis = false; console.error('[WS]', err.message); });
        }
        break;
      }
      case 'REQUEST_SUGGESTION': {
        // Analise sob demanda — vendedor clicou no botao
        if (!session.pendingAnalysis && session.fullTranscript.length > 50) {
          session.pendingAnalysis = true;
          analyzeTranscript(session, true).then(insight => {
            session.pendingAnalysis = false;
            if (!insight || insight.skip) {
              ws.send(JSON.stringify({ type: 'STATUS', message: 'Call fluindo bem. Nenhuma acao critica no momento.' }));
            } else {
              session.insightsEntregues.push(insight.insight);
              ws.send(JSON.stringify({ type: 'INSIGHT', ...insight }));
            }
          }).catch(err => { session.pendingAnalysis = false; });
        }
        break;
      }
      case 'END_SESSION':
        sessions.delete(sessionId);
        break;
    }
  });

  ws.on('close', () => {
    sessions.delete(sessionId);
    console.log('[WS] Encerrada:', sessionId, '| total:', wss.clients.size);
  });
});

async function analyzeTranscript(session, force = false) {
  const slice = force
    ? session.fullTranscript.slice(-2000)   // manual: analisa os ultimos 2000 chars
    : session.fullTranscript.slice(-3000);  // auto: analisa os ultimos 3000 chars
  if (slice.trim().length < 30) return null;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: buildCoachingPrompt(slice, session.knowledge, session.insightsEntregues) }],
    temperature: 0.2,   // baixo: respostas mais precisas e consistentes
    max_tokens: 300
  });

  const raw = completion.choices[0].message.content.trim()
    .replace(/^```json?\n?/, '').replace(/\n?```$/, '');
  try {
    const r = JSON.parse(raw);
    if (r.skip === true) return { skip: true };
    if (!r.insight || !r.momento || !r.alerta) return { skip: true };
    return r;
  } catch { return { skip: true }; }
}

app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});
server.listen(PORT, () => console.log('Server running on port ' + PORT));
