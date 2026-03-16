require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { OpenAI } = require('openai');


const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });


const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'salescoach_secret_2026';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });


// ── Storage uploads ────────────────────────────────────────────────────────
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
          const dir = file.fieldname === 'script' ? './data/scripts' : './data/calls';
          fs.mkdirSync(dir, { recursive: true });
          cb(null, dir);
    },
    filename: (req, file, cb) => { cb(null, Date.now() + '-' + file.originalname); }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });


// ── Middlewares ────────────────────────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..', 'frontend')));


// ── Auth helpers ───────────────────────────────────────────────────────────
