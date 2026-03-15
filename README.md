# AI Sales Coach

Extensao Chrome com painel de coaching por IA em tempo real para vendedores no Google Meet.

## Arquitetura

```
salescoach/
├── extension/          # Extensao Chrome (Manifest V3)
│   ├── manifest.json
│   ├── background.js
│   ├── content.js
│   ├── sidebar.css
│   ├── sidebar.html
│   └── sidebar.js
├── backend/            # API REST + WebSocket + OpenAI
│   ├── server.js
│   ├── package.json
│   └── .env.example
└── frontend/           # Painel web de treinamento
    ├── index.html
    ├── style.css
    └── app.js
```

## Como Funciona

1. O vendedor abre o Google Meet — a extensao injeta a sidebar automaticamente
2. Durante a call, o audio e transcrito e enviado ao backend via WebSocket
3. O backend processa com GPT-4o-mini usando a base de conhecimento treinada
4. Sugestoes aparecem em tempo real na sidebar do vendedor

## Instalacao

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env
# Edite .env e adicione sua OPENAI_API_KEY
npm start
```

### 2. Frontend (Painel de Treinamento)

Abra `frontend/index.html` no navegador ou sirva com qualquer servidor HTTP:

```bash
cd frontend
npx serve .
# Acesse http://localhost:3000
```

### 3. Extensao Chrome

1. Acesse `chrome://extensions`
2. Ative o Modo Desenvolvedor
3. Clique em "Carregar sem compactacao"
4. Selecione a pasta raiz do projeto (onde esta o manifest.json)

## Painel de Treinamento

Acesse `frontend/index.html` para:

- **Scripts de Vendas**: Carregue seus playbooks, roteiros e metodologias (SPIN, MEDDIC, etc)
- **Calls de Sucesso**: Adicione transcricoes de calls que geraram vendas — a IA aprende com elas
- **Base de Conhecimento**: Visualize o resumo que a IA usa durante as calls ao vivo
- **Configuracoes**: Configure a URL do backend e teste a conexao

## Variaveis de Ambiente

```
OPENAI_API_KEY=sk-...    # Obrigatorio
PORT=3001                # Opcional, padrao: 3001
```

## Stack

- **Extensao**: JavaScript puro, Manifest V3, WebSocket
- **Backend**: Node.js, Express, ws, OpenAI SDK (GPT-4o-mini + Whisper)
- **Frontend**: HTML/CSS/JS puro (sem frameworks, zero dependencias)
