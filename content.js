// content.js
// Injetado automaticamente em https://meet.google.com/*
// Responsavel por: injetar a sidebar no DOM, comunicacao com background.js
// e futuramente capturar transcricoes da call.

(function () {
  'use strict';

  // Evita injecao duplicada
  if (document.getElementById('ai-sales-coach-container')) {
    return;
  }

  console.log('[AI Sales Coach] Content script carregado.');

  // ── Injeta a sidebar no DOM ──────────────────────────────────────────
  function injectSidebar() {
    const wrapper = document.createElement('div');
    wrapper.id = 'ai-sales-coach-container';
    wrapper.innerHTML = buildSidebarHTML();
    document.body.appendChild(wrapper);
    console.log('[AI Sales Coach] Sidebar injetada.');
    initSidebarLogic();
  }

  // Constroi o HTML da sidebar
  function buildSidebarHTML() {
    return `
      <div id="ai-sales-coach-sidebar">
        <div class="asc-header">
          <div class="asc-header-top">
            <span class="asc-logo">&#x1F916;</span>
            <h1 class="asc-title">AI Sales Coach</h1>
            <button class="asc-toggle-btn" id="asc-toggle-btn" title="Minimizar">&#x2039;</button>
          </div>
        </div>
        <div class="asc-section">
          <div class="asc-status-card" id="asc-status-card">
            <span class="asc-status-dot" id="asc-status-dot"></span>
            <span class="asc-status-text" id="asc-status-text">Aguardando conversa...</span>
          </div>
        </div>
        <div class="asc-section asc-section-suggestions">
          <div class="asc-section-header">
            <span class="asc-section-icon">&#x1F4A1;</span>
            <h2 class="asc-section-title">Sugestoes ao Vivo</h2>
          </div>
          <ul class="asc-suggestions-list" id="asc-suggestions-list">
            <li class="asc-suggestion-placeholder">
              Clique em "Iniciar Analise" para receber sugestoes em tempo real.
            </li>
          </ul>
        </div>
        <div class="asc-footer">
          <button class="asc-btn asc-btn-primary" id="asc-start-btn">
            &#x25B6; Iniciar Analise
          </button>
        </div>
      </div>
    `;
  }

  // ── Logica da sidebar ──────────────────────────────────────────────────
  function initSidebarLogic() {
    const startBtn = document.getElementById('asc-start-btn');
    const toggleBtn = document.getElementById('asc-toggle-btn');
    let isAnalyzing = false;

    startBtn.addEventListener('click', () => {
      isAnalyzing = !isAnalyzing;
      isAnalyzing ? startAnalysis() : stopAnalysis();
    });

    toggleBtn.addEventListener('click', () => {
      const container = document.getElementById('ai-sales-coach-container');
      container.classList.toggle('asc-collapsed');
      toggleBtn.textContent = container.classList.contains('asc-collapsed') ? '>' : '<';
    });
  }

  function startAnalysis() {
    updateStatus('analyzing', 'Analisando conversa...');
    const btn = document.getElementById('asc-start-btn');
    btn.textContent = 'Parar Analise';
    btn.classList.replace('asc-btn-primary', 'asc-btn-danger');
    clearSuggestions();
    chrome.runtime.sendMessage({ type: 'START_ANALYSIS' }, (r) => {
      console.log('[AI Sales Coach] Analise iniciada:', r);
    });
    simulateIncomingSuggestions();
  }

  function stopAnalysis() {
    updateStatus('idle', 'Analise pausada.');
    const btn = document.getElementById('asc-start-btn');
    btn.textContent = 'Iniciar Analise';
    btn.classList.replace('asc-btn-danger', 'asc-btn-primary');
    stopSimulation();
    chrome.runtime.sendMessage({ type: 'STOP_ANALYSIS' });
  }

  // ── Sistema de Sugestoes ───────────────────────────────────────────────
  window.addSuggestion = function (text) {
    const list = document.getElementById('asc-suggestions-list');
    if (!list) return;
    const placeholder = list.querySelector('.asc-suggestion-placeholder');
    if (placeholder) placeholder.remove();
    const item = document.createElement('li');
    item.classList.add('asc-suggestion-item', 'asc-suggestion-enter');
    item.innerHTML = `
      <span class="asc-suggestion-bullet">></span>
      <span class="asc-suggestion-text">${escapeHTML(text)}</span>
    `;
    list.appendChild(item);
    list.scrollTop = list.scrollHeight;
    setTimeout(() => item.classList.remove('asc-suggestion-enter'), 400);
  };

  function clearSuggestions() {
    const list = document.getElementById('asc-suggestions-list');
    if (list) list.innerHTML = '';
  }

  // ── Simulacao de sugestoes em tempo real ────────────────────────────────
  let simulationIntervalId = null;
  let suggestionQueue = [];
  let suggestionIndex = 0;

  function simulateIncomingSuggestions() {
    suggestionQueue = [
      'Pergunte ao cliente qual e o principal desafio dele hoje',
      'Confirme quem e o tomador de decisao nesse processo',
      'Esclarea qual solucao ele usa atualmente',
      'Explore o nivel de urgencia do problema',
      'Pergunte qual seria o impacto financeiro de nao resolver isso',
      'Confirme o prazo ideal para implementacao',
      'Explore o que ja foi tentado antes sem sucesso',
      'Pergunte sobre o budget disponivel para essa iniciativa',
      'Valide se ha outros stakeholders envolvidos na decisao',
      'Esclarea qual seria o criterio de sucesso da solucao'
    ];
    suggestionIndex = 0;
    deliverNextSuggestion();
    simulationIntervalId = setInterval(() => {
      if (suggestionIndex >= suggestionQueue.length) {
        stopSimulation();
        updateStatus('done', 'Analise concluida.');
        return;
      }
      deliverNextSuggestion();
    }, 6000);
  }

  function deliverNextSuggestion() {
    if (suggestionIndex < suggestionQueue.length) {
      window.addSuggestion(suggestionQueue[suggestionIndex]);
      suggestionIndex++;
    }
  }

  function stopSimulation() {
    if (simulationIntervalId) {
      clearInterval(simulationIntervalId);
      simulationIntervalId = null;
    }
  }

  // ── WebSocket (placeholder para backend real) ────────────────────────────
  let webSocket = null;

  // Conecta ao backend de IA via WebSocket
  // PLACEHOLDER - implementar quando o backend estiver disponivel
  function connectWebSocket(sessionId) {
    const WS_URL = 'wss://seu-backend.com/ws/session/' + sessionId;
    webSocket = new WebSocket(WS_URL);
    webSocket.onopen = () => updateStatus('analyzing', 'Conectado - analisando...');
    webSocket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'SUGGESTION' && data.text) window.addSuggestion(data.text);
        if (data.type === 'STATUS') updateStatus('analyzing', data.message);
      } catch (err) {
        console.error('[AI Sales Coach] Erro WebSocket:', err);
      }
    };
    webSocket.onerror = () => updateStatus('error', 'Erro de conexao com backend.');
    webSocket.onclose = () => updateStatus('idle', 'Desconectado do backend.');
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function updateStatus(state, message) {
    const dot = document.getElementById('asc-status-dot');
    const text = document.getElementById('asc-status-text');
    const card = document.getElementById('asc-status-card');
    if (!dot || !text || !card) return;
    dot.className = 'asc-status-dot asc-status-dot--' + state;
    card.className = 'asc-status-card asc-status-card--' + state;
    text.textContent = message;
  }

  function escapeHTML(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectSidebar);
  } else {
    injectSidebar();
  }

})();
