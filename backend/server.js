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

const PORT = process.env.PORT || 3001;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../frontend/dist')));

const sessions = new Map();
const knowledge = { scripts: [], calls: [], summary: '' };
loadKnowledge();

function buildSystemPrompt() {
  return `Voce e um COACH DE VENDAS especialista com mais de 20 anos de experiencia em vendas consultivas, negociacao e fechamento de contratos de alto valor.

Sua missao e EXCLUSIVAMENTE auxiliar o vendedor em tempo real durante uma call, analisando a conversa e gerando insights acionaveis para aumentar a taxa de fechamento.

SUAS CAPACIDADES:
- Identificar o momento exato da venda: rapport, descoberta, apresentacao, objecao, fechamento
- Detectar sinais de compra verbais e emocionais na fala do cliente
- Identificar objecoes ocultas antes que se tornem barreiras
- Sugerir perguntas poderosas baseadas em SPIN Selling, MEDDIC e Challenger Sale
- Reconhecer quando o cliente esta pronto para fechar e como conduzir
- Alertar sobre erros que perdem vendas: falar demais, nao ouvir, pressionar cedo demais

REGRAS DE OURO:
1. Seja CIRURGICO: uma sugestao precisa por vez, nunca listas
2. Seja URGENTE: o insight precisa ser util AGORA, nesta call
3. Seja ESPECIFICO: use as palavras reais do cliente na sua sugestao
4. Nunca repita o mesmo insight duas vezes seguidas
5. Prioridade: Fechamento > Objecao > Sinal de compra > Pergunta de descoberta

FORMATO OBRIGATORIO (JSON):
{
  "momento": "rapport|descoberta|apresentacao|objecao|fechamento",
  "alerta": "perigo|oportunidade|neutro",
  "insight": "A sugestao principal em ate 25 palavras",
  "motivo": "Por que fazer isso agora em ate 15 palavras",
  "pergunta_sugerida": "Uma pergunta exata que o vendedor pode fazer agora ou null"
}`;
}

function buildUserPrompt(transcript, knowledgeSummary, sessionStats) {
  const recentLines = transcript.slice(-15).map(t => t.text).join(' ');
  const fullContext = transcript.slice(-40).map(t => t.text).join(' ');
  return `BASE DE CONHECIMENTO DA EMPRESA:
${knowledgeSummary || 'Nenhum script carregado. Use principios gerais de vendas consultivas.'}

CONTEXTO COMPLETO DA CALL:
${fullContext}

ULTIMO TRECHO (foco principal):
"${recentLines}"

DADOS DA SESSAO:
- Duracao: ${sessionStats.duration} minutos
- Trechos capturados: ${sessionStats.chunks}
- Ultimo insight: ${sessionStats.lastInsight || 'nenhum ainda'}

Analise o ULTIMO TRECHO no contexto da call completa. Gere UM insight cirurgico para o vendedor agora.`;
}

function buildKnowledgeSummaryPrompt(scriptsText, callsText) {
  return `Voce e um especialista em metodologias de vendas. Analise os materiais abaixo e extraia os PADROES DE VENDAS mais importantes.

SCRIPTS DE VENDAS:
${scriptsText || 'Nenhum script disponivel.'}

CALLS VENCEDORAS:
${callsText || 'Nenhuma call de sucesso disponivel.'}

Gere um resumo estruturado com:
1. ABORDAGEM: como iniciar e gerar rapport
2. DESCOBERTA: perguntas-chave para descobrir dores
3. DIFERENCIAIS: o que diferencia o produto segundo os scripts
4. OBJECOES: como contornar as principais objecoes
5. SINAIS DE FECHAMENTO: frases que indicam prontidao para comprar
6. FECHAMENTO: como conduzir o fechamento segundo os materiais

Seja conciso e pratico. Maximo 500 palavras.`;
}

wss.on('connection', (ws, req) => {
  const sessionId = new URL(req.url, 'http://localhost').searchParams.get('sessionId') || generateId();
  console.log('[WS] Nova conexao. Session:', sessionId);
  sessions.set(sessionId, {
    ws, transcript: [], context: [],
    isAnalyzing: false, startTime: Date.now(),
    lastInsight: null, insightCount: 0
  });
  ws.send(JSON.stringify({ type: 'CONNECTED', sessionId }));
  ws.on('message', async (data) => {
    try { const msg = JSON.parse(data); await handleWSMessage(sessionId, msg); }
    catch (err) { console.error('[WS] Erro:', err); }
  });
  ws.on('close', () => { sessions.delete(sessionId); });
});

async function handleWSMessage(sessionId, msg) {
  const session = sessions.get(sessionId);
  if (!session) return;
  switch (msg.type) {
    case 'TRANSCRIPT_CHUNK':
      session.transcript.push({ text: msg.text, timestamp: msg.timestamp || Date.now() });
      if (session.transcript.length % 4 === 0) await generateInsight(sessionId);
      break;
    case 'REQUEST_SUGGESTION':
      await generateInsight(sessionId);
      break;
    case 'START_SESSION':
      session.isAnalyzing = true;
      session.transcript = [];
      session.startTime = Date.now();
      session.lastInsight = null;
      session.insightCount = 0;
      sendToSession(sessionId, { type: 'STATUS', message: 'Coach ativo. Analisando em tempo real...' });
      break;
    case 'END_SESSION':
      session.isAnalyzing = false;
      await saveCallSession(sessionId);
      sendToSession(sessionId, { type: 'STATUS', message: 'Sessao encerrada e salva.' });
      break;
  }
}

async function generateInsight(sessionId) {
  const session = sessions.get(sessionId);
  if (!session || session.transcript.length < 2) return;
  const sessionStats = {
    duration: Math.round((Date.now() - session.startTime) / 60000),
    chunks: session.transcript.length,
    lastInsight: session.lastInsight
  };
  try {
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user', content: buildUserPrompt(session.transcript, knowledge.summary, sessionStats) }
      ],
      max_tokens: 300,
      temperature: 0.4,
      response_format: { type: 'json_object' }
    });
    const raw = response.choices[0]?.message?.content?.trim();
    if (!raw) return;
    let insight;
    try { insight = JSON.parse(raw); }
    catch { insight = { momento: 'descoberta', alerta: 'neutro', insight: raw, motivo: '' }; }
    if (insight.insight === session.lastInsight) return;
    session.lastInsight = insight.insight;
    session.insightCount++;
    sendToSession(sessionId, {
      type: 'INSIGHT',
      momento: insight.momento,
      alerta: insight.alerta,
      insight: insight.insight,
      motivo: insight.motivo,
      pergunta_sugerida: insight.pergunta_sugerida || null,
      count: session.insightCount
    });
    console.log('[AI] Insight #' + session.insightCount + ' [' + insight.momento + '/' + insight.alerta + ']:', insight.insight);
  } catch (err) {
    console.error('[AI] Erro:', err.message);
    sendToSession(sessionId, {
      type: 'INSIGHT', momento: 'descoberta', alerta: 'neutro',
      insight: 'Faca uma pergunta aberta sobre o principal desafio do cliente agora',
      motivo: 'Manter o cliente falando revela oportunidades',
      pergunta_sugerida: 'Qual e o maior desafio que voce enfrenta hoje nessa area?'
    });
  }
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', sessions: sessions.size, knowledge: { scripts: knowledge.scripts.length, calls: knowledge.calls.length }, hasKnowledge: knowledge.summary.length > 0 });
});

app.post('/api/scripts', upload.single('script'), async (req, res) => {
  try {
    const { title, description } = req.body;
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'Arquivo nao enviado' });
    const content = fs.readFileSync(file.path, 'utf-8');
    const script = { id: generateId(), title: title || file.originalname, description: description || '', content, filename: file.filename, uploadedAt: new Date().toISOString() };
    knowledge.scripts.push(script);
    await rebuildKnowledgeSummary();
    saveKnowledge();
    res.json({ success: true, script: { id: script.id, title: script.title } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/calls', upload.single('call'), async (req, res) => {
  try {
    const { title, outcome, notes } = req.body;
    const file = req.file;
    let content = req.body.transcript || '';
    if (file && file.mimetype.startsWith('audio/')) { content = await transcribeAudio(file.path); }
    else if (file) { content = fs.readFileSync(file.path, 'utf-8'); }
    const call = { id: generateId(), title: title || (file ? file.originalname : 'Call sem titulo'), outcome: outcome || 'venda', notes: notes || '', content, filename: file ? file.filename : null, uploadedAt: new Date().toISOString() };
    knowledge.calls.push(call);
    await rebuildKnowledgeSummary();
    saveKnowledge();
    res.json({ success: true, call: { id: call.id, title: call.title } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/scripts', (req, res) => { res.json(knowledge.scripts.map(s => ({ id: s.id, title: s.title, description: s.description, uploadedAt: s.uploadedAt }))); });
app.get('/api/calls', (req, res) => { res.json(knowledge.calls.map(c => ({ id: c.id, title: c.title, outcome: c.outcome, notes: c.notes, uploadedAt: c.uploadedAt }))); });
app.delete('/api/scripts/:id', (req, res) => { knowledge.scripts = knowledge.scripts.filter(s => s.id !== req.params.id); rebuildKnowledgeSummary().then(() => saveKnowledge()); res.json({ success: true }); });
app.delete('/api/calls/:id', (req, res) => { knowledge.calls = knowledge.calls.filter(c => c.id !== req.params.id); rebuildKnowledgeSummary().then(() => saveKnowledge()); res.json({ success: true }); });
app.get('/api/knowledge', (req, res) => { res.json({ summary: knowledge.summary, scripts: knowledge.scripts.length, calls: knowledge.calls.length }); });

app.post('/api/analyze', express.json(), async (req, res) => {
  try {
    const { transcript } = req.body;
    if (!transcript) return res.status(400).json({ error: 'Transcricao nao enviada' });
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user', content: `BASE DE CONHECIMENTO:\n${knowledge.summary || 'Nenhum script carregado.'}\n\nTRANSCRICAO COMPLETA:\n${transcript}\n\nAnalise essa call e retorne JSON com: resumo (3 linhas), momento_final, pontos_fortes (array ate 3), pontos_de_melhoria (array ate 3), probabilidade_fechamento (alta|media|baixa), proximo_passo_recomendado.` }
      ],
      max_tokens: 600, temperature: 0.3, response_format: { type: 'json_object' }
    });
    const analysis = JSON.parse(response.choices[0]?.message?.content || '{}');
    res.json({ success: true, analysis });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

async function rebuildKnowledgeSummary() {
  if (knowledge.scripts.length === 0 && knowledge.calls.length === 0) { knowledge.summary = ''; return; }
  const scriptsText = knowledge.scripts.map(s => 'SCRIPT [' + s.title + ']:\n' + s.content.substring(0, 800)).join('\n\n---\n\n');
  const callsText = knowledge.calls.filter(c => c.outcome === 'venda').map(c => 'CALL VENCEDORA [' + c.title + ']:\n' + c.content.substring(0, 800)).join('\n\n---\n\n');
  try {
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [{ role: 'user', content: buildKnowledgeSummaryPrompt(scriptsText, callsText) }],
      max_tokens: 700, temperature: 0.2
    });
    knowledge.summary = response.choices[0]?.message?.content || '';
    console.log('[Knowledge] Atualizado. Tamanho:', knowledge.summary.length, 'chars');
  } catch (err) { console.error('[Knowledge] Erro:', err.message); knowledge.summary = scriptsText + '\n' + callsText; }
}

async function transcribeAudio(filePath) {
  try {
    const transcription = await openai.audio.transcriptions.create({ file: fs.createReadStream(filePath), model: 'whisper-1', language: 'pt' });
    return transcription.text;
  } catch (err) { console.error('[Whisper] Erro:', err.message); return ''; }
}

async function saveCallSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session || session.transcript.length === 0) return;
  const content = session.transcript.map(t => t.text).join(' ');
  knowledge.calls.push({ id: generateId(), title: 'Call automatica ' + new Date().toLocaleDateString('pt-BR'), outcome: 'automatica', notes: 'Capturada pela extensao Chrome', content, uploadedAt: new Date().toISOString() });
  saveKnowledge();
}

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
  } catch (err) { console.error('[Knowledge] Erro ao carregar:', err.message); }
}

function sendToSession(sessionId, data) {
  const session = sessions.get(sessionId);
  if (session && session.ws.readyState === WebSocket.OPEN) session.ws.send(JSON.stringify(data));
}

function generateId() {
  return Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
}

server.listen(PORT, () => {
  console.log('AI Sales Coach Backend rodando na porta', PORT);
  console.log('WebSocket: ws://localhost:' + PORT);
  console.log('API: http://localhost:' + PORT + '/api');
  console.log('Conhecimento:', knowledge.scripts.length, 'scripts,', knowledge.calls.length, 'calls');
});

module.exports = { app, server };
