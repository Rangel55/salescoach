—// background.js - Service Worker da extensao AI Sales Coach (Manifest V3)
// Gerencia WebSocket com o backend, estado global e relay de mensagens para content.js

// ── Constantes ─────────────────────────────────────────────────────────────
const DEFAULT_WS_URL = 'wss://salescoach-production.up.railway.app';
const RECONNECT_DELAY_MS = 5000;
const MAX_RECONNECT_ATTEMPTS = 10;

// ── Estado global do Service Worker ────────────────────────────────────────
let webSocket = null;
let sessionId = null;
let isAnalyzing = false;
let reconnectAttempts = 0;
let reconnectTimer = null;
let activeTabId = null;

// ── Instalacao ──────────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
    console.log('[ASC] Extensao instalada.');
    chrome.storage.local.set({
          isAnalyzing: false,
          sessionId: null,
          backendUrl: DEFAULT_WS_URL
    });
});

// ── Listener de mensagens vindas do content.js ─────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {

      case 'START_ANALYSIS':
              activeTabId = sender.tab ? sender.tab.id : activeTabId;
              sessionId = generateSessionId();
              isAnalyzing = true;
              chrome.storage.local.set({ isAnalyzing: true, sessionId });
              getWsUrl().then(wsUrl => {
                        connectWebSocket(wsUrl, sessionId);
                        sendResponse({ success: true, sessionId });
              });
              return true;

      case 'STOP_ANALYSIS':
              isAnalyzing = false;
              sessionId = null;
              chrome.storage.local.set({ isAnalyzing: false, sessionId: null });
              if (webSocket) {
                        sendToBackend({ type: 'END_SESSION' });
                        webSocket.close();
                        webSocket = null;
              }
              clearReconnect();
              sendResponse({ success: true });
              return true;

      case 'TRANSCRIPT_CHUNK':
              if (isAnalyzing && webSocket && webSocket.readyState === WebSocket.OPEN) {
                        sendToBackend({
                                    type: 'TRANSCRIPT_CHUNK',
                                    text: message.text,
                                    timestamp: Date.now()
                        });
              }
              sendResponse({ received: true });
              return true;

      case 'REQUEST_SUGGESTION':
              if (isAnalyzing && webSocket && webSocket.readyState === WebSocket.OPEN) {
                        sendToBackend({ type: 'REQUEST_SUGGESTION' });
              }
              sendResponse({ sent: true });
              return true;

      case 'GET_STATUS':
              sendResponse({
                        isAnalyzing,
                        sessionId,
                        wsState: webSocket ? webSocket.readyState : -1
              });
              return true;
    }
});

// ── Conexao WebSocket ───────────────────────────────────────────────────────
function connectWebSocket(wsBaseUrl, sid) {
    if (webSocket && webSocket.readyState === WebSocket.OPEN) {
          webSocket.close();
    }

  const url = wsBaseUrl.replace(/^http/, 'ws').replace(/\/$/, '') + '?sessionId=' + sid;
    console.log('[ASC] Conectando ao backend:', url);

  try {
        webSocket = new WebSocket(url);
  } catch (e) {
        console.error('[ASC] Erro ao criar WebSocket:', e);
        scheduleReconnect(wsBaseUrl, sid);
        return;
  }

  webSocket.onopen = () => {
        console.log('[ASC] WebSocket conectado.');
        reconnectAttempts = 0;
        clearReconnect();
        sendToBackend({ type: 'START_SESSION' });
        notifyContent({ type: 'WS_CONNECTED' });
  };

  webSocket.onmessage = (event) => {
        try {
                const data = JSON.parse(event.data);
                console.log('[ASC] Mensagem recebida:', data.type);
                // Repassa todos os eventos para o content.js ativo
          notifyContent(data);
        } catch (err) {
                console.error('[ASC] Erro ao parsear mensagem:', err);
        }
  };

  webSocket.onerror = (err) => {
        console.error('[ASC] Erro WebSocket:', err);
        notifyContent({ type: 'WS_ERROR' });
  };

  webSocket.onclose = () => {
        console.log('[ASC] WebSocket fechado.');
        notifyContent({ type: 'WS_DISCONNECTED' });
        if (isAnalyzing) {
                scheduleReconnect(wsBaseUrl, sid);
        }
  };
}

// ── Reconexao automatica ────────────────────────────────────────────────────
function scheduleReconnect(wsBaseUrl, sid) {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
          console.warn('[ASC] Maximo de tentativas de reconexao atingido.');
          notifyContent({ type: 'WS_FAILED' });
          return;
    }
    clearReconnect();
    reconnectAttempts++;
    console.log('[ASC] Reconectando em ' + RECONNECT_DELAY_MS + 'ms (tentativa ' + reconnectAttempts + ')');
    reconnectTimer = setTimeout(() => {
          if (isAnalyzing) connectWebSocket(wsBaseUrl, sid);
    }, RECONNECT_DELAY_MS);
}

function clearReconnect() {
    if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
    }
}

// ── Envio ao backend ────────────────────────────────────────────────────────
function sendToBackend(data) {
    if (webSocket && webSocket.readyState === WebSocket.OPEN) {
          webSocket.send(JSON.stringify(data));
    }
}

// ── Notifica o content.js na aba ativa ────────────────────────────────────
function notifyContent(data) {
    if (activeTabId) {
          chrome.tabs.sendMessage(activeTabId, data).catch(() => {});
    }
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function generateSessionId() {
    return 'sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
}

async function getWsUrl() {
    return new Promise((resolve) => {
          chrome.storage.local.get(['backendUrl'], (result) => {
                  resolve(result.backendUrl || DEFAULT_WS_URL);
          });
    });
}
