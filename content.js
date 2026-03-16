// content.js - Injetado em https://meet.google.com/*
// Responsavel por: injetar sidebar, capturar legendas reais do Google Meet,
// enviar transcricoes ao background.js e exibir insights da IA em tempo real.

(function () {
    'use strict';

   if (document.getElementById('ai-sales-coach-container')) return;
    console.log('[ASC] Content script carregado.');

   // ── Estado local ────────────────────────────────────────────────────────
   let isAnalyzing = false;
    let lastCaptionText = '';
    let captionObserver = null;
    let captionInterval = null;

   // ── Injeta sidebar no DOM ────────────────────────────────────────────────
   function injectSidebar() {
         const style = document.createElement('link');
         style.rel = 'stylesheet';
         style.href = chrome.runtime.getURL('sidebar.css');
         document.head.appendChild(style);

      const wrapper = document.createElement('div');
         wrapper.id = 'ai-sales-coach-container';
         wrapper.innerHTML = buildSidebarHTML();
         document.body.appendChild(wrapper);

      console.log('[ASC] Sidebar injetada.');
         initSidebarLogic();
         listenFromBackground();
   }

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
                                                                                                         <div class="asc-status-card asc-status-card--idle" id="asc-status-card">
                                                                                                                     <span class="asc-status-dot asc-status-dot--idle" id="asc-status-dot"></span>
                                                                                                                                 <span class="asc-status-text" id="asc-status-text">Aguardando inicio...</span>
                                                                                                                                           </div>
                                                                                                                                                   </div>
                                                                                                                                                   
                                                                                                                                                           <div class="asc-section" id="asc-insight-section" style="display:none">
                                                                                                                                                                     <div class="asc-insight-card" id="asc-insight-card">
                                                                                                                                                                                 <div class="asc-insight-header">
                                                                                                                                                                                               <span class="asc-badge" id="asc-badge-momento">descoberta</span>
                                                                                                                                                                                                             <span class="asc-badge asc-badge--alerta" id="asc-badge-alerta">neutro</span>
                                                                                                                                                                                                                         </div>
                                                                                                                                                                                                                                     <p class="asc-insight-text" id="asc-insight-text"></p>
                                                                                                                                                                                                                                                 <p class="asc-insight-motivo" id="asc-insight-motivo"></p>
                                                                                                                                                                                                                                                             <div class="asc-pergunta-box" id="asc-pergunta-box" style="display:none">
                                                                                                                                                                                                                                                                           <span class="asc-pergunta-label">&#x1F4AC; Pergunte agora:</span>
                                                                                                                                                                                                                                                                                         <p class="asc-pergunta-text" id="asc-pergunta-text"></p>
                                                                                                                                                                                                                                                                                                       <button class="asc-btn-copy" id="asc-copy-btn" title="Copiar pergunta">&#x1F4CB; Copiar</button>
                                                                                                                                                                                                                                                                                                                   </div>
                                                                                                                                                                                                                                                                                                                             </div>
                                                                                                                                                                                                                                                                                                                                     </div>
                                                                                                                                                                                                                                                                                                                                     
                                                                                                                                                                                                                                                                                                                                             <div class="asc-section asc-section-suggestions">
                                                                                                                                                                                                                                                                                                                                                       <div class="asc-section-header">
                                                                                                                                                                                                                                                                                                                                                                   <span class="asc-section-icon">&#x1F4CB;</span>
                                                                                                                                                                                                                                                                                                                                                                               <h2 class="asc-section-title">Historico de Insights</h2>
                                                                                                                                                                                                                                                                                                                                                                                           <span class="asc-count-badge" id="asc-insight-count">0</span>
                                                                                                                                                                                                                                                                                                                                                                                                     </div>
                                                                                                                                                                                                                                                                                                                                                                                                               <ul class="asc-suggestions-list" id="asc-suggestions-list">
                                                                                                                                                                                                                                                                                                                                                                                                                           <li class="asc-suggestion-placeholder">
                                                                                                                                                                                                                                                                                                                                                                                                                                         Inicie a analise para receber insights em tempo real.
                                                                                                                                                                                                                                                                                                                                                                                                                                                     </li>
                                                                                                                                                                                                                                                                                                                                                                                                                                                               </ul>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                       </div>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                       
                                                                                                                                                                                                                                                                                                                                                                                                                                                                               <div class="asc-footer">
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         <button class="asc-btn asc-btn-primary" id="asc-start-btn">
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     &#x25B6; Iniciar Analise
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               </button>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         <button class="asc-btn asc-btn-outline" id="asc-request-btn" style="display:none">
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     &#x1F4A1; Pedir Insight
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               </button>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       </div>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             </div>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 `;
   }

   // ── Logica dos botoes da sidebar ─────────────────────────────────────────
   function initSidebarLogic() {
         const startBtn = document.getElementById('asc-start-btn');
         const toggleBtn = document.getElementById('asc-toggle-btn');
         const requestBtn = document.getElementById('asc-request-btn');
         const copyBtn = document.getElementById('asc-copy-btn');

      startBtn.addEventListener('click', () => {
              isAnalyzing ? stopAnalysis() : startAnalysis();
      });

      toggleBtn.addEventListener('click', () => {
              const container = document.getElementById('ai-sales-coach-container');
              container.classList.toggle('asc-collapsed');
              toggleBtn.textContent = container.classList.contains('asc-collapsed') ? '>' : '\u2039';
      });

      if (requestBtn) {
              requestBtn.addEventListener('click', () => {
                        chrome.runtime.sendMessage({ type: 'REQUEST_SUGGESTION' });
              });
      }

      if (copyBtn) {
              copyBtn.addEventListener('click', () => {
                        const text = document.getElementById('asc-pergunta-text').textContent;
                        navigator.clipboard.writeText(text).then(() => {
                                    copyBtn.textContent = '\u2713 Copiado!';
                                    setTimeout(() => { copyBtn.textContent = '\uD83D\uDCCB Copiar'; }, 2000);
                        });
              });
      }
   }

   // ── Iniciar / parar analise ──────────────────────────────────────────────
   function startAnalysis() {
         updateStatus('connecting', 'Conectando ao backend...');
         const startBtn = document.getElementById('asc-start-btn');
         startBtn.textContent = '\u23F3 Conectando...';
         startBtn.disabled = true;

      chrome.runtime.sendMessage({ type: 'START_ANALYSIS' }, (response) => {
              if (response && response.success) {
                        isAnalyzing = true;
                        startBtn.textContent = '\u25A0 Parar Analise';
                        startBtn.disabled = false;
                        startBtn.classList.replace('asc-btn-primary', 'asc-btn-danger');
                        const requestBtn = document.getElementById('asc-request-btn');
                        if (requestBtn) requestBtn.style.display = '';
                        startCaptionCapture();
              } else {
                        updateStatus('idle', 'Erro ao conectar. Tente novamente.');
                        startBtn.textContent = '\u25B6 Iniciar Analise';
                        startBtn.disabled = false;
              }
      });
   }

   function stopAnalysis() {
         isAnalyzing = false;
         stopCaptionCapture();
         chrome.runtime.sendMessage({ type: 'STOP_ANALYSIS' });
         updateStatus('idle', 'Analise encerrada.');
         const startBtn = document.getElementById('asc-start-btn');
         startBtn.textContent = '\u25B6 Iniciar Analise';
         startBtn.classList.replace('asc-btn-danger', 'asc-btn-primary');
         const requestBtn = document.getElementById('asc-request-btn');
         if (requestBtn) requestBtn.style.display = 'none';
   }

   // ── Captura de legendas do Google Meet ───────────────────────────────────
   // O Google Meet renderiza as legendas ao vivo em elementos com
   // data-is-native-captions ou classes especificas. Monitoramos via
   // MutationObserver + polling como fallback.
   function startCaptionCapture() {
         updateStatus('analyzing', 'Capturando legendas...');

      // Tenta ativar legendas automaticamente se nao estiverem ativas
      enableCaptions();

      // MutationObserver para capturar mudancas nas legendas
      captionObserver = new MutationObserver(checkCaptions);
         captionObserver.observe(document.body, {
                 childList: true,
                 subtree: true,
                 characterData: true,
                 characterDataOldValue: true
         });

      // Polling como fallback a cada 2 segundos
      captionInterval = setInterval(checkCaptions, 2000);

      console.log('[ASC] Captura de legendas iniciada.');
   }

   function stopCaptionCapture() {
         if (captionObserver) {
                 captionObserver.disconnect();
                 captionObserver = null;
         }
         if (captionInterval) {
                 clearInterval(captionInterval);
                 captionInterval = null;
         }
         console.log('[ASC] Captura de legendas encerrada.');
   }

   function checkCaptions() {
         const text = extractCaptionText();
         if (text && text !== lastCaptionText && text.length > 10) {
                 lastCaptionText = text;
                 chrome.runtime.sendMessage({
                           type: 'TRANSCRIPT_CHUNK',
                           text: text,
                           timestamp: Date.now()
                 });
                 console.log('[ASC] Legenda capturada:', text.substring(0, 60));
         }
   }

   function extractCaptionText() {
         // Seletores do Google Meet para legendas (testados em 2025-2026)
      const selectors = [
              // Legendas ao vivo (CC) - seletor principal
              '[data-is-native-captions] span',
              // Fallback 1: div de transcricao em tempo real
              '.a4cQT span',
              // Fallback 2: container de caption atual
              '[jsname="tgaKEf"] span',
              // Fallback 3: caption no novo layout do Meet
              '.iOzk7 span',
              // Fallback 4: seletor geral de caption text
              '[class*="caption"] span[class*="text"]',
              // Fallback 5: subtitles container
              'div[data-is-native-captions="true"] span'
            ];

      for (const selector of selectors) {
              const elements = document.querySelectorAll(selector);
              if (elements.length > 0) {
                        const text = Array.from(elements)
                          .map(el => el.textContent.trim())
                          .filter(t => t.length > 0)
                          .join(' ')
                          .trim();
                        if (text.length > 0) return text;
              }
      }
         return '';
   }

   function enableCaptions() {
         // Tenta clicar no botao de legendas se ainda nao estiver ativo
      const captionSelectors = [
              '[data-tooltip*="caption" i]',
              '[aria-label*="caption" i]',
              '[aria-label*="legenda" i]',
              '[data-tooltip*="legenda" i]'
            ];
         for (const sel of captionSelectors) {
                 const btn = document.querySelector(sel);
                 if (btn && btn.getAttribute('data-is-muted') !== 'false') {
                           // Nao clica automaticamente — apenas avisa o usuario
                   console.log('[ASC] Botao de legenda encontrado. Ative as legendas no Meet para melhor precisao.');
                           break;
                 }
         }
   }

   // ── Recebe mensagens do background.js ────────────────────────────────────
   function listenFromBackground() {
         chrome.runtime.onMessage.addListener((message) => {
                 switch (message.type) {
                   case 'CONNECTED':
                   case 'WS_CONNECTED':
                               updateStatus('analyzing', 'Coach ativo - analisando...');
                               break;

                   case 'INSIGHT':
                               displayInsight(message);
                               addToHistory(message);
                               break;

                   case 'STATUS':
                               updateStatus('analyzing', message.message || 'Analisando...');
                               break;

                   case 'WS_DISCONNECTED':
                               if (isAnalyzing) updateStatus('connecting', 'Reconectando...');
                               break;

                   case 'WS_ERROR':
                               updateStatus('error', 'Erro de conexao com backend.');
                               break;

                   case 'WS_FAILED':
                               updateStatus('error', 'Nao foi possivel conectar. Verifique o backend.');
                               break;
                 }
         });
   }

   // ── Exibe o insight mais recente em destaque ──────────────────────────────
   function displayInsight(data) {
         const section = document.getElementById('asc-insight-section');
         const card = document.getElementById('asc-insight-card');
         const badgeMomento = document.getElementById('asc-badge-momento');
         const badgeAlerta = document.getElementById('asc-badge-alerta');
         const insightText = document.getElementById('asc-insight-text');
         const insightMotivo = document.getElementById('asc-insight-motivo');
         const perguntaBox = document.getElementById('asc-pergunta-box');
         const perguntaText = document.getElementById('asc-pergunta-text');

      if (!section) return;

      section.style.display = '';
         badgeMomento.textContent = data.momento || 'descoberta';
         badgeAlerta.textContent = data.alerta || 'neutro';
         badgeAlerta.className = 'asc-badge asc-badge--alerta asc-badge--' + (data.alerta || 'neutro');
         insightText.textContent = data.insight || '';
         insightMotivo.textContent = data.motivo ? '\u2139\uFE0F ' + data.motivo : '';

      if (data.pergunta_sugerida) {
              perguntaText.textContent = data.pergunta_sugerida;
              perguntaBox.style.display = '';
      } else {
              perguntaBox.style.display = 'none';
      }

      // Animacao de entrada
      card.classList.remove('asc-insight-new');
         void card.offsetWidth;
         card.classList.add('asc-insight-new');
   }

   // ── Adiciona insight ao historico ────────────────────────────────────────
   let insightCount = 0;
    function addToHistory(data) {
          const list = document.getElementById('asc-suggestions-list');
          const countEl = document.getElementById('asc-insight-count');
          if (!list) return;

      const placeholder = list.querySelector('.asc-suggestion-placeholder');
          if (placeholder) placeholder.remove();

      insightCount++;
          if (countEl) countEl.textContent = insightCount;

      const alertaClass = {
              perigo: 'asc-hist--perigo',
              oportunidade: 'asc-hist--oportunidade',
              neutro: 'asc-hist--neutro'
      }[data.alerta] || 'asc-hist--neutro';

      const item = document.createElement('li');
          item.className = 'asc-suggestion-item asc-suggestion-enter ' + alertaClass;
          item.innerHTML =
                  '<span class="asc-hist-badge">' + escapeHTML(data.momento || '') + '</span>' +
                  '<span class="asc-suggestion-text">' + escapeHTML(data.insight || '') + '</span>';

      list.insertBefore(item, list.firstChild);

      // Mantém maximo de 20 no historico
      while (list.children.length > 20) {
              list.removeChild(list.lastChild);
      }

      setTimeout(() => item.classList.remove('asc-suggestion-enter'), 400);
    }

   // ── Helpers ──────────────────────────────────────────────────────────────
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

   // ── Boot ─────────────────────────────────────────────────────────────────
   if (document.readyState === 'loading') {
         document.addEventListener('DOMContentLoaded', injectSidebar);
   } else {
         injectSidebar();
   }

})();
