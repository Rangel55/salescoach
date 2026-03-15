(function () {
  'use strict';

  let API_URL = localStorage.getItem('asc_api_url') || 'http://localhost:3001';
  let TOKEN = localStorage.getItem('asc_token') || null;
  let CURRENT_USER = null;

  // ── Funcoes globais (chamadas inline no HTML) ────────────────────────────
  window.showRegister = () => { document.getElementById('login-form').classList.add('hidden'); document.getElementById('register-form').classList.remove('hidden'); };
  window.showLogin = () => { document.getElementById('register-form').classList.add('hidden'); document.getElementById('login-form').classList.remove('hidden'); };
  window.togglePass = (id, btn) => {
    const el = document.getElementById(id);
    if (el.type === 'password') { el.type = 'text'; btn.textContent = '🙈'; }
    else { el.type = 'password'; btn.textContent = '👁'; }
  };

  // ── Init ─────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    initAuth();
  });

  function initAuth() {
    if (TOKEN) {
      verifyTokenAndLoad();
    } else {
      showAuthScreen();
    }
    document.getElementById('login-btn').addEventListener('click', doLogin);
    document.getElementById('register-btn').addEventListener('click', doRegister);
    document.getElementById('login-password').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
    document.getElementById('login-email').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('login-password').focus(); });
  }

  async function verifyTokenAndLoad() {
    try {
      const res = await apiFetch('/api/auth/me');
      CURRENT_USER = res.user;
      showApp();
    } catch {
      TOKEN = null;
      localStorage.removeItem('asc_token');
      showAuthScreen();
    }
  }

  function showAuthScreen() {
    document.getElementById('auth-screen').classList.remove('hidden');
    document.getElementById('app-screen').classList.add('hidden');
  }

  function showApp() {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('app-screen').classList.remove('hidden');
    if (CURRENT_USER) {
      document.getElementById('user-name').textContent = CURRENT_USER.name;
      document.getElementById('user-avatar').textContent = CURRENT_USER.name.charAt(0).toUpperCase();
      const emailEl = document.getElementById('account-email');
      if (emailEl) emailEl.textContent = CURRENT_USER.email;
    }
    initApp();
  }

  // ── Login ────────────────────────────────────────────────────────────────
  async function doLogin() {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const errEl = document.getElementById('login-error');
    errEl.classList.add('hidden');
    if (!email || !password) { showAuthError('login-error', 'Preencha email e senha'); return; }
    setLoading('login-btn', true);
    try {
      const res = await fetch(API_URL + '/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (!res.ok) { showAuthError('login-error', data.error || 'Erro ao entrar'); return; }
      TOKEN = data.token;
      CURRENT_USER = data.user;
      localStorage.setItem('asc_token', TOKEN);
      showApp();
    } catch { showAuthError('login-error', 'Nao foi possivel conectar ao servidor. Verifique se o backend esta rodando.'); }
    finally { setLoading('login-btn', false); }
  }

  // ── Register ─────────────────────────────────────────────────────────────
  async function doRegister() {
    const name = document.getElementById('reg-name').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;
    const password2 = document.getElementById('reg-password2').value;
    if (!name || !email || !password) { showAuthError('register-error', 'Preencha todos os campos'); return; }
    if (password !== password2) { showAuthError('register-error', 'As senhas nao conferem'); return; }
    if (password.length < 6) { showAuthError('register-error', 'Senha deve ter pelo menos 6 caracteres'); return; }
    setLoading('register-btn', true);
    try {
      const res = await fetch(API_URL + '/api/auth/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password })
      });
      const data = await res.json();
      if (!res.ok) { showAuthError('register-error', data.error || 'Erro ao criar conta'); return; }
      TOKEN = data.token;
      CURRENT_USER = data.user;
      localStorage.setItem('asc_token', TOKEN);
      showApp();
    } catch { showAuthError('register-error', 'Nao foi possivel conectar ao servidor.'); }
    finally { setLoading('register-btn', false); }
  }

  function showAuthError(id, msg) {
    const el = document.getElementById(id);
    el.textContent = '❌ ' + msg;
    el.classList.remove('hidden');
  }

  // ── App Principal ─────────────────────────────────────────────────────────
  function initApp() {
    initNavigation();
    initScriptForm();
    initCallForm();
    initAnalyzeForm();
    initSettings();
    initInputToggles();
    initLogout();
    loadDashboard();
    checkServerStatus();
    setInterval(checkServerStatus, 30000);
  }

  function initLogout() {
    const doLogout = () => {
      TOKEN = null; CURRENT_USER = null;
      localStorage.removeItem('asc_token');
      showAuthScreen();
    };
    document.getElementById('logout-btn').addEventListener('click', e => { e.preventDefault(); doLogout(); });
    const s = document.getElementById('logout-btn-settings');
    if (s) s.addEventListener('click', doLogout);
  }

  // ── Navegacao ─────────────────────────────────────────────────────────────
  function initNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', e => {
        e.preventDefault();
        switchTab(item.dataset.tab);
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        item.classList.add('active');
      });
    });
    document.getElementById('refresh-btn').addEventListener('click', () => {
      const active = document.querySelector('.tab-content.active').id.replace('tab-', '');
      loadTab(active);
    });
  }

  function switchTab(tab) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.getElementById('tab-' + tab).classList.add('active');
    const titles = { dashboard: 'Dashboard', scripts: 'Scripts de Vendas', calls: 'Calls de Sucesso', analyze: 'Analisar Transcricao', knowledge: 'Base de Conhecimento', extension: 'Extensao Chrome', settings: 'Configuracoes' };
    document.getElementById('page-title').textContent = titles[tab] || tab;
    loadTab(tab);
  }

  function loadTab(tab) {
    const map = { dashboard: loadDashboard, scripts: loadScripts, calls: loadCalls, knowledge: loadKnowledge, settings: loadSettings };
    if (map[tab]) map[tab]();
  }

  // ── Input Toggles ─────────────────────────────────────────────────────────
  function initInputToggles() {
    setupToggle(['script-toggle-text','script-toggle-file'], ['script-input-text','script-input-file']);
    setupToggle(['call-toggle-text','call-toggle-file','call-toggle-audio'], ['call-input-text','call-input-file','call-input-audio']);
    setupToggle(['analyze-toggle-text','analyze-toggle-file'], ['analyze-input-text','analyze-input-file']);
    setupFileDrop('script-file-drop','script-file', text => { document.getElementById('script-content').value = text; });
    setupFileDrop('call-file-drop','call-file-txt', text => { document.getElementById('call-content').value = text; });
    setupFileDrop('call-audio-drop','call-file-audio', null, true);
    setupFileDrop('analyze-file-drop','analyze-file', text => { document.getElementById('analyze-content').value = text; });
  }

  function setupToggle(btnIds, elIds) {
    const btns = btnIds.map(id => document.getElementById(id)).filter(Boolean);
    const els = elIds.map(id => document.getElementById(id)).filter(Boolean);
    btns.forEach((btn, i) => {
      btn.addEventListener('click', () => {
        btns.forEach(b => b.classList.remove('active'));
        els.forEach(e => e.classList.remove('active'));
        btn.classList.add('active');
        if (els[i]) els[i].classList.add('active');
      });
    });
  }

  function setupFileDrop(dropId, inputId, onText, isAudio = false) {
    const drop = document.getElementById(dropId), input = document.getElementById(inputId);
    if (!drop || !input) return;
    drop.addEventListener('click', () => input.click());
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('dragover'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
    drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('dragover'); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0], onText, isAudio, drop); });
    input.addEventListener('change', () => { if (input.files[0]) handleFile(input.files[0], onText, isAudio, drop); });
  }

  function handleFile(file, onText, isAudio, drop) {
    if (isAudio || file.type.startsWith('audio/')) {
      drop.querySelector('.file-drop-text').textContent = '🎙️ ' + file.name;
      drop.querySelector('.file-drop-sub').textContent = (file.size/1024/1024).toFixed(1) + ' MB';
      drop._audioFile = file;
      return;
    }
    const reader = new FileReader();
    reader.onload = e => {
      if (onText) onText(e.target.result);
      drop.querySelector('.file-drop-text').textContent = '✅ ' + file.name;
      toast('Arquivo carregado!', 'success');
    };
    reader.readAsText(file);
  }

  // ── Dashboard ─────────────────────────────────────────────────────────────
  async function loadDashboard() {
    try {
      const [health, knowledge] = await Promise.all([apiFetch('/api/health'), apiFetch('/api/knowledge')]);
      document.getElementById('stat-scripts').textContent = health.knowledge?.scripts || 0;
      document.getElementById('stat-calls').textContent = health.knowledge?.calls || 0;
      document.getElementById('stat-sessions').textContent = health.sessions || 0;
      document.getElementById('stat-knowledge').textContent = knowledge.summary ? 'Pronta ✅' : 'Vazia';
      document.getElementById('knowledge-summary').textContent = knowledge.summary || 'Nenhum conhecimento. Adicione scripts e calls para comecar.';
    } catch { document.getElementById('knowledge-summary').textContent = 'Erro ao carregar. Verifique o backend.'; }
    const btn = document.getElementById('rebuild-btn');
    if (btn) btn.onclick = rebuildKnowledge;
  }

  // ── Scripts ───────────────────────────────────────────────────────────────
  function initScriptForm() {
    document.getElementById('script-form').addEventListener('submit', async e => {
      e.preventDefault();
      const title = document.getElementById('script-title').value.trim();
      const description = document.getElementById('script-desc').value.trim();
      const content = document.getElementById('script-content').value.trim();
      const fileInput = document.getElementById('script-file');
      if (!title) { toast('Preencha o titulo', 'error'); return; }
      if (!content && !fileInput.files[0]) { toast('Adicione o conteudo do script', 'error'); return; }
      setLoading('script-submit-btn', true);
      try {
        const fd = new FormData();
        fd.append('title', title); fd.append('description', description);
        if (fileInput.files[0]) fd.append('script', fileInput.files[0]);
        else fd.append('script', new Blob([content], { type: 'text/plain' }), title + '.txt');
        await apiPost('/api/scripts', fd);
        toast('Script salvo! IA aprendendo...', 'success');
        document.getElementById('script-form').reset();
        loadScripts(); loadDashboard();
      } catch (err) { toast('Erro: ' + err.message, 'error'); }
      finally { setLoading('script-submit-btn', false); }
    });
  }

  async function loadScripts() {
    try {
      const scripts = await apiFetch('/api/scripts');
      const list = document.getElementById('scripts-list');
      const countEl = document.getElementById('scripts-count');
      if (countEl) countEl.textContent = scripts.length;
      list.innerHTML = !scripts.length ? '<div class="empty-state">Nenhum script cadastrado.</div>'
        : scripts.map(s => `<div class="item-card"><div class="item-info"><div class="item-title">📋 ${esc(s.title)}</div><div class="item-meta">${esc(s.description||'Sem descricao')} &bull; ${formatDate(s.uploadedAt)}</div></div><button class="btn btn-sm btn-danger" onclick="window.deleteScript('${s.id}')">🗑️</button></div>`).join('');
    } catch { document.getElementById('scripts-list').innerHTML = '<div class="empty-state">Erro ao carregar.</div>'; }
  }
  window.deleteScript = async id => { if (!confirm('Remover?')) return; await apiDelete('/api/scripts/'+id); toast('Removido','success'); loadScripts(); loadDashboard(); };

  // ── Calls ─────────────────────────────────────────────────────────────────
  function initCallForm() {
    document.getElementById('call-form').addEventListener('submit', async e => {
      e.preventDefault();
      const title = document.getElementById('call-title').value.trim();
      const outcome = document.getElementById('call-outcome').value;
      const notes = document.getElementById('call-notes').value.trim();
      const content = document.getElementById('call-content').value.trim();
      const fileTxt = document.getElementById('call-file-txt');
      const fileAudio = document.getElementById('call-file-audio');
      if (!title) { toast('Preencha o titulo', 'error'); return; }
      const hasContent = content || (fileTxt.files&&fileTxt.files[0]) || (fileAudio.files&&fileAudio.files[0]);
      if (!hasContent) { toast('Adicione a transcricao ou audio', 'error'); return; }
      setLoading('call-submit-btn', true);
      try {
        const fd = new FormData();
        fd.append('title', title); fd.append('outcome', outcome); fd.append('notes', notes);
        if (fileAudio.files&&fileAudio.files[0]) fd.append('call', fileAudio.files[0]);
        else if (fileTxt.files&&fileTxt.files[0]) fd.append('call', fileTxt.files[0]);
        else fd.append('call', new Blob([content],{type:'text/plain'}), title+'.txt');
        await apiPost('/api/calls', fd);
        toast('Call salva! IA aprendendo...', 'success');
        document.getElementById('call-form').reset();
        loadCalls(); loadDashboard();
      } catch (err) { toast('Erro: ' + err.message, 'error'); }
      finally { setLoading('call-submit-btn', false); }
    });
  }

  async function loadCalls() {
    try {
      const calls = await apiFetch('/api/calls');
      const list = document.getElementById('calls-list');
      const countEl = document.getElementById('calls-count');
      if (countEl) countEl.textContent = calls.length;
      const badges = {venda:'badge-venda',perdida:'badge-perdida','follow-up':'badge-follow-up',automatica:'badge-automatica'};
      const labels = {venda:'✅ Venda',perdida:'❌ Perdida','follow-up':'📅 Follow-up',automatica:'🤖 Auto'};
      list.innerHTML = !calls.length ? '<div class="empty-state">Nenhuma call cadastrada.</div>'
        : calls.map(c => `<div class="item-card"><div class="item-info"><div class="item-title">🎧 ${esc(c.title)}</div><div class="item-meta">${esc(c.notes||'Sem notas')} &bull; ${formatDate(c.uploadedAt)}</div></div><div style="display:flex;gap:8px;align-items:center"><span class="item-badge ${badges[c.outcome]||''}">${labels[c.outcome]||c.outcome}</span><button class="btn btn-sm btn-danger" onclick="window.deleteCall('${c.id}')">🗑️</button></div></div>`).join('');
    } catch { document.getElementById('calls-list').innerHTML = '<div class="empty-state">Erro ao carregar.</div>'; }
  }
  window.deleteCall = async id => { if (!confirm('Remover?')) return; await apiDelete('/api/calls/'+id); toast('Removido','success'); loadCalls(); loadDashboard(); };

  // ── Analisar ──────────────────────────────────────────────────────────────
  function initAnalyzeForm() {
    document.getElementById('analyze-btn').addEventListener('click', async () => {
      const content = document.getElementById('analyze-content').value.trim();
      if (!content || content.length < 100) { toast('Adicione uma transcricao mais completa', 'error'); return; }
      setLoading('analyze-btn', true);
      document.getElementById('analyze-result').classList.add('hidden');
      try {
        const res = await apiJSON('/api/analyze', { transcript: content });
        if (res.success) renderAnalysis(res.analysis);
        else toast('Erro: ' + (res.error||'desconhecido'), 'error');
      } catch (err) { toast('Erro: ' + err.message, 'error'); }
      finally { setLoading('analyze-btn', false); }
    });
  }

  function renderAnalysis(a) {
    document.getElementById('result-resumo').textContent = a.resumo||'-';
    document.getElementById('result-momento').textContent = a.momento_final||'-';
    document.getElementById('result-pontos-fortes').innerHTML = (a.pontos_fortes||[]).map(p=>`<li>${esc(p)}</li>`).join('')||'<li>Nenhum</li>';
    document.getElementById('result-pontos-melhoria').innerHTML = (a.pontos_de_melhoria||[]).map(p=>`<li>${esc(p)}</li>`).join('')||'<li>Nenhum</li>';
    const prob = a.probabilidade_fechamento||'media';
    document.getElementById('result-probabilidade').textContent = {alta:'🟢 Alta',media:'🟡 Media',baixa:'🔴 Baixa'}[prob]||prob;
    document.getElementById('prob-card').className = 'prob-card prob-'+prob;
    document.getElementById('result-proximo-passo').textContent = a.proximo_passo_recomendado||'-';
    document.getElementById('analyze-result').classList.remove('hidden');
    document.getElementById('analyze-result').scrollIntoView({behavior:'smooth'});
  }

  // ── Knowledge ─────────────────────────────────────────────────────────────
  async function loadKnowledge() {
    try {
      const data = await apiFetch('/api/knowledge');
      const el = document.getElementById('knowledge-summary-2');
      if (el) el.textContent = data.summary || 'Nenhum resumo. Adicione scripts e calls.';
    } catch {}
    const btn = document.getElementById('rebuild-btn-2');
    if (btn) btn.onclick = rebuildKnowledge;
  }

  async function rebuildKnowledge() {
    toast('Reprocessando...', 'success');
    await loadDashboard(); await loadKnowledge();
    toast('Base atualizada!', 'success');
  }

  // ── Settings ──────────────────────────────────────────────────────────────
  function loadSettings() {
    document.getElementById('backend-url').value = API_URL;
    document.getElementById('ws-url').value = localStorage.getItem('asc_ws_url')||'ws://localhost:3001';
  }

  function initSettings() {
    document.getElementById('save-settings-btn').addEventListener('click', () => {
      API_URL = document.getElementById('backend-url').value.trim();
      localStorage.setItem('asc_api_url', API_URL);
      localStorage.setItem('asc_ws_url', document.getElementById('ws-url').value.trim());
      toast('Salvo!', 'success');
      checkServerStatus();
    });
    document.getElementById('test-connection-btn').addEventListener('click', async () => {
      const result = document.getElementById('connection-result');
      try {
        const data = await apiFetch('/api/health');
        result.className = 'connection-result success';
        result.textContent = '✅ Conectado! Scripts: ' + data.knowledge?.scripts + ', Calls: ' + data.knowledge?.calls;
      } catch {
        result.className = 'connection-result error';
        result.textContent = '❌ Falha. Backend offline em ' + API_URL;
      }
    });
  }

  // ── Server Status ─────────────────────────────────────────────────────────
  async function checkServerStatus() {
    const el = document.getElementById('server-status');
    try {
      await fetch(API_URL + '/api/health');
      el.innerHTML = '<span class="status-dot status-dot--online"></span><span>Backend online</span>';
    } catch {
      el.innerHTML = '<span class="status-dot status-dot--offline"></span><span>Backend offline</span>';
    }
  }

  // ── API Helpers ───────────────────────────────────────────────────────────
  async function apiFetch(path) {
    const res = await fetch(API_URL + path, { headers: TOKEN ? { 'Authorization': 'Bearer ' + TOKEN } : {} });
    if (res.status === 401) { TOKEN = null; localStorage.removeItem('asc_token'); showAuthScreen(); throw new Error('Sessao expirada'); }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  async function apiPost(path, body) {
    const res = await fetch(API_URL + path, { method: 'POST', headers: TOKEN ? { 'Authorization': 'Bearer ' + TOKEN } : {}, body });
    if (res.status === 401) { TOKEN = null; localStorage.removeItem('asc_token'); showAuthScreen(); throw new Error('Sessao expirada'); }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  async function apiJSON(path, body) {
    const res = await fetch(API_URL + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(TOKEN ? {'Authorization':'Bearer '+TOKEN} : {}) }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  async function apiDelete(path) {
    const res = await fetch(API_URL + path, { method: 'DELETE', headers: TOKEN ? { 'Authorization': 'Bearer ' + TOKEN } : {} });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  // ── Utils ─────────────────────────────────────────────────────────────────
  function setLoading(btnId, loading) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.querySelector('.btn-text')?.classList.toggle('hidden', loading);
    btn.querySelector('.btn-loading')?.classList.toggle('hidden', !loading);
    btn.disabled = loading;
  }
  function esc(str) { return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function formatDate(iso) { if (!iso) return ''; return new Date(iso).toLocaleDateString('pt-BR'); }
  function toast(msg, type='success') {
    const el = document.createElement('div');
    el.className = 'toast '+type; el.textContent = msg;
    document.getElementById('toast-container').appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }

})();
