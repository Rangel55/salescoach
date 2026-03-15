// sidebar.js
// Logica da sidebar para preview standalone (sidebar.html).
// No contexto real do Google Meet, a logica e gerenciada pelo content.js.
// Este arquivo e util para testar o design e interacoes isoladamente.

(function () {
  'use strict';

  // Estado local
  let isAnalyzing = false;
  let simulationIntervalId = null;
  let suggestionIndex = 0;

  const suggestionQueue = [
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

  // Inicializa apos DOM carregado
  document.addEventListener('DOMContentLoaded', init);

  function init() {
    const startBtn = document.getElementById('asc-start-btn');
    const toggleBtn = document.getElementById('asc-toggle-btn');

    if (startBtn) {
      startBtn.addEventListener('click', () => {
        isAnalyzing = !isAnalyzing;
        isAnalyzing ? startAnalysis() : stopAnalysis();
      });
    }

    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        const container = document.getElementById('ai-sales-coach-container');
        if (container) {
          container.classList.toggle('asc-collapsed');
          toggleBtn.textContent = container.classList.contains('asc-collapsed') ? '>' : '<';
        }
      });
    }

    console.log('[AI Sales Coach] Sidebar preview inicializada.');
  }

  // Inicia analise simulada
  function startAnalysis() {
    updateStatus('analyzing', 'Analisando conversa...');
    const btn = document.getElementById('asc-start-btn');
    if (btn) {
      btn.textContent = 'Parar Analise';
      btn.classList.replace('asc-btn-primary', 'asc-btn-danger');
    }
    clearSuggestions();
    suggestionIndex = 0;
    deliverNextSuggestion();
    simulationIntervalId = setInterval(() => {
      if (suggestionIndex >= suggestionQueue.length) {
        stopSimulation();
        updateStatus('done', 'Analise concluida.');
        return;
      }
      deliverNextSuggestion();
    }, 5000);
  }

  // Para a analise
  function stopAnalysis() {
    updateStatus('idle', 'Analise pausada.');
    const btn = document.getElementById('asc-start-btn');
    if (btn) {
      btn.textContent = 'Iniciar Analise';
      btn.classList.replace('asc-btn-danger', 'asc-btn-primary');
    }
    stopSimulation();
  }

  function stopSimulation() {
    if (simulationIntervalId) {
      clearInterval(simulationIntervalId);
      simulationIntervalId = null;
    }
  }

  function deliverNextSuggestion() {
    if (suggestionIndex < suggestionQueue.length) {
      addSuggestion(suggestionQueue[suggestionIndex]);
      suggestionIndex++;
    }
  }

  // Adiciona sugestao a lista
  // Exportada globalmente para uso no console durante testes
  window.addSuggestion = function (text) {
    const list = document.getElementById('asc-suggestions-list');
    if (!list) return;
    const placeholder = list.querySelector('.asc-suggestion-placeholder');
    if (placeholder) placeholder.remove();
    const item = document.createElement('li');
    item.classList.add('asc-suggestion-item', 'asc-suggestion-enter');
    item.innerHTML =
      '<span class="asc-suggestion-bullet">></span>' +
      '<span class="asc-suggestion-text">' + escapeHTML(text) + '</span>';
    list.appendChild(item);
    list.scrollTop = list.scrollHeight;
    setTimeout(() => item.classList.remove('asc-suggestion-enter'), 400);
  };

  function clearSuggestions() {
    const list = document.getElementById('asc-suggestions-list');
    if (list) list.innerHTML = '';
  }

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

})();
