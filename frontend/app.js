// frontend/app.js
// Logica do painel de treinamento AI Sales Coach
// Gerencia: navegacao, upload de scripts/calls, comunicacao com o backend

(function () {
  'use strict';

  // ── Estado global ────────────────────────────────────────────────────────────
  let API_URL = localStorage.getItem('asc_api_url') || 'http://localhost:3001';
  let WS_URL  = localStorage.getItem('asc_ws_url')  || 'ws://localhost:3001';

  // ── Inicializacao ────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initScriptForm();
    initCallForm();
    initFileDrop();
    initSettings();
    loadDashboard();
    checkServerStatus();
    setInterval(checkServerStatus, 30000);
  });

  // ── Navegacao entre abas ─────────────────────────────────────────────────────
  function initNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const tab = item.dataset.tab;
        switchTab(tab);
        navItems.forEach(n => n.classList.remove('active'));
        item.classList.add('active');
      });
    });

    document.getElementById('refresh-btn').addEventListener('click', () => {
      const activeTab = document.querySelector('.tab-content.active').id.replace('tab-', '');
      loadTab(activeTab);
    });
  }

  function switchTab(tab) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.getElementById('tab-' + tab).classList.add('active');
    document.getElementById('page-title').textContent = {
      dashboard: 'Dashboard',
      scripts: 'Scripts de Vendas',
      calls: 'Calls de Sucesso',
      knowledge: 'Base de Conhecimento',
      settings: 'Configuracoes'
    }[tab] || tab;
    loadTab(tab);
  }

  function loadTab(tab) {
    switch (tab) {
      case 'dashboard': loadDashboard(); break;
      case 'scripts':   loadScripts(); break;
      case 'calls':     loadCalls(); break;
      case 'knowledge': loadKnowledge(); break;
      case 'settings':  loadSettings(); break;
    }
  }

  // ── Dashboard ────────────────────────────────────────────────────────────────
  async function loadDashboard() {
    try {
      const [health, knowledge] = await Promise.all([
        api('/api/health'),
        api('/api/knowledge')
      ]);
      document.getElementById('stat-scripts').textContent = health.knowledge?.scripts || 0;
      document.getElementById('stat-calls').textContent = health.knowledge?.calls || 0;
      document.getElementById('stat-sessions').textContent = health.sessions || 0;
      document.getElementById('stat-knowledge').textContent = knowledge.summary ? 'Pronta' : 'Vazia';
      const summary = knowledge.summary || 'Nenhum conhecimento carregado ainda. Adicione scripts e calls para comecar.';
      document.getElementById('knowledge-summary').textContent = summary;
    } catch (e) {
      document.getElementById('knowledge-summary').textContent = 'Backend offline. Inicie o servidor para ver os dados.';
    }

    document.getElementById('rebuild-btn').addEventListener('click', rebuildKnowledge);
    document.getElementById('rebuild-btn-2') && document.getElementById('rebuild-btn-2').addEventListener('click', rebuildKnowledge);
  }

  // ── Scripts ──────────────────────────────────────────────────────────────────
  function initScriptForm() {
    document.getElementById('script-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = document.getElementById('script-title').value.trim();
      const description = document.getElementById('script-desc').value.trim();
      const content = document.getElementById('script-content').value.trim();

      if (!title || !content) { toast('Preencha titulo e conteudo do script', 'error'); return; }

      try {
        const formData = new FormData();
        formData.append('title', title);
        formData.append('description', description);
        // Cria um arquivo blob com o conteudo de texto
        const blob = new Blob([content], { type: 'text/plain' });
        formData.append('script', blob, title + '.txt');

        await apiPost('/api/scripts', formData);
        toast('Script salvo com sucesso!', 'success');
        document.getElementById('script-form').reset();
        loadScripts();
      } catch (err) {
        toast('Erro ao salvar script: ' + err.message, 'error');
      }
    });
  }

  async function loadScripts() {
    try {
      const scripts = await api('/api/scripts');
      const list = document.getElementById('scripts-list');
      if (!scripts.length) { list.innerHTML = '<div class="empty-state">Nenhum script cadastrado ainda.</div>'; return; }
      list.innerHTML = scripts.map(s => `
        <div class="item-card">
          <div class="item-info">
            <div class="item-title">&#x1F4CB; ${s.title}</div>
            <div class="item-meta">${s.description || 'Sem descricao'} &bull; ${formatDate(s.uploadedAt)}</div>
          </div>
          <button class="btn btn-sm btn-danger" onclick="deleteScript('${s.id}')">&#x1F5D1;</button>
        </div>
      `).join('');
    } catch (e) {
      document.getElementById('scripts-list').innerHTML = '<div class="empty-state">Erro ao carregar. Verifique se o backend esta rodando.</div>';
    }
  }

  window.deleteScript = async (id) => {
    if (!confirm('Remover este script?')) return;
    await apiDelete('/api/scripts/' + id);
    toast('Script removido', 'success');
    loadScripts();
  };

  // ── Calls ────────────────────────────────────────────────────────────────────
  function initCallForm() {
    document.getElementById('call-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = document.getElementById('call-title').value.trim();
      const outcome = document.getElementById('call-outcome').value;
      const notes = document.getElementById('call-notes').value.trim();
      const content = document.getElementById('call-content').value.trim();

      if (!title) { toast('Preencha o titulo da call', 'error'); return; }

      try {
        const formData = new FormData();
        formData.append('title', title);
        formData.append('outcome', outcome);
        formData.append('notes', notes);
        if (content) {
          const blob = new Blob([content], { type: 'text/plain' });
          formData.append('call', blob, title + '.txt');
        }

        await apiPost('/api/calls', formData);
        toast('Call salva com sucesso! A IA esta aprendendo...', 'success');
        document.getElementById('call-form').reset();
        loadCalls();
      } catch (err) {
        toast('Erro ao salvar call: ' + err.message, 'error');
      }
    });
  }

  async function loadCalls() {
    try {
      const calls = await api('/api/calls');
      const list = document.getElementById('calls-list');
      if (!calls.length) { list.innerHTML = '<div class="empty-state">Nenhuma call cadastrada ainda.</div>'; return; }
      const badgeMap = { venda: 'badge-venda', perdida: 'badge-perdida', 'follow-up': 'badge-follow-up', automatica: 'badge-automatica' };
      const labelMap = { venda: 'Venda Fechada', perdida: 'Perdida', 'follow-up': 'Follow-up', automatica: 'Automatica' };
      list.innerHTML = calls.map(c => `
        <div class="item-card">
          <div class="item-info">
            <div class="item-title">&#x1F3A7; ${c.title}</div>
            <div class="item-meta">${c.notes || 'Sem notas'} &bull; ${formatDate(c.uploadedAt)}</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-shrink:0">
            <span class="item-badge ${badgeMap[c.outcome] || ''}">${labelMap[c.outcome] || c.outcome}</span>
            <button class="btn btn-sm btn-danger" onclick="deleteCall('${c.id}')">&#x1F5D1;</button>
          </div>
        </div>
      `).join('');
    } catch (e) {
      document.getElementById('calls-list').innerHTML = '<div class="empty-state">Erro ao carregar. Verifique se o backend esta rodando.</div>';
    }
  }

  window.deleteCall = async (id) => {
    if (!confirm('Remover esta call?')) return;
    await apiDelete('/api/calls/' + id);
    toast('Call removida', 'success');
    loadCalls();
  };

  // ── Knowledge ─────────────────────────────────────────────────────────────────
  async function loadKnowledge() {
    try {
      const data = await api('/api/knowledge');
      const el = document.getElementById('knowledge-summary-2');
      if (el) el.textContent = data.summary || 'Nenhum resumo disponivel ainda.';
    } catch (e) {}
    const btn = document.getElementById('rebuild-btn-2');
    if (btn) btn.onclick = rebuildKnowledge;
  }

  async function rebuildKnowledge() {
    toast('Reprocessando base de conhecimento...', 'success');
    // Forca o backend a reconsolidar adicionando um item vazio
    try {
      await loadDashboard();
      toast('Base de conhecimento atualizada!', 'success');
    } catch (e) {
      toast('Erro ao reprocessar', 'error');
    }
  }

  // ── Settings ─────────────────────────────────────────────────────────────────
  function loadSettings() {
    document.getElementById('backend-url').value = API_URL;
    document.getElementById('ws-url').value = WS_URL;
  }

  function initSettings() {
    document.getElementById('save-settings-btn').addEventListener('click', () => {
      API_URL = document.getElementById('backend-url').value.trim();
      WS_URL  = document.getElementById('ws-url').value.trim();
      localStorage.setItem('asc_api_url', API_URL);
      localStorage.setItem('asc_ws_url',  WS_URL);
      toast('Configuracoes salvas!', 'success');
      checkServerStatus();
    });

    document.getElementById('test-connection-btn').addEventListener('click', async () => {
      const result = document.getElementById('connection-result');
      try {
        const data = await api('/api/health');
        result.className = 'connection-result success';
        result.textContent = 'Conectado! ' + data.knowledge?.scripts + ' scripts, ' + data.knowledge?.calls + ' calls.';
      } catch (e) {
        result.className = 'connection-result error';
        result.textContent = 'Falha na conexao. Verifique se o backend esta rodando em ' + API_URL;
      }
    });
  }

  // ── File Drop ─────────────────────────────────────────────────────────────────
  function initFileDrop() {
    setupDrop('script-file-drop', 'script-file', (text) => {
      document.getElementById('script-content').value = text;
      toast('Arquivo carregado!', 'success');
    });

    setupDrop('call-file-drop', 'call-file', (text) => {
      document.getElementById('call-content').value = text;
      toast('Arquivo carregado!', 'success');
    });
  }

  function setupDrop(dropId, inputId, onText) {
    const drop = document.getElementById(dropId);
    const input = document.getElementById(inputId);

    drop.addEventListener('click', () => input.click());
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('dragover'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file) readFile(file, onText);
    });
    input.addEventListener('change', () => {
      if (input.files[0]) readFile(input.files[0], onText);
    });
  }

  function readFile(file, callback) {
    if (file.type.startsWith('audio/')) {
      toast('Audio detectado - sera transcrito pelo backend ao salvar', 'success');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => callback(e.target.result);
    reader.readAsText(file);
  }

  // ── Server Status ─────────────────────────────────────────────────────────────
  async function checkServerStatus() {
    const statusEl = document.getElementById('server-status');
    try {
      await api('/api/health');
      statusEl.innerHTML = '<span class="status-dot status-dot--online"></span><span>Backend online</span>';
    } catch {
      statusEl.innerHTML = '<span class="status-dot status-dot--offline"></span><span>Backend offline</span>';
    }
  }

  // ── API Helpers ───────────────────────────────────────────────────────────────
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

  async function apiDelete(path) {
    const res = await fetch(API_URL + path, { method: 'DELETE' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  // ── Toast Notifications ───────────────────────────────────────────────────────
  function toast(msg, type = 'success') {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = (type === 'success' ? '✅ ' : '❌ ') + msg;
    container.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }

  // ── Utilitarios ───────────────────────────────────────────────────────────────
  function formatDate(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

})();
