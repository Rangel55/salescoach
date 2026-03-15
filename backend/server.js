// backend/server.js
// Servidor principal do AI Sales Coach
// Express REST API + WebSocket Server + OpenAI Integration
// Responsavel por: receber transcricoes, processar com IA e enviar sugestoes em tempo real
require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { OpenAI } = require('openai');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ── Configuracao ────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Storage para uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = file.fieldname === 'script' ? './data/scripts' : './data/calls';
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// ── Middlewares ──────────────────────────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../frontend/dist')));

// ── Estado em memoria (substituir por banco de dados futuramente) ─────────────
const sessions = new Map();     // sessionId -> { ws, transcript, context }
const knowledge = {
  scripts: [],    // Scripts de vendas carregados
  calls: [],      // Calls de sucesso carregadas
  summary: ''     // Resumo consolidado do conhecimento
};

// Carrega conhecimento salvo ao iniciar
loadKnowledge();

// ── WebSocket: Conexao em tempo real com a extensao Chrome ────────────────────
wss.on('connection', (ws, req) => {
  const sessionId = new URL(req.url, 'http://localhost').searchParams.get('sessionId') || generateId();
  console.log('[WS] Nova conexao. Session:', sessionId);

  sessions.set(sessionId, { ws, transcript: [], context: [], isAnalyzing: false });

  ws.send(JSON.stringify({ type: 'CONNECTED', sessionId }));

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data);
      await handleWSMessage(sessionId, msg);
    } catch (err) {
      console.error('[WS] Erro ao processar mensagem:', err);
    }
  });

  ws.on('close', () => {
    console.log('[WS] Conexao encerrada. Session:', sessionId);
    sessions.delete(sessionId);
  });
});

// Processa mensagens WebSocket da extensao
async function handleWSMessage(sessionId, msg) {
  const session = sessions.get(sessionId);
  if (!session) return;

  switch (msg.type) {

    // Transcricao ao vivo chegando da call
    case 'TRANSCRIPT_CHUNK':
      session.transcript.push({ text: msg.text, timestamp: msg.timestamp });
      // A cada 3 chunks, gera uma sugestao
      if (session.transcript.length % 3 === 0) {
        await generateSuggestion(sessionId);
      }
      break;

    // Vendedor pedindo sugestao manual
    case 'REQUEST_SUGGESTION':
      await generateSuggestion(sessionId);
      break;

    // Inicio de sessao
    case 'START_SESSION':
      session.isAnalyzing = true;
      session.transcript = [];
      sendToSession(sessionId, { type: 'STATUS', message: 'Sessao iniciada. Analisando...' });
      break;

    // Fim de sessao
    case 'END_SESSION':
      session.isAnalyzing = false;
      await saveCallSession(sessionId);
      sendToSession(sessionId, { type: 'STATUS', message: 'Sessao encerrada e salva.' });
      break;
  }
}

// Gera sugestao usando OpenAI com base no contexto da call + conhecimento
async function generateSuggestion(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;

  // Pega os ultimos 10 trechos de transcricao
  const recentTranscript = session.transcript
    .slice(-10)
    .map(t => t.text)
    .join(' ');

  if (!recentTranscript.trim()) return;

  try {
    const prompt = buildPrompt(recentTranscript, knowledge.summary);
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200,
      temperature: 0.7
    });

    const suggestion = response.choices[0]?.message?.content?.trim();
    if (suggestion) {
      sendToSession(sessionId, { type: 'SUGGESTION', text: suggestion });
      console.log('[AI] Sugestao gerada:', suggestion);
    }
  } catch (err) {
    console.error('[AI] Erro ao gerar sugestao:', err.message);
    // Fallback: sugestao generica
    sendToSession(sessionId, {
      type: 'SUGGESTION',
      text: 'Explore mais o problema atual do cliente antes de apresentar a solucao'
    });
  }
}

// Monta o prompt para a IA com contexto da call e base de conhecimento
function buildPrompt(transcript, knowledgeSummary) {
  return `Voce e um coach de vendas especialista. Analise a conversa abaixo e sugira UMA acao especifica e direta que o vendedor deve tomar agora.

BASE DE CONHECIMENTO (scripts e calls de sucesso):
${knowledgeSummary || 'Nenhum conhecimento carregado ainda.'}

CONVERSA ATUAL:
${transcript}

Responda com UMA sugestao curta e direta (maximo 20 palavras), no formato:
"[Acao]: [motivo breve]"

Exemplo: "Pergunte sobre o orcamento: o cliente demonstrou interesse real na solucao"`;
}

// Envia mensagem para uma sessao especifica
function sendToSession(sessionId, data) {
  const session = sessions.get(sessionId);
  if (session && session.ws.readyState === WebSocket.OPEN) {
    session.ws.send(JSON.stringify(data));
  }
}

// ── REST API ──────────────────────────────────────────────────────────────────

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', sessions: sessions.size, knowledge: {
    scripts: knowledge.scripts.length,
    calls: knowledge.calls.length
  }});
});

// Upload de script de vendas (PDF, TXT, DOC)
app.post('/api/scripts', upload.single('script'), async (req, res) => {
  try {
    const { title, description } = req.body;
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'Arquivo nao enviado' });

    const content = fs.readFileSync(file.path, 'utf-8');
    const script = {
      id: generateId(),
      title: title || file.originalname,
      description: description || '',
      content,
      filename: file.filename,
      uploadedAt: new Date().toISOString()
    };

    knowledge.scripts.push(script);
    await rebuildKnowledgeSummary();
    saveKnowledge();

    res.json({ success: true, script: { id: script.id, title: script.title } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upload de call gravada que gerou venda (audio transcrito ou texto)
app.post('/api/calls', upload.single('call'), async (req, res) => {
  try {
    const { title, outcome, notes } = req.body;
    const file = req.file;

    let content = req.body.transcript || '';

    // Se for arquivo de audio, transcreve com Whisper
    if (file && file.mimetype.startsWith('audio/')) {
      content = await transcribeAudio(file.path);
    } else if (file) {
      content = fs.readFileSync(file.path, 'utf-8');
    }

    const call = {
      id: generateId(),
      title: title || (file ? file.originalname : 'Call sem titulo'),
      outcome: outcome || 'venda',  // 'venda', 'perdida', 'follow-up'
      notes: notes || '',
      content,
      filename: file ? file.filename : null,
      uploadedAt: new Date().toISOString()
    };

    knowledge.calls.push(call);
    await rebuildKnowledgeSummary();
    saveKnowledge();

    res.json({ success: true, call: { id: call.id, title: call.title } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Lista scripts
app.get('/api/scripts', (req, res) => {
  res.json(knowledge.scripts.map(s => ({
    id: s.id, title: s.title, description: s.description, uploadedAt: s.uploadedAt
  })));
});

// Lista calls
app.get('/api/calls', (req, res) => {
  res.json(knowledge.calls.map(c => ({
    id: c.id, title: c.title, outcome: c.outcome, notes: c.notes, uploadedAt: c.uploadedAt
  })));
});

// Remove script
app.delete('/api/scripts/:id', (req, res) => {
  knowledge.scripts = knowledge.scripts.filter(s => s.id !== req.params.id);
  rebuildKnowledgeSummary().then(() => { saveKnowledge(); });
  res.json({ success: true });
});

// Remove call
app.delete('/api/calls/:id', (req, res) => {
  knowledge.calls = knowledge.calls.filter(c => c.id !== req.params.id);
  rebuildKnowledgeSummary().then(() => { saveKnowledge(); });
  res.json({ success: true });
});

// Retorna o resumo de conhecimento atual
app.get('/api/knowledge', (req, res) => {
  res.json({ summary: knowledge.summary, scripts: knowledge.scripts.length, calls: knowledge.calls.length });
});

// ── Processamento de Conhecimento ─────────────────────────────────────────────

// Reconstroi o resumo de conhecimento usando OpenAI
async function rebuildKnowledgeSummary() {
  if (knowledge.scripts.length === 0 && knowledge.calls.length === 0) {
    knowledge.summary = '';
    return;
  }

  const scriptsText = knowledge.scripts.map(s =>
    'SCRIPT [' + s.title + ']:\n' + s.content.substring(0, 500)
  ).join('\n\n');

  const callsText = knowledge.calls.filter(c => c.outcome === 'venda').map(c =>
    'CALL VENCEDORA [' + c.title + ']:\n' + c.content.substring(0, 500)
  ).join('\n\n');

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content: `Resuma os principais padroes de vendas encontrados nesses materiais para um coach de vendas usar em tempo real. Seja conciso (max 300 palavras):\n\n${scriptsText}\n\n${callsText}`
      }],
      max_tokens: 400
    });
    knowledge.summary = response.choices[0]?.message?.content || '';
    console.log('[Knowledge] Resumo atualizado.');
  } catch (err) {
    console.error('[Knowledge] Erro ao resumir:', err.message);
    knowledge.summary = scriptsText + '\n' + callsText;
  }
}

// Transcreve audio com Whisper
async function transcribeAudio(filePath) {
  try {
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: 'whisper-1',
      language: 'pt'
    });
    return transcription.text;
  } catch (err) {
    console.error('[Whisper] Erro:', err.message);
    return '';
  }
}

// Salva call da sessao como aprendizado
async function saveCallSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session || session.transcript.length === 0) return;
  const content = session.transcript.map(t => t.text).join(' ');
  const call = {
    id: generateId(), title: 'Call automatica ' + new Date().toLocaleDateString('pt-BR'),
    outcome: 'automatica', notes: 'Capturada automaticamente pela extensao', content,
    uploadedAt: new Date().toISOString()
  };
  knowledge.calls.push(call);
  saveKnowledge();
}

// ── Persistencia ──────────────────────────────────────────────────────────────
function saveKnowledge() {
  fs.mkdirSync('./data', { recursive: true });
  fs.writeFileSync('./data/knowledge.json', JSON.stringify({ scripts: knowledge.scripts, calls: knowledge.calls, summary: knowledge.summary }, null, 2));
}

function loadKnowledge() {
  try {
    if (fs.existsSync('./data/knowledge.json')) {
      const data = JSON.parse(fs.readFileSync('./data/knowledge.json', 'utf-8'));
      knowledge.scripts = data.scripts || [];
      knowledge.calls = data.calls || [];
      knowledge.summary = data.summary || '';
      console.log('[Knowledge] Carregado:', knowledge.scripts.length, 'scripts,', knowledge.calls.length, 'calls');
    }
  } catch (err) {
    console.error('[Knowledge] Erro ao carregar:', err.message);
  }
}

// ── Utilitarios ───────────────────────────────────────────────────────────────
function generateId() {
  return Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
}

// ── Start ─────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log('AI Sales Coach Backend rodando na porta', PORT);
  console.log('WebSocket: ws://localhost:' + PORT);
  console.log('API: http://localhost:' + PORT + '/api');
});

module.exports = { app, server };
