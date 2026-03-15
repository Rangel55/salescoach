(function () {
  'use strict';

  let API_URL = localStorage.getItem('asc_api_url') || 'http://localhost:3001';

  document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initScriptForm();
    initCallForm();
    initAnalyzeForm();
    initSettings();
    initInputToggles();
    loadDashboard();
    checkServerStatus();
    setInterval(checkServerStatus, 30000);
  });

  // ── Navegacao ──────────────────────────────────────────────────────────────
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
    const titles = { dashboard: 'Dashboard', scripts: 'Scripts de Vendas', calls: 'Calls de Sucesso', analyze: 'Analisar Transcricao', knowledge: 'Base de Conhecimento', settings: 'Configuracoes' };
    document.getElementById('page-title').textContent = titles[tab] || tab;
    loadTab(tab);
  }

  function loadTab(tab) {
    const map = { dashboard: loadDashboard, scripts: loadScripts, calls: loadCalls, knowledge: loadKnowledge, settings: loadSettings };
    if (map[tab]) map[tab]();
  }

  // ── Input Toggles ──────────────────────────────────────────────────────────
  function initInputToggles() {
    setupToggle('script-toggle-text', 'script-toggle-file', null, 'script-input-text', 'script-input-file', null);
    setupToggle('call-toggle-text', 'call-toggle-file', 'call-toggle-audio', 'call-input-text', 'call-input-file', 'call-input-audio');
    setupToggle('analyze-toggle-text', 'analyze-toggle-file', null, 'analyze-input-text', 'analyze-input-file', null);

    setupFileDrop('script-file-drop', 'script-file', 'script-file-preview', text => {
      document.getElementById('script-content').value = text;
    });
    setupFileDrop('call-file-drop', 'call-file-txt', 'call-file-preview', text => {
      document.getElementById('call-content').value = text;
    });
    setupFileDrop('call-audio-drop', 'call-file-audio', 'call-audio-preview', null, true);
    setupFileDrop('analyze-file-drop', 'analyze-file', null, text => {
      document.getElementById('analyze-content').value = text;
    });
  }

  function setupToggle(idText, idFile, idAudio, elText, elFile, elAudio) {
    const btns = [idText, idFile, idAudio].filter(Boolean).map(id => document.getElementById(id));
    const els = [elText, elFile, elAudio].filter(Boolean).map(id => document.getElementById(id));
    btns.forEach((btn, i) => {
      if (!btn) return;
      btn.addEventListener('click', () => {
        btns.forEach(b => b && b.classList.remove('active'));
        els.forEach(e => e && e.classList.remove('active'));
        btn.classList.add('active');
        els[i] && els[i].classList.add('active');
      });
    });
  }

  function setupFileDrop(dropId, inputId, previewId, onText, isAudio = false) {
    const drop = document.getElementById(dropId);
    const input = document.getElementById(inputId);
    if (!drop || !input) return;

    drop.addEventListener('click', () => input.click());
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('dragover'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
    drop.addEventListener('drop', e => {
      e.preventDefault();
      drop.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file, previewId, onText, isAudio, drop);
    });
    input.addEventListener('change', () => {
      if (input.files[0]) handleFile(input.files[0], previewId, onText, isAudio, drop);
    });
  }

  function handleFile(file, previewId, onText, isAudio, drop) {
    if (isAudio || file.type.startsWith('audio/')) {
      drop.querySelector('.file-drop-text').textContent = '🎙️ ' + file.name;
      drop.querySelector('.file-drop-sub').textContent = (file.size / 1024 / 1024).toFixed(1) + ' MB - sera transcrito pelo Whisper';
      drop.dataset.audioFile = file.name;
      drop._audioFile = file;
      return;
    }
    const reader = new FileReader();
    reader.onload = e => {
      if (onText) onText(e.target.result);
      if (previewId) {
        const prev = document.getElementById(previewId);
        if (prev) {
          prev.textContent = '📄 ' + file.name + ' (' + (file.size / 1024).toFixed(1) + ' KB) carregado';
          prev.classList.remove('hidden');
        }
      }
      drop.querySelector('.file-drop-text').textContent = '✅ ' + file.name;
      toast('Arquivo carregado com sucesso!', 'success');
    };
    reader.readAsText(file);
  }

  // ── Dashboard ──────────────────────────────────────────────────────────────
  async function loadDashboard() {
    try {
      const [health, knowledge] = await Promise.all([api('/api/health'), api('/api/knowledge')]);
      document.getElementById('stat-scripts').textContent = health.knowledge?.scripts || 0;
      document.getElementById('stat-calls').textContent = health.knowledge?.calls || 0;
      document.getElementById('stat-sessions').textContent = health.sessions || 0;
      document.getElementById('stat-knowledge').textContent = knowledge.summary ? 'Pronta ✅' : 'Vazia';
      document.getElementById('knowledge-summary').textContent = knowledge.summary || 'Nenhum conhecimento carregado. Adicione scripts e calls para comecar.';
    } catch {
      document.getElementById('knowledge-summary').textContent = 'Backend offline. Inicie o servidor para ver os dados.';
    }
    const btn = document.getElementById('rebuild-btn');
    if (btn) btn.onclick = rebuildKnowledge;
  }

  // ── Scripts ────────────────────────────────────────────────────────────────
  function initScriptForm() {
    document.getElementById('script-form').addEventListener('submit', async e => {
      e.preventDefault();
      const title = document.getElementById('script-title').value.trim();
      const description = document.getElementById('script-desc').value.trim();
      const content = document.getElementById('script-content').value.trim();
      const fileInput = document.getElementById('script-file');
      if (!title) { toast('Preencha o titulo do script', 'error'); return; }
      if (!content && !fileInput.files[0]) { toast('Adicione o conteudo do script (texto ou arquivo)', 'error'); return; }
      setLoading('script-submit-btn', true);
      try {
        const formData = new FormData();
        formData.append('title', title);
        formData.append('description', description);
        if (fileInput.files[0]) {
          formData.append('script', fileInput.files[0]);
        } else {
          formData.append('script', new Blob([content], { type: 'text/plain' }), title + '.txt');
        }
        await apiPost('/api/scripts', formData);
        toast('Script salvo! A IA esta aprendendo...', 'success');
        document.getElementById('script-form').reset();
        document.querySelectorAll('#tab-scripts .file-drop-text').forEach(el => el.textContent = 'Arraste um arquivo .txt ou .md aqui');
        loadScripts();
        loadDashboard();
      } catch (err) {
        toast('Erro ao salvar: ' + err.message, 'error');
      } finally {
        setLoading('script-submit-btn', false);
      }
    });
  }

  async function loadScripts() {
    try {
      const scripts = await api('/api/scripts');
      const list = document.getElementById('scripts-list');
      const countEl = document.getElementById('scripts-count');
      if (countEl) countEl.textContent = scripts.length;
      if (!scripts.length) { list.innerHTML = '<div class="empty-state">Nenhum script cadastrado ainda.</div>'; return; }
      list.innerHTML = scripts.map(s => `
        <div class="item-card">
          <div class="item-info">
            <div class="item-title">📋 ${esc(s.title)}</div>
            <div class="item-meta">${esc(s.description || 'Sem descricao')} &bull; ${formatDate(s.uploadedAt)}</div>
          </div>
          <button class="btn btn-sm btn-danger" onclick="window.deleteScript('${s.id}')">🗑️</button>
        </div>`).join('');
    } catch { document.getElementById('scripts-list').innerHTML = '<div class="empty-state">Erro ao carregar. Verifique o backend.</div>'; }
  }

  window.deleteScript = async id => {
    if (!confirm('Remover este script? A base de conhecimento sera atualizada.')) return;
    await apiDelete('/api/scripts/' + id);
    toast('Script removido', 'success');
    loadScripts(); loadDashboard();
  };

  // ── Calls ──────────────────────────────────────────────────────────────────
  function initCallForm() {
    document.getElementById('call-form').addEventListener('submit', async e => {
      e.preventDefault();
      const title = document.getElementById('call-title').value.trim();
      const outcome = document.getElementById('call-outcome').value;
      const notes = document.getElementById('call-notes').value.trim();
      const content = document.getElementById('call-content').value.trim();
      const fileTxt = document.getElementById('call-file-txt');
      const fileAudio = document.getElementById('call-file-audio');
      if (!title) { toast('Preencha o titulo da call', 'error'); return; }
      const hasContent = content || (fileTxt.files && fileTxt.files[0]) || (fileAudio.files && fileAudio.files[0]);
      if (!hasContent) { toast('Adicione a transcricao ou arquivo de audio', 'error'); return; }
      setLoading('call-submit-btn', true);
      if (fileAudio.files && fileAudio.files[0]) {
        const btn = document.getElementById('call-submit-btn');
        btn.querySelector('.btn-loading').textContent = '⏳ Transcrevendo audio com Whisper...';
      }
      try {
        const formData = new FormData();
        formData.append('title', title);
        formData.append('outcome', outcome);
        formData.append('notes', notes);
        if (fileAudio.files && fileAudio.files[0]) {
          formData.append('call', fileAudio.files[0]);
        } else if (fileTxt.files && fileTxt.files[0]) {
          formData.append('call', fileTxt.files[0]);
        } else {
          formData.append('call', new Blob([content], { type: 'text/plain' }), title + '.txt');
        }
        await apiPost('/api/calls', formData);
        toast('Call salva! A IA esta aprendendo com ela...', 'success');
        document.getElementById('call-form').reset();
        loadCalls(); loadDashboard();
      } catch (err) {
        toast('Erro ao salvar: ' + err.message, 'error');
      } finally {
        setLoading('call-submit-btn', false);
        const btn = document.getElementById('call-submit-btn');
        if (btn) btn.querySelector('.btn-loading').textContent = '⏳ Processando e transcrevendo...';
      }
    });
  }

  async function loadCalls() {
    try {
      const calls = await api('/api/calls');
      const list = document.getElementById('calls-list');
      const countEl = document.getElementById('calls-count');
      if (countEl) countEl.textContent = calls.length;
      if (!calls.length) { list.innerHTML = '<div class="empty-state">Nenhuma call cadastrada ainda.</div>'; return; }
      const badges = { venda: 'badge-venda', perdida: 'badge-perdida', 'follow-up': 'badge-follow-up', automatica: 'badge-automatica' };
      const labels = { venda: '✅ Venda Fechada', perdida: '❌ Perdida', 'follow-up': '📅 Follow-up', automatica: '🤖 Automatica' };
      list.innerHTML = calls.map(c => `
        <div class="item-card">
          <div class="item-info">
            <div class="item-title">🎧 ${esc(c.title)}</div>
            <div class="item-meta">${esc(c.notes || 'Sem notas')} &bull; ${formatDate(c.uploadedAt)}</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-shrink:0">
            <span class="item-badge ${badges[c.outcome] || ''}">${labels[c.outcome] || c.outcome}</span>
            <button class="btn btn-sm btn-danger" onclick="window.deleteCall('${c.id}')">🗑️</button>
          </div>
        </div>`).join('');
    } catch { document.getElementById('calls-list').innerHTML = '<div class="empty-state">Erro ao carregar. Verifique o backend.</div>'; }
  }

  window.deleteCall = async id => {
    if (!confirm('Remover esta call?')) return;
    await apiDelete('/api/calls/' + id);
    toast('Call removida', 'success');
    loadCalls(); loadDashboard();
  };

  // ── Analisar Transcricao ──────────────────────────────────────────────────
  function initAnalyzeForm() {
    document.getElementById('analyze-btn').addEventListener('click', async () => {
      const content = document.getElementById('analyze-content').value.trim();
      if (!content) { toast('Cole ou carregue uma transcricao para analisar', 'error'); return; }
      if (content.length < 100) { toast('Transcricao muito curta. Adicione mais conteudo.', 'error'); return; }
      setLoading('analyze-btn', true);
      document.getElementById('analyze-result').classList.add('hidden');
      try {
        const res = await apiJSON('/api/analyze', { transcript: content });
        if (res.success) renderAnalysis(res.analysis);
        else toast('Erro na analise: ' + (res.error || 'desconhecido'), 'error');
      } catch (err) {
        toast('Erro ao analisar: ' + err.message, 'error');
      } finally {
        setLoading('analyze-btn', false);
      }
    });
  }

  function renderAnalysis(a) {
    document.getElementById('result-resumo').textContent = a.resumo || '-';
    document.getElementById('result-momento').textContent = a.momento_final || '-';
    const fortes = document.getElementById('result-pontos-fortes');
    fortes.innerHTML = (a.pontos_fortes || []).map(p => `<li>${esc(p)}</li>`).join('') || '<li>Nenhum identificado</li>';
    const melhoria = document.getElementById('result-pontos-melhoria');
    melhoria.innerHTML = (a.pontos_de_melhoria || []).map(p => `<li>${esc(p)}</li>`).join('') || '<li>Nenhum identificado</li>';
    const prob = a.probabilidade_fechamento || 'media';
    const probEl = document.getElementById('result-probabilidade');
    probEl.textContent = { alta: '🟢 Alta', media: '🟡 Media', baixa: '🔴 Baixa' }[prob] || prob;
    const card = document.getElementById('prob-card');
    card.className = 'prob-card prob-' + prob;
    document.getElementById('result-proximo-passo').textContent = a.proximo_passo_recomendado || '-';
    document.getElementById('analyze-result').classList.remove('hidden');
    document.getElementById('analyze-result').scrollIntoView({ behavior: 'smooth' });
  }

  // ── Knowledge ──────────────────────────────────────────────────────────────
  async function loadKnowledge() {
    try {
      const data = await api('/api/knowledge');
      const el = document.getElementById('knowledge-summary-2');
      if (el) el.textContent = data.summary || 'Nenhum resumo disponivel. Adicione scripts e calls para treinar a IA.';
    } catch {}
    const btn = document.getElementById('rebuild-btn-2');
    if (btn) btn.onclick = rebuildKnowledge;
  }

  async function rebuildKnowledge() {
    toast('Reprocessando base de conhecimento...', 'success');
    await loadDashboard();
    await loadKnowledge();
    toast('Base de conhecimento atualizada!', 'success');
  }

  // ── Settings ───────────────────────────────────────────────────────────────
  function loadSettings() {
    document.getElementById('backend-url').value = API_URL;
    document.getElementById('ws-url').value = localStorage.getItem('asc_ws_url') || 'ws://localhost:3001';
  }

  function initSettings() {
    document.getElementById('save-settings-btn').addEventListener('click', () => {
      API_URL = document.getElementById('backend-url').value.trim();
      const wsUrl = document.getElementById('ws-url').value.trim();
      localStorage.setItem('asc_api_url', API_URL);
      localStorage.setItem('asc_ws_url', wsUrl);
      toast('Configuracoes salvas!', 'success');
      checkServerStatus();
    });
    document.getElementById('test-connection-btn').addEventListener('click', async () => {
      const result = document.getElementById('connection-result');
      try {
        const data = await api('/api/health');
        result.className = 'connection-result success';
        result.textContent = '✅ Conectado! ' + data.knowledge?.scripts + ' scripts, ' + data.knowledge?.calls + ' calls. Knowledge: ' + (data.hasKnowledge ? 'Pronta' : 'Vazia');
      } catch {
        result.className = 'connection-result error';
        result.textContent = '❌ Falha. Verifique se o backend esta rodando em ' + API_URL;
      }
    });
  }

  // ── Server Status ──────────────────────────────────────────────────────────
  async function checkServerStatus() {
    const el = document.getElementById('server-status');
    try {
      const data = await api('/api/health');
      el.innerHTML = '<span class="status-dot status-dot--online"></span><span>Backend online</span>';
      document.getElementById('stat-sessions').textContent = data.sessions || 0;
    } catch {
      el.innerHTML = '<span class="status-dot status-dot--offline"></span><span>Backend offline</span>';
    }
  }

  // ── Utils ──────────────────────────────────────────────────────────────────
  function setLoading(btnId, loading) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.querySelector('.btn-text')?.classList.toggle('hidden', loading);
    btn.querySelector('.btn-loading')?.classList.toggle('hidden', !loading);
    btn.disabled = loading;
  }

  function esc(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function formatDate(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  function toast(msg, type = 'success') {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }

  async function api(path) {
    const res = await fetch(API_URL + path);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  async function apiPost(path, body) {
    const res = await fetch(API_URL + path, { method: 'POST', body });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  async function apiJSON(path, body) {
    const res = await fetch(API_URL + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  async function apiDelete(path) {
    const res = await fetch(API_URL + path, { method: 'DELETE' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

})();
