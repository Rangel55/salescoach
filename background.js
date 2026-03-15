// background.js
// Service Worker da extensao AI Sales Coach (Manifest V3)
// Responsavel por: gerenciar mensagens, coordenar comunicacao com backend,
// e controlar o estado global da extensao.

// Listener de instalacao
chrome.runtime.onInstalled.addListener(() => {
  console.log('[AI Sales Coach] Extensao instalada com sucesso.');
  chrome.storage.local.set({
    isAnalyzing: false,
    sessionId: null,
    suggestions: []
  });
});

// Listener de mensagens (content.js <-> background.js)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[AI Sales Coach] Mensagem recebida:', message);

  switch (message.type) {
    case 'START_ANALYSIS':
      handleStartAnalysis(sender.tab, sendResponse);
      return true;

    case 'STOP_ANALYSIS':
      handleStopAnalysis(sendResponse);
      return true;

    case 'TRANSCRIPT_CHUNK':
      handleTranscriptChunk(message.data, sendResponse);
      return true;

    default:
      console.warn('[AI Sales Coach] Tipo de mensagem desconhecido:', message.type);
  }
});

// Inicia a sessao de analise
function handleStartAnalysis(tab, sendResponse) {
  const sessionId = generateSessionId();
  chrome.storage.local.set({ isAnalyzing: true, sessionId }, () => {
    console.log('[AI Sales Coach] Analise iniciada. Session ID:', sessionId);
    sendResponse({ success: true, sessionId });
  });
}

// Para a sessao de analise
function handleStopAnalysis(sendResponse) {
  chrome.storage.local.set({ isAnalyzing: false, sessionId: null }, () => {
    console.log('[AI Sales Coach] Analise encerrada.');
    sendResponse({ success: true });
  });
}

// Recebe chunk de transcricao - futuramente envia ao backend via WebSocket
function handleTranscriptChunk(data, sendResponse) {
  console.log('[AI Sales Coach] Chunk de transcricao recebido:', data);
  // TODO: webSocketManager.send({ type: 'TRANSCRIPT', payload: data });
  sendResponse({ received: true });
}

// Gera ID unico para cada sessao
function generateSessionId() {
  return 'session_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
}
