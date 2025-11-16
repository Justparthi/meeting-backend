require('dotenv').config({ path: './config.env' });
const express = require('express');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');
const fetch = require('node-fetch');
const cors = require('cors');

// Firebase imports
const { db } = require('../config/firebaseConfig.js');
const ChatMessage = require('../models/chatMessage.js');
const Meeting = require('../models/meeting.js');
const User = require('../models/user.js');
const Room = require('../models/room.js');

const transcriptRoutes = require('../routes/transcriptRoute.js');

console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('PORT:', process.env.PORT || 3001);

const app = express();

// ============================================
// RAILWAY-SPECIFIC CORS CONFIGURATION
// ============================================
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
  : [];

// Add Railway's internal URLs if present
if (process.env.RAILWAY_PUBLIC_DOMAIN) {
  allowedOrigins.push(`https://${process.env.RAILWAY_PUBLIC_DOMAIN}`);
}
if (process.env.RAILWAY_STATIC_URL) {
  allowedOrigins.push(process.env.RAILWAY_STATIC_URL);
}

console.log('📋 Allowed Origins:', allowedOrigins);

app.use(cors({
  origin: (origin, callback) => {
    console.log('🔍 CORS check for origin:', origin);
    
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) {
      console.log('✅ No origin - allowing');
      return callback(null, true);
    }
    
    // Development mode - allow localhost
    if (process.env.NODE_ENV !== 'production') {
      if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
        console.log('✅ Development localhost - allowing');
        return callback(null, true);
      }
    }
    
    // Check against allowed origins
    if (allowedOrigins.length > 0 && allowedOrigins.includes(origin)) {
      console.log('✅ Origin in allowed list');
      return callback(null, true);
    }
    
    // Railway development URLs
    if (origin.includes('railway.app') || origin.includes('up.railway.app')) {
      console.log('✅ Railway domain - allowing');
      return callback(null, true);
    }
    
    // Tunnel services for development
    if (origin.includes('ngrok') || origin.includes('loca.lt')) {
      console.log('✅ Tunnel domain - allowing');
      return callback(null, true);
    }
    
    console.log('❌ Origin not allowed');
    callback(new Error('Not allowed by CORS'));
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'bypass-tunnel-reminder'],
  exposedHeaders: ['Content-Type', 'Authorization']
}));

app.options('*', cors());

// Trust proxy - CRITICAL for Railway
app.set('trust proxy', 1);

// ============================================
// MIDDLEWARE - MUST COME BEFORE ROUTES
// ============================================
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path}`);
  next();
});

// Health check endpoint for Railway
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
    railway: !!process.env.RAILWAY_ENVIRONMENT
  });
});

// ============================================
// ROUTES
// ============================================
app.use('/api/transcripts', transcriptRoutes);

// ============================================
// SERVER CREATION - Railway uses HTTP only
// ============================================
let server;

// Railway handles HTTPS at the edge, so we always use HTTP
if (process.env.RAILWAY_ENVIRONMENT) {
  console.log('🚂 Running on Railway - using HTTP (Railway handles HTTPS)');
  server = http.createServer(app);
} else {
  // Local development - check for SSL
  const sslKeyPath = path.join(__dirname, '..', 'ssl', 'key.pem');
  const sslCertPath = path.join(__dirname, '..', 'ssl', 'cert.pem');
  const useHTTPS = fs.existsSync(sslKeyPath) && fs.existsSync(sslCertPath) && process.env.FORCE_HTTPS === 'true';

  try {
    if (useHTTPS) {
      const sslOptions = {
        key: fs.readFileSync(sslKeyPath),
        cert: fs.readFileSync(sslCertPath)
      };
      server = https.createServer(sslOptions, app);
      console.log('🚀 Local server with HTTPS');
    } else {
      server = http.createServer(app);
      console.log('🚀 Local server with HTTP');
    }
  } catch (sslError) {
    console.log('⚠️ SSL error, using HTTP:', sslError.message);
    server = http.createServer(app);
  }
}

// ============================================
// SOCKET.IO CONFIGURATION
// ============================================
const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      
      if (process.env.NODE_ENV !== 'production') {
        if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
          return callback(null, true);
        }
      }
      
      if (allowedOrigins.length > 0 && allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      
      if (origin.includes('railway.app') || 
          origin.includes('ngrok') || 
          origin.includes('loca.lt')) {
        return callback(null, true);
      }
      
      callback(null, true);
    },
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
  // Railway-specific: increase buffer sizes
  maxHttpBufferSize: 1e8,
  allowEIO3: true
});

io.engine.on("connection_error", (err) => {
  console.log(`❌ Socket.IO connection error: ${err.req?.headers?.origin || 'unknown'}`);
  console.log(err.message);
});

// WebRTC Signaling handlers
io.on('connection', (socket) => {
  console.log(`✅ Socket connected: ${socket.id}`);
  
  socket.on('join-room', (roomId, userId, userData) => {
    socket.join(roomId);
    socket.userId = userId;
    socket.userData = userData;
    
    socket.to(roomId).emit('user-connected', {
      userId,
      ...userData
    });
    
    const clients = Array.from(io.sockets.adapter.rooms.get(roomId) || []);
    const others = clients
      .filter(id => id !== socket.id)
      .map(id => ({
        userId: io.sockets.sockets.get(id)?.userId,
        ...io.sockets.sockets.get(id)?.userData
      }))
      .filter(user => user.userId); // Filter out undefined users
    
    socket.emit('room-users', others);
  });
  
  socket.on('signal', ({roomId, targetUserId, signal}) => {
    const clients = Array.from(io.sockets.adapter.rooms.get(roomId) || []);
    const targetSocket = clients.find(clientId => {
      const clientSocket = io.sockets.sockets.get(clientId);
      return clientSocket && clientSocket.userId === targetUserId;
    });
    
    if (targetSocket) {
      io.to(targetSocket).emit('signal', { 
        userId: socket.userId, 
        signal 
      });
    }
  });
  
  socket.on('send-message', (messageData) => {
    socket.to(messageData.roomId).emit('receive-message', {
      userId: socket.userId,
      userName: messageData.userName,
      message: messageData.message,
      timestamp: messageData.timestamp
    });
  });

  socket.on('disconnect', () => {
    console.log(`❌ Socket disconnected: ${socket.id}`);
  });
});

// Font fallback routes
app.get('/fonts/glyphicons-halflings-regular.*', (req, res) => {
  res.status(204).end();
});

app.get('*glyphicons*', (req, res) => {
  res.status(204).end();
});

app.get('/fonts/glyphicons-fallback.css', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, '..', 'public', 'fonts', 'glyphicons-fallback.css'));
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Shortmeet Server is running',
    environment: process.env.NODE_ENV,
    railway: !!process.env.RAILWAY_ENVIRONMENT,
    timestamp: new Date().toISOString()
  });
});

// Utility functions
const generateRoomCode = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 10; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

const generateMeetingId = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 9; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

// In-memory storage
const inMemoryRooms = new Map();

// Rate limiting for AI APIs
const requestQueue = [];
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 4000;

const processQueue = async () => {
  if (requestQueue.length === 0) return;
  
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  
  if (timeSinceLastRequest >= MIN_REQUEST_INTERVAL) {
    const { resolve, reject, fn } = requestQueue.shift();
    lastRequestTime = Date.now();
    
    try {
      const result = await fn();
      resolve(result);
    } catch (error) {
      reject(error);
    }
    
    setTimeout(processQueue, MIN_REQUEST_INTERVAL);
  } else {
    setTimeout(processQueue, MIN_REQUEST_INTERVAL - timeSinceLastRequest);
  }
};

const queueRequest = (fn) => {
  return new Promise((resolve, reject) => {
    requestQueue.push({ resolve, reject, fn });
    processQueue();
  });
};

// Cache for Gemini model
let cachedGeminiModel = null;

// AI Chatbot API endpoint
app.post('/api/chatbot', async (req, res) => {
  try {
    const { message, history, provider } = req.body;

    console.log(`[Chatbot] Provider: ${provider}`);

    const systemPrompt = `You are an intelligent meeting assistant for a video conferencing platform called Shortmeet. 
Your role is to help users with:
- Video conferencing controls (camera, microphone, screen sharing)
- Technical troubleshooting (connection issues, audio/video problems)
- Meeting best practices and etiquette
- Participant management and invitations
- Recording features
- Security and privacy
- Keyboard shortcuts

Provide clear, concise, and helpful responses. Use bullet points and formatting when appropriate. 
Be friendly and professional.`;

    if (provider === 'openai') {
      const OpenAI = require('openai');
      
      if (!process.env.OPENAI_API_KEY) {
        throw new Error('OpenAI API key not configured.');
      }

      const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });

      const completion = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: systemPrompt },
          ...history.map(h => ({ role: h.role, content: h.content })),
          { role: "user", content: message }
        ],
        temperature: 0.7,
        max_tokens: 500,
      });

      const response = completion.choices[0].message.content;

      return res.json({ 
        response,
        provider: 'openai',
        model: 'gpt-3.5-turbo'
      });
    }

    if (provider === 'gemini') {
      if (!process.env.GEMINI_API_KEY) {
        throw new Error('Gemini API key not configured.');
      }

      const listModelsUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`;
      const listResponse = await fetch(listModelsUrl);
      
      if (!listResponse.ok) {
        throw new Error('Invalid Gemini API key');
      }
      
      const modelsData = await listResponse.json();
      const availableModel = modelsData.models?.find(m => 
        m.supportedGenerationMethods?.includes('generateContent')
      );
      
      if (!availableModel) {
        throw new Error('No compatible Gemini models found');
      }
      
      const modelName = availableModel.name.replace('models/', '');
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${process.env.GEMINI_API_KEY}`;

      let conversationContext = systemPrompt + "\n\n";
      if (history && history.length > 0) {
        conversationContext += "Previous conversation:\n";
        history.forEach(h => {
          conversationContext += `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}\n`;
        });
      }
      conversationContext += `\nUser: ${message}\nAssistant:`;

      const requestBody = {
        contents: [{ parts: [{ text: conversationContext }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 500,
        }
      };

      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `API error: ${response.status}`);
      }

      const data = await response.json();
      const aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (!aiResponse) {
        throw new Error('No response from Gemini');
      }

      return res.json({ 
        response: aiResponse,
        provider: 'gemini',
        model: modelName
      });
    }

    throw new Error(`Unknown provider: ${provider}`);

  } catch (error) {
    console.error('[Chatbot Error]:', error.message);
    res.status(500).json({ 
      error: error.message,
      response: `Error: ${error.message}`
    });
  }
});

// Transcript summarization endpoint
app.post('/api/summarize-transcript', async (req, res) => {
  try {
    const { transcript } = req.body;

    if (!transcript) {
      return res.status(400).json({
        success: false,
        error: 'Transcript is required'
      });
    }

    if (!process.env.GEMINI_API_KEY) {
      throw new Error('Gemini API key not configured');
    }

    let modelName = cachedGeminiModel || 'gemini-pro';
    
    if (!cachedGeminiModel) {
      try {
        const listModelsUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`;
        const listResponse = await fetch(listModelsUrl);
        
        if (listResponse.ok) {
          const modelsData = await listResponse.json();
          const availableModel = modelsData.models?.find(m => 
            m.supportedGenerationMethods?.includes('generateContent')
          );
          
          if (availableModel) {
            modelName = availableModel.name.replace('models/', '');
            cachedGeminiModel = modelName;
          }
        }
      } catch (error) {
        modelName = 'gemini-pro';
      }
    }

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const prompt = `Please provide a concise summary of this meeting transcript. Focus on key points, decisions made, and action items.

Transcript:
${transcript}

Provide a well-structured summary.`;

    const requestBody = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 1000,
      }
    };

    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `API error: ${response.status}`);
    }

    const data = await response.json();
    const summary = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!summary) {
      throw new Error('No response from AI');
    }

    return res.json({ 
      success: true,
      summary: summary,
      provider: 'gemini',
      model: modelName
    });

  } catch (error) {
    console.error('[Transcript Summary Error]:', error.message);
    res.status(500).json({ 
      success: false,
      error: error.message
    });
  }
});

// Test Gemini API endpoint
app.get('/api/test-gemini', async (req, res) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return res.json({ 
        status: 'error',
        message: 'No API key configured in .env file'
      });
    }

    console.log('[Test] Checking Gemini API key...');
    
    const listModelsUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`;
    const response = await fetch(listModelsUrl);
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return res.json({
        status: 'error',
        message: 'API key is invalid or restricted',
        details: errorData
      });
    }

    const data = await response.json();
    const models = data.models?.map(m => m.name) || [];
    
    return res.json({
      status: 'success',
      message: 'API key is valid!',
      availableModels: models.length,
      models: models.slice(0, 3)
    });
  } catch (error) {
    return res.json({
      status: 'error',
      message: error.message
    });
  }
});

// Global search endpoint
app.post('/api/global-search', async (req, res) => {
  try {
    const { query, provider = 'gemini' } = req.body;

    console.log(`[Global Search] Query: ${query}, Provider: ${provider}`);

    const searchPrompt = `You are a helpful AI assistant. Answer this question concisely: ${query}`;

    if (provider === 'claude') {
      if (!process.env.CLAUDE_API_KEY) {
        throw new Error('Claude API key not configured in .env file');
      }

      console.log('[Global Search] Using Claude API...');
      
      const Anthropic = require('@anthropic-ai/sdk');
      const anthropic = new Anthropic({
        apiKey: process.env.CLAUDE_API_KEY,
      });

      const message = await anthropic.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 500,
        messages: [
          {
            role: 'user',
            content: searchPrompt
          }
        ]
      });

      const aiResponse = message.content[0].text;
      console.log('[Claude] Response received successfully');

      return res.json({
        response: aiResponse,
        provider: 'claude',
        model: 'claude-3-haiku-20240307'
      });
    }

    if (provider === 'gemini') {
      if (!process.env.GEMINI_API_KEY) {
        throw new Error('Gemini API key not configured');
      }

      let modelName = cachedGeminiModel || 'gemini-pro';
      
      if (!cachedGeminiModel) {
        try {
          const listModelsUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`;
          const listResponse = await fetch(listModelsUrl);
          
          if (listResponse.ok) {
            const modelsData = await listResponse.json();
            const availableModel = modelsData.models?.find(m => 
              m.supportedGenerationMethods?.includes('generateContent')
            );
            
            if (availableModel) {
              modelName = availableModel.name.replace('models/', '');
              cachedGeminiModel = modelName;
            }
          }
        } catch (error) {
          modelName = 'gemini-pro';
        }
      }
      
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${process.env.GEMINI_API_KEY}`;

      const requestBody = {
        contents: [{ parts: [{ text: searchPrompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 500,
        }
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        
        if (errorData.error?.message?.includes('RESOURCE_EXHAUSTED') || 
            errorData.error?.message?.includes('quota') ||
            errorData.error?.status === 'RESOURCE_EXHAUSTED') {
          throw new Error('RATE_LIMIT: Gemini is currently overloaded. Please wait 2-3 minutes and try again.');
        }
        
        throw new Error(errorData.error?.message || `API error: ${response.status}`);
      }

      const data = await response.json();
      const aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (!aiResponse) {
        if (data.candidates?.[0]?.finishReason === 'SAFETY') {
          throw new Error('Response blocked by safety filters. Try rephrasing your question.');
        }
        throw new Error('No response from AI. The API may be overloaded.');
      }

      return res.json({ 
        response: aiResponse,
        provider: 'gemini',
        model: modelName
      });
    }

    if (provider === 'openai') {
      const OpenAI = require('openai');
      
      if (!process.env.OPENAI_API_KEY) {
        throw new Error('OpenAI API key not configured.');
      }

      const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });

      const completion = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: "You are a helpful AI assistant with access to global knowledge. Provide accurate, concise, and helpful answers."
          },
          {
            role: "user",
            content: searchPrompt
          }
        ],
        max_tokens: 800,
        temperature: 0.7,
      });

      const aiResponse = completion.choices[0]?.message?.content;
      
      if (!aiResponse) {
        throw new Error('No response from OpenAI');
      }

      return res.json({
        response: aiResponse,
        provider: 'openai',
        model: 'gpt-3.5-turbo'
      });
    }

    throw new Error('Invalid provider. Use "openai", "gemini", or "claude"');

  } catch (error) {
    console.error('[Global Search Error]:', error.message);
    
    let userMessage = error.message;
    
    if (error.message.includes('RATE_LIMIT') || error.message.includes('RESOURCE_EXHAUSTED')) {
      userMessage = `⏱️ Gemini Rate Limit - Wait 2-3 minutes and try again.`;
    } else if (error.message.includes('API_KEY_INVALID') || error.message.includes('API key')) {
      userMessage = `🔑 API Key Issue - Check your API key configuration.`;
    } else if (error.message.includes('safety')) {
      userMessage = `⚠️ Content Blocked - Try rephrasing your question.`;
    }
    
    res.status(500).json({ 
      error: error.message,
      response: userMessage,
    });
  }
});

// Get chat history
app.get('/api/chat-history/:roomId', async (req, res) => {
  try {
    const { roomId } = req.params;
    const messages = await ChatMessage.getByRoom(roomId);
    res.json({ messages: messages.slice(0, 100) });
  } catch (error) {
    console.log('[Firebase] Could not fetch chat history:', error.message);
    res.json({ messages: [] });
  }
});

// Create room
app.post('/api/room/create', async (req, res) => {
  try {
    console.log('Incoming request body:', req.body);
    
    const username = req.body.username || req.body.userName || req.body.name;
    const password = req.body.password;
    
    if (!req.body.roomName) {
      return res.status(400).json({
        success: false,
        error: 'roomName is required',
        received: req.body
      });
    }
    
    if (!username) {
      return res.status(400).json({
        success: false,
        error: 'Username field (username/userName/name) is required',
        received: req.body
      });
    }

    const roomCode = generateRoomCode();
    const meetingId = generateMeetingId();
    const userId = `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const settings = {
      password: password || '',
      maxParticipants: 100,
      recordingEnabled: false,
      waitingRoom: false,
      muteOnJoin: false,
      videoOnJoin: true,
      chatEnabled: true,
      screenShareEnabled: true
    };

    try {
      await Meeting.create({
        roomCode,
        meetingId,
        roomName: req.body.roomName.trim(),
        hostUserId: userId,
        hostName: username.trim(),
        participants: [{
          userId,
          userName: username.trim(),
          joinedAt: new Date(),
          isHost: true,
          cameraOn: true,
          micOn: true
        }],
        settings,
        isInstant: req.body.isInstant || false
      });
      
      console.log(`[Firebase] Meeting created: ${roomCode} by ${username}`);
    } catch (dbError) {
      console.log('[Firebase] Save failed:', dbError.message);
      console.log('[Memory] Storing in memory as fallback');
      
      inMemoryRooms.set(roomCode, {
        roomCode,
        meetingId,
        roomName: req.body.roomName.trim(),
        hostUserId: userId,
        hostName: username.trim(),
        participants: [{
          userId,
          userName: username.trim(),
          joinedAt: new Date(),
          isHost: true,
          cameraOn: true,
          micOn: true
        }],
        settings,
        isActive: true,
        startTime: new Date(),
        isInstant: req.body.isInstant || false
      });
    }
    
    res.status(201).json({ 
      success: true,
      roomCode,
      meetingId,
      roomName: req.body.roomName.trim(),
      userId,
      username: username.trim(),
      hostName: username.trim(),
      meetingLink: `/room/${roomCode}`,
      settings,
      status: 'new',
      debug: { received: req.body }
    });
    
  } catch (error) {
    console.error('Room creation error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Join room
app.post('/api/room/join', async (req, res) => {
  try {
    const { roomCode, username, password } = req.body;
    
    console.log(`[Room] Join request: ${roomCode} by ${username}`);
    
    if (!roomCode || !username) {
      return res.status(400).json({ 
        success: false, 
        error: 'Room code and username are required' 
      });
    }
    
    const userId = `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    let meeting = null;
    
    try {
      meeting = await Meeting.getByRoomCode(roomCode);
    } catch (dbError) {
      console.log('[Firebase] Database not available, checking memory only');
    }
    
    if (!meeting) {
      meeting = inMemoryRooms.get(roomCode);
    }
    
    if (!meeting || !meeting.isActive) {
      return res.status(404).json({ 
        success: false, 
        error: 'Room not found or meeting has ended' 
      });
    }
    
    if (meeting.settings.password && meeting.settings.password !== password) {
      return res.status(401).json({ 
        success: false, 
        error: 'Incorrect password' 
      });
    }
    
    const activeParticipants = meeting.participants.filter(p => !p.leftAt).length;
    if (activeParticipants >= meeting.settings.maxParticipants) {
      return res.status(403).json({ 
        success: false, 
        error: 'Room is full' 
      });
    }
    
    const newParticipant = {
      userId,
      userName: username,
      joinedAt: new Date(),
      isHost: false
    };
    
    meeting.participants.push(newParticipant);
    
    try {
      await Meeting.update(meeting.id, {
        participants: meeting.participants
      });
      console.log(`[Firebase] User ${username} joined room ${meeting.roomCode}`);
    } catch (dbError) {
      console.log('[Memory] User joined room (Firebase not available)');
      
      const room = inMemoryRooms.get(roomCode);
      if (room) {
        room.participants.push(newParticipant);
      }
    }
    
    res.json({ 
      success: true, 
      roomCode: meeting.roomCode,
      meetingId: meeting.meetingId,
      roomName: meeting.roomName,
      userId,
      username,
      hostName: meeting.hostName,
      settings: meeting.settings,
      message: 'Joined room successfully' 
    });
    
  } catch (error) {
    console.error('[Room Join Error]:', error.message);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to join room. Please try again.' 
    });
  }
});

// End meeting
app.post('/api/room/end', async (req, res) => {
  try {
    const { roomId, userId } = req.body;
    
    console.log(`[Room] End request: ${roomId} by ${userId}`);
    
    let meeting = null;
    
    try {
      meeting = await Meeting.getByRoomCode(roomId);
    } catch (error) {
      console.log('[Firebase] Error fetching meeting');
    }
    
    if (!meeting) {
      meeting = inMemoryRooms.get(roomId);
    }
    
    if (!meeting) {
      return res.status(404).json({ 
        success: false, 
        error: 'Room not found' 
      });
    }
    
    if (meeting.hostUserId !== userId) {
      return res.status(403).json({ 
        success: false, 
        error: 'Only the host can end the meeting' 
      });
    }
    
    try {
      await Meeting.update(meeting.id, {
        isActive: false,
        endTime: new Date()
      });
      
      console.log(`[Firebase] Meeting ended: ${roomId}`);
    } catch (error) {
      console.log('[Memory] Meeting ended (Firebase not available)');
      inMemoryRooms.delete(roomId);
    }
    
    res.json({ 
      success: true, 
      message: 'Meeting ended and data deleted successfully' 
    });
    
  } catch (error) {
    console.error('[Room End Error]:', error.message);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to end meeting' 
    });
  }
});

// Leave meeting
app.post('/api/room/leave', async (req, res) => {
  try {
    const { roomId, userId } = req.body;
    
    console.log(`[Room] Leave request: ${roomId} by ${userId}`);
    
    try {
      const meeting = await Meeting.getByRoomCode(roomId);
      
      if (meeting) {
        const participant = meeting.participants.find(p => p.userId === userId);
        if (participant) {
          participant.leftAt = new Date();
          await Meeting.update(meeting.id, {
            participants: meeting.participants
          });
        }
        
        const activeParticipants = meeting.participants.filter(p => !p.leftAt).length;
        if (activeParticipants === 0) {
          await Meeting.update(meeting.id, {
            isActive: false,
            endTime: new Date()
          });
          
          console.log(`[Firebase] All participants left. Meeting ended: ${roomId}`);
        }
      }
    } catch (dbError) {
      console.log('[Room] Firebase not available, using in-memory storage');
      
      const room = inMemoryRooms.get(roomId);
      
      if (room) {
        const participant = room.participants.find(p => p.userId === userId);
        if (participant) {
          participant.leftAt = new Date();
        }
        
        const activeParticipants = room.participants.filter(p => !p.leftAt).length;
        if (activeParticipants === 0) {
          inMemoryRooms.delete(roomId);
          console.log(`[Memory] All participants left. Room deleted: ${roomId}`);
        }
      }
    }
    
    res.json({ 
      success: true, 
      message: 'Left room successfully' 
    });
    
  } catch (error) {
    console.error('[Room Leave Error]:', error.message);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to leave room' 
    });
  }
});

// Get room information
app.get('/api/room/:roomCode', async (req, res) => {
  try {
    const { roomCode } = req.params;
    
    console.log(`[Room] Getting room info: ${roomCode}`);
    
    let meeting = null;
    
    try {
      meeting = await Meeting.getByRoomCode(roomCode);
    } catch (dbError) {
      console.log('[Firebase] Database not available, checking memory only');
    }
    
    if (!meeting) {
      meeting = inMemoryRooms.get(roomCode);
    }
    
    if (!meeting || !meeting.isActive) {
      return res.status(404).json({ 
        success: false, 
        error: 'Room not found or meeting has ended' 
      });
    }
    
    res.json({ 
      success: true, 
      roomCode: meeting.roomCode,
      meetingId: meeting.meetingId,
      roomName: meeting.roomName,
      hostName: meeting.hostName,
      participantCount: meeting.participants.filter(p => !p.leftAt).length,
      maxParticipants: meeting.settings.maxParticipants,
      isPasswordProtected: !!meeting.settings.password,
      createdAt: meeting.createdAt,
      startTime: meeting.startTime,
      settings: {
        recordingEnabled: meeting.settings.recordingEnabled,
        waitingRoom: meeting.settings.waitingRoom,
        muteOnJoin: meeting.settings.muteOnJoin,
        videoOnJoin: meeting.settings.videoOnJoin,
        chatEnabled: meeting.settings.chatEnabled,
        screenShareEnabled: meeting.settings.screenShareEnabled
      }
    });
    
  } catch (error) {
    console.error('[Room Info Error]:', error.message);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to get room information' 
    });
  }
});

// ============================================
// SERVER STARTUP - Railway Compatible
// ============================================
let serverStarted = false;
let isShuttingDown = false;

// Graceful shutdown for SIGINT (Ctrl+C)
process.on('SIGINT', async () => {
  console.log('\n🛑 Received SIGINT. Shutting down gracefully...');
  isShuttingDown = true;
  serverStarted = false;

  try {
    // Close server
    server.close(() => {
      console.log('✅ Server closed');
    });
    
    // Close Socket.IO
    io.close(() => {
      console.log('✅ Socket.IO closed');
    });
    
    console.log('✅ Firebase connections will be cleaned up automatically');
  } catch (error) {
    console.log('⚠️ Error during cleanup:', error.message);
  }

  console.log('👋 Server shutdown complete');
  process.exit(0);
});

// Graceful shutdown for SIGTERM (Railway/Docker)
process.on('SIGTERM', async () => {
  console.log('\n🛑 Received SIGTERM. Shutting down gracefully...');
  isShuttingDown = true;
  serverStarted = false;
  
  try {
    // Close server
    server.close(() => {
      console.log('✅ Server closed');
    });
    
    // Close Socket.IO
    io.close(() => {
      console.log('✅ Socket.IO closed');
    });
  } catch (error) {
    console.log('⚠️ Error during cleanup:', error.message);
  }
  
  console.log('👋 Shutdown complete');
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  if (process.env.NODE_ENV === 'production') {
    // In production, gracefully shutdown
    process.exit(1);
  }
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  if (process.env.NODE_ENV === 'production') {
    // In production, gracefully shutdown
    process.exit(1);
  }
});

const startServer = async () => {
  if (serverStarted || isShuttingDown) {
    console.log('Server startup skipped (already running or shutting down)');
    return;
  }

  try {
    console.log('✅ Firebase connection initialized');

    // Railway provides PORT environment variable
    const PORT = process.env.PORT || 3001;
    const HOST = process.env.RAILWAY_ENVIRONMENT ? '0.0.0.0' : 'localhost';

    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.log(`⚠️ Port ${PORT} already in use`);
        console.log('💡 Try: taskkill /f /im node.exe (Windows) or killall node (Mac/Linux)');
      } else if (!isShuttingDown) {
        console.error('❌ Server error:', error.message);
      }
    });

    server.listen(PORT, HOST, () => {
      if (!isShuttingDown) {
        serverStarted = true;
        console.log('');
        console.log('═══════════════════════════════════════════════════════');
        console.log('🚀 SHORTMEET SERVER STARTED SUCCESSFULLY');
        console.log('═══════════════════════════════════════════════════════');
        console.log(`📍 Port:        ${PORT}`);
        console.log(`🌐 Host:        ${HOST}`);
        console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`🔥 Database:    Firebase Firestore`);
        console.log(`⚡ Socket.IO:   Enabled (WebSocket + Polling)`);
        
        if (process.env.RAILWAY_ENVIRONMENT) {
          console.log(`🚂 Platform:    Railway`);
          console.log(`🌍 Environment: ${process.env.RAILWAY_ENVIRONMENT}`);
          if (process.env.RAILWAY_PUBLIC_DOMAIN) {
            console.log(`🌐 Public URL:  https://${process.env.RAILWAY_PUBLIC_DOMAIN}`);
          } else {
            console.log(`🌐 Public URL:  Pending... (check Railway dashboard)`);
          }
        } else {
          console.log(`🏠 Platform:    Local Development`);
          console.log(`🔗 Local URL:   http://localhost:${PORT}`);
        }
        
        console.log('═══════════════════════════════════════════════════════');
        console.log('');
        console.log('✅ Server is ready to accept connections');
        console.log('📊 Health Check: /health');
        console.log('🏠 Root Endpoint: /');
        console.log('');
        console.log('Available API Endpoints:');
        console.log('  POST   /api/room/create');
        console.log('  POST   /api/room/join');
        console.log('  POST   /api/room/end');
        console.log('  POST   /api/room/leave');
        console.log('  GET    /api/room/:roomCode');
        console.log('  POST   /api/chatbot');
        console.log('  POST   /api/global-search');
        console.log('  POST   /api/summarize-transcript');
        console.log('  GET    /api/chat-history/:roomId');
        console.log('  GET    /api/test-gemini');
        console.log('');
        console.log('═══════════════════════════════════════════════════════');
      }
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
};

// Start the server
startServer();