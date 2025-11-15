require('dotenv').config({ path: './config.env' }); // Load environment variables
const express = require('express');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');
const fetch = require('node-fetch'); // Add fetch for Node.js
const cors = require('cors');
const mongoose = require('mongoose'); // Import mongoose

// Database imports
const { connectDB } = require('./database/connection');
const ChatMessage = require('./database/models/ChatMessage');
const Meeting = require('./database/models/Meeting');
const User = require('./database/models/User');
const Room = require('./database/models/Room'); // Import Room model

console.log('NODE_ENV:', process.env.NODE_ENV); // Debug log

const app = express();

// Enhanced CORS and Socket.IO setup
// Allow all origins in development, or specific origins in production
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',')
  : true; // Allow all origins in development

app.use(cors({
  origin: (origin, callback) => {
    console.log('🔍 CORS check for origin:', origin);
    
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) {
      console.log('✅ No origin - allowing');
      return callback(null, true);
    }
    
    // Explicitly allow localhost dev servers (Vite typically uses 5173, but can be 5174)
    if (origin === 'http://localhost:5173' || origin === 'http://localhost:5174') {
      console.log('✅ Localhost dev server explicitly allowed');
      return callback(null, true);
    }
    
    // If allowedOrigins is true, allow all
    if (allowedOrigins === true) {
      console.log('✅ All origins allowed (development mode)');
      return callback(null, true);
    }
    
    // Check if origin is in allowed list
    if (Array.isArray(allowedOrigins) && allowedOrigins.includes(origin)) {
      console.log('✅ Origin in allowed list');
      return callback(null, true);
    }
    
    // Allow all localhost and tunnel domains
    if (origin.includes('localhost') || 
        origin.includes('127.0.0.1') || 
        origin.includes('ngrok') ||
        origin.includes('loca.lt')) {
      console.log('✅ Localhost or tunnel domain - allowing');
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

// Handle preflight OPTIONS requests
app.options('*', cors());

// Request logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} - Body:`, JSON.stringify(req.body));
  next();
});

// Check if SSL certificates exist
const sslKeyPath = path.join(__dirname, 'ssl', 'key.pem');
const sslCertPath = path.join(__dirname, 'ssl', 'cert.pem');
const useHTTPS = fs.existsSync(sslKeyPath) && fs.existsSync(sslCertPath) && process.env.NODE_ENV === 'production' && process.env.FORCE_HTTPS === 'true';

let server;
try {
  if (useHTTPS) {
    const sslOptions = {
      key: fs.readFileSync(sslKeyPath),
      cert: fs.readFileSync(sslCertPath)
    };
    server = https.createServer(sslOptions, app);
    console.log('🚀 Server starting with HTTPS');
  } else {
    server = http.createServer(app);
    console.log('🚀 Server starting with HTTP');
  }
} catch (sslError) {
  console.log('⚠️  SSL certificate error, falling back to HTTP:', sslError.message);
  server = http.createServer(app);
  console.log('🚀 Server starting with HTTP (fallback)');
}

// Enhanced Socket.IO configuration
const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      // Allow requests with no origin
      if (!origin) return callback(null, true);
      
      // Explicitly allow localhost:5173 (Vite dev server)
      if (origin === 'http://localhost:5173' || origin === 'http://localhost:5174') return callback(null, true);
      
      // Allow all origins in development
      if (allowedOrigins === true) return callback(null, true);
      
      // Check if origin is in allowed list
      if (Array.isArray(allowedOrigins) && allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      
      // Allow all localhost and ngrok domains
      if (origin.includes('localhost') || 
          origin.includes('127.0.0.1') || 
          origin.includes('ngrok') ||
          origin.includes('loca.lt')) {
        return callback(null, true);
      }
      
      callback(null, true); // Allow all in development
    },
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000
});

// Enhanced WebSocket reliability
io.engine.on("connection_error", (err) => {
  console.log(`❌ Socket.IO connection error: ${err.req.headers.origin}`);
  console.log(err.message);
  console.log(err.description);
  console.log(err.context);
});

// WebSocket Reliability Settings
io.engine.opts.pingTimeout = 60000;
io.engine.opts.pingInterval = 25000;

// WebRTC Signaling handlers
io.on('connection', (socket) => {
  console.log(`✅ Socket connected: ${socket.id}`);
  
  socket.on('join-room', (roomId, userId, userData) => {
    socket.join(roomId);
    socket.userId = userId; // Store userId on socket
    socket.userData = userData;
    
    // Notify other users in the room about the new user
    socket.to(roomId).emit('user-connected', {
      userId,
      ...userData
    });
    
    // Send existing participants to the new user
    const clients = Array.from(io.sockets.adapter.rooms.get(roomId) || []);
    const others = clients
      .filter(id => id !== socket.id)
      .map(id => ({
        userId: io.sockets.sockets.get(id).userId,
        ...io.sockets.sockets.get(id).userData
      }));
    socket.emit('room-users', others);
  });
  
  socket.on('signal', ({roomId, targetUserId, signal}) => {
    // Find the target user's socket
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
      console.log(`📡 Relayed signal from ${socket.userId} to ${targetUserId}`);
    } else {
      console.log(`❌ Target user ${targetUserId} not found in room ${roomId}`);
    }
  });
  
  // Chat message handlers
  socket.on('send-message', (messageData) => {
    console.log(`💬 Chat message from ${socket.userId} in room ${messageData.roomId}: ${messageData.message}`);
    
    // Broadcast message to all other users in the room
    socket.to(messageData.roomId).emit('receive-message', {
      userId: socket.userId,
      userName: messageData.userName,
      message: messageData.message,
      timestamp: messageData.timestamp
    });
    
    console.log(`📤 Broadcasted message to room ${messageData.roomId}`);
  });

  socket.on('disconnect', () => {
    console.log(`❌ Socket disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3001;

// Start server with port handling
// Removed duplicate server.listen call - startServer() handles this at the bottom of the file

// Middleware
app.use(express.json({ limit: '10mb' })); // Increase limit for large requests

// Handle glyphicons font requests (prevent 404 errors)
app.get('/fonts/glyphicons-halflings-regular.*', (req, res) => {
  // Return 204 No Content to prevent 404 errors
  res.status(204).end();
});

// Handle any glyphicons requests globally
app.get('*glyphicons*', (req, res) => {
  // Return 204 No Content for any glyphicons request
  res.status(204).end();
});

// Serve glyphicons fallback CSS with cache control
app.get('/fonts/glyphicons-fallback.css', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, '..', 'public', 'fonts', 'glyphicons-fallback.css'));
});

// Basic route
app.get('/', (req, res) => {
  res.send('Shortmeet Server is running');
});

// Generate unique room code (like Google Meet)
const generateRoomCode = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 10; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

// Generate meeting ID (shorter, like Zoom)
const generateMeetingId = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 9; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

// Store active rooms and users with their metadata
const rooms = new Map(); // roomId -> Map of userId -> {name, cameraOn, micOn}
const inMemoryRooms = new Map(); // Fallback storage when MongoDB is not available

// Rate limiting for API requests
const requestQueue = [];
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 4000; // 4 seconds between requests (15 per minute = 4s interval)

// Process request queue
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
    
    // Process next in queue after interval
    setTimeout(processQueue, MIN_REQUEST_INTERVAL);
  } else {
    // Wait for remaining time
    setTimeout(processQueue, MIN_REQUEST_INTERVAL - timeSinceLastRequest);
  }
};

// Queue a request
const queueRequest = (fn) => {
  return new Promise((resolve, reject) => {
    requestQueue.push({ resolve, reject, fn });
    processQueue();
  });
};

// Real-time AI Chatbot API endpoint with ChatGPT and Google Gemini
app.post('/api/chatbot', async (req, res) => {
  try {
    const { message, history, provider } = req.body;

    console.log(`[Chatbot] Received request - Provider: ${provider}, Message: ${message.substring(0, 50)}...`);

    // System prompt for meeting assistant context
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
Be friendly and professional. If you don't know something specific to Shortmeet, provide general video conferencing advice.`;

    // OpenAI (ChatGPT) Integration
    if (provider === 'openai') {
      const OpenAI = require('openai');
      
      if (!process.env.OPENAI_API_KEY) {
        throw new Error('OpenAI API key not configured. Please add OPENAI_API_KEY to your .env file.');
      }

      const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });

      console.log('[ChatGPT] Sending request to OpenAI...');

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
      console.log('[ChatGPT] Response received successfully');

      return res.json({ 
        response,
        provider: 'openai',
        model: 'gpt-3.5-turbo'
      });
    }

    // Google Gemini Integration (Direct REST API - v1beta)
    if (provider === 'gemini') {
      if (!process.env.GEMINI_API_KEY) {
        throw new Error('Google Gemini API key not configured. Please add GEMINI_API_KEY to your .env file.');
      }

      console.log('[Gemini] Checking available models...');
      
      try {
        // First, fetch the list of available models
        const listModelsUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`;
        
        const listResponse = await fetch(listModelsUrl);
        
        if (!listResponse.ok) {
          const errorData = await listResponse.json().catch(() => ({}));
          console.error('[Gemini] Failed to list models:', errorData);
          throw new Error(`Cannot access Gemini API. Status: ${listResponse.status}. Your API key may be invalid or restricted. Please create a new key at https://aistudio.google.com/app/apikey`);
        }
        
        const modelsData = await listResponse.json();
        console.log('[Gemini] Available models:', modelsData.models?.map(m => m.name).join(', '));
        
        // Find a model that supports generateContent
        const availableModel = modelsData.models?.find(m => 
          m.supportedGenerationMethods?.includes('generateContent') &&
          (m.name.includes('gemini-pro') || m.name.includes('gemini-1.5') || m.name.includes('gemini'))
        );
        
        if (!availableModel) {
          throw new Error('No compatible Gemini models found for your API key. Please verify your API key has access to Gemini models.');
        }
        
        // Extract model name (remove 'models/' prefix)
        const modelName = availableModel.name.replace('models/', '');
        console.log(`[Gemini] Using model: ${modelName}`);
        
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${process.env.GEMINI_API_KEY}`;

        // Build conversation context
        let conversationContext = systemPrompt + "\n\n";
        if (history && history.length > 0) {
          conversationContext += "Previous conversation:\n";
          history.forEach(h => {
            conversationContext += `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}\n`;
          });
        }
        conversationContext += `\nUser: ${message}\nAssistant:`;

        // Prepare request body for Gemini API
        const requestBody = {
          contents: [
            {
              parts: [
                {
                  text: conversationContext
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 500,
          }
        };

        console.log('[Gemini] Sending request to Gemini API...');
        
        // Set a longer timeout for the API call
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000); // Increased to 60 seconds
        
        // Add delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 2000)); // Increased to 2 seconds
        
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          console.error('[Gemini] API Error Response:', errorData);
          throw new Error(errorData.error?.message || `API returned ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        
        // Extract text from Gemini response
        const aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (!aiResponse) {
          throw new Error('No response text received from Gemini API');
        }
        
        console.log(`[Gemini] Response received successfully`);

        return res.json({ 
          response: aiResponse,
          provider: 'gemini',
          model: modelName
        });
      } catch (error) {
        console.error(`[Gemini] Error details:`, error);
        
        // Provide more specific error messages with retry suggestions
        if (error.name === 'AbortError') {
          throw new Error('⏱️ Request timed out after 60 seconds. The API is likely overloaded. Please wait 30 seconds and try again.');
        } else if (error.message.includes('API_KEY_INVALID') || error.message.includes('API key') || error.message.includes('401') || error.message.includes('403')) {
          throw new Error('🔑 Invalid API key. Please:\n1. Visit https://aistudio.google.com/app/apikey\n2. Create a NEW key\n3. Update server/.env\n4. Restart the server');
        } else if (error.message.includes('quota') || error.message.includes('429') || error.message.includes('RESOURCE_EXHAUSTED')) {
          throw new Error('🚫 Rate limit exceeded. Free tier: 15 requests/min.\n\nSolutions:\n• Wait 60 seconds before next request\n• Use the chatbot less frequently\n• Get a paid API key for higher limits\n• The server now queues requests automatically');
        } else {
          throw new Error(`Gemini error: ${error.message}`);
        }
      }
    }

    // If no provider matches
    throw new Error(`Unknown provider: ${provider}. Use 'openai' or 'gemini'.`);

  } catch (error) {
    console.error('[Chatbot API Error]:', error.message);
    
    res.status(500).json({ 
      error: error.message,
      response: `Error: ${error.message}`,
      details: 'Please check your API key configuration and server logs.'
    });
  }
});

// Test API Key endpoint
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

// Cache the Gemini model name to avoid repeated API calls
let cachedGeminiModel = null;

// Global AI Search API endpoint
app.post('/api/global-search', async (req, res) => {
  try {
    const { query, provider = 'claude' } = req.body; // Changed default to claude

    console.log(`[Global Search] Query: ${query}, Provider: ${provider}`);

    // Enhanced system prompt for global search
    const searchPrompt = `You are a helpful AI assistant. Answer this question concisely: ${query}`;

    // Claude Integration (NEW - RECOMMENDED)
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
        model: 'claude-3-haiku-20240307', // Fast and cheap model
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
        throw new Error('Gemini API key not configured in .env file');
      }

      console.log('[Global Search] Using Gemini API...');
      
      // Use cached model or default to gemini-pro to avoid extra API call
      let modelName = cachedGeminiModel || 'gemini-pro';
      
      // Only fetch models if we don't have a cached one
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
              cachedGeminiModel = modelName; // Cache it
              console.log('[Global Search] Cached model:', modelName);
            }
          }
        } catch (error) {
          console.log('[Global Search] Using default model: gemini-pro');
          modelName = 'gemini-pro';
        }
      }
      
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${process.env.GEMINI_API_KEY}`;

      const requestBody = {
        contents: [{ parts: [{ text: searchPrompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 500, // Reduced to save quota
        }
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); // Increased to 60 seconds
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('[Global Search] Response Error:', errorData);
        
        // Check for rate limit
        if (errorData.error?.message?.includes('RESOURCE_EXHAUSTED') || 
            errorData.error?.message?.includes('quota') ||
            errorData.error?.status === 'RESOURCE_EXHAUSTED') {
          throw new Error('RATE_LIMIT: Gemini is currently overloaded. Please wait 2-3 minutes and try again, or add payment method for higher limits.');
        }
        
        throw new Error(errorData.error?.message || `API error: ${response.status}`);
      }

      const data = await response.json();
      console.log('[Global Search] API Response:', JSON.stringify(data).substring(0, 200));
      
      const aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (!aiResponse) {
        console.error('[Global Search] No text in response:', data);
        
        // Check if blocked by safety filters
        if (data.candidates?.[0]?.finishReason === 'SAFETY') {
          throw new Error('Response blocked by safety filters. Try rephrasing your question.');
        }
        
        throw new Error('No response from AI. The API may be overloaded.');
      }
      
      console.log('[Global Search] Response received successfully');

      return res.json({ 
        response: aiResponse,
        provider: 'gemini',
        model: modelName
      });
    }

    // OpenAI Integration for Global Search
    if (provider === 'openai') {
      const OpenAI = require('openai');
      
      if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'your_openai_api_key_here') {
        throw new Error('OpenAI API key not configured. Please add OPENAI_API_KEY to your .env file or use Gemini instead.');
      }

      console.log('[Global Search] Using OpenAI API...');

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

      console.log('[Global Search] OpenAI response received successfully');

      return res.json({
        response: aiResponse,
        provider: 'openai',
        model: 'gpt-3.5-turbo'
      });
    }

    throw new Error('Invalid provider. Use "openai" or "gemini"');

  } catch (error) {
    console.error('[Global Search Error]:', error.message);
    console.error('[Global Search Error Stack]:', error.stack);
    
    let userMessage = error.message;
    
    if (error.message.includes('RATE_LIMIT') || error.message.includes('RESOURCE_EXHAUSTED')) {
      userMessage = `⏱️ **Gemini Rate Limit**\n\nYou've hit the free tier limit.\n\n**Solutions:**\n1. Wait 2-3 minutes and try again\n2. Enable billing for higher limits\n3. Use a different API key\n\nThe free tier resets every minute.`;
    } else if (error.message.includes('API_KEY_INVALID') || error.message.includes('API key')) {
      userMessage = `🔑 **API Key Issue**\n\nYour Gemini API key may be invalid.\n\n**Fix:**\n1. Visit https://aistudio.google.com/app/apikey\n2. Create new key\n3. Update server/.env\n4. Restart server`;
    } else if (error.message.includes('safety')) {
      userMessage = `⚠️ **Content Blocked**\n\nYour question was blocked by safety filters.\n\nTry rephrasing your question.`;
    } else {
      userMessage = `❌ **Search Error**\n\n${error.message}\n\n**Try:**\n• Wait a moment and retry\n• Check server console for details\n• Verify API key is configured`;
    }
    
    res.status(500).json({ 
      error: error.message,
      response: userMessage,
    });
  }
});

// API endpoint to get chat history
app.get('/api/chat-history/:roomId', async (req, res) => {
  try {
    const { roomId } = req.params;
    const messages = await ChatMessage.find({ roomId })
      .sort({ timestamp: 1 })
      .limit(100); // Last 100 messages
    
    res.json({ messages });
  } catch (error) {
    console.log('[DB] Could not fetch chat history:', error.message);
    res.json({ messages: [] });
  }
});

app.post('/api/room/create', async (req, res) => {
  try {
    console.log('Incoming request body:', req.body);
    
    // Accept all common username field variants
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

    // Generate unique room code and meeting ID
    const roomCode = generateRoomCode();
    const meetingId = generateMeetingId();
    const userId = `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Create meeting settings
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

    // Create new meeting
    const meeting = new Meeting({
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
      isInstant: req.body.isInstant || false
    });

    try {
      // Try to save to MongoDB
      await meeting.save();
      console.log(`[DB] Meeting created: ${roomCode} by ${username}`);
    } catch (dbError) {
      console.log('[DB] Database save failed:', dbError.message);
      console.log('[DB] Database not available, storing in memory only');
      
      // Store in memory as fallback
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

// API endpoint to join an existing room
app.post('/api/room/join', async (req, res) => {
  try {
    const { roomCode, username, password } = req.body;
    
    console.log(`[Room] Join request: ${roomCode} by ${username}`);
    
    // Validate input
    if (!roomCode || !username) {
      return res.status(400).json({ 
        success: false, 
        error: 'Room code and username are required' 
      });
    }
    
    // Generate unique user ID
    const userId = `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    let meeting = null;
    
    try {
      // Try MongoDB first
      meeting = await Meeting.findOne({ 
        $or: [{ roomCode }, { meetingId: roomCode }], 
        isActive: true 
      });
    } catch (dbError) {
      console.log('[DB] Database not available, checking memory only');
    }
    
    // If not found in DB, check in-memory storage
    if (!meeting) {
      meeting = inMemoryRooms.get(roomCode);
    }
    
    if (!meeting || !meeting.isActive) {
      return res.status(404).json({ 
        success: false, 
        error: 'Room not found or meeting has ended' 
      });
    }
    
    // Verify password if required
    if (meeting.settings.password && meeting.settings.password !== password) {
      return res.status(401).json({ 
        success: false, 
        error: 'Incorrect password' 
      });
    }
    
    // Check max participants
    const activeParticipants = meeting.participants.filter(p => !p.leftAt).length;
    if (activeParticipants >= meeting.settings.maxParticipants) {
      return res.status(403).json({ 
        success: false, 
        error: 'Room is full' 
      });
    }
    
    // Add participant
    const newParticipant = {
      userId,
      userName: username,
      joinedAt: new Date(),
      isHost: false
    };
    
    meeting.participants.push(newParticipant);
    
    try {
      // Try to save to MongoDB
      await meeting.save();
      console.log(`[DB] User ${username} joined room ${meeting.roomCode}`);
    } catch (dbError) {
      console.log('[Memory] User joined room (MongoDB not available)');
      
      // Store in memory as fallback
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

// API endpoint to end a meeting and delete data
app.post('/api/room/end', async (req, res) => {
  try {
    const { roomId, userId } = req.body;
    
    console.log(`[Room] End request: ${roomId} by ${userId}`);
    
    const meeting = await Meeting.findOne({ roomId, isActive: true });
    
    if (!meeting) {
      return res.status(404).json({ 
        success: false, 
        error: 'Room not found' 
      });
    }
    
    // Only host can end meeting
    if (meeting.hostUserId !== userId) {
      return res.status(403).json({ 
        success: false, 
        error: 'Only the host can end the meeting' 
      });
    }
    
    // Mark meeting as ended
    meeting.isActive = false;
    meeting.endTime = new Date();
    await meeting.save();
    
    // Delete chat messages for this room
    await ChatMessage.deleteMany({ roomId });
    
    console.log(`[DB] Meeting ended and data deleted: ${roomId}`);
    
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

// API endpoint to leave a meeting
app.post('/api/room/leave', async (req, res) => {
  try {
    const { roomId, userId } = req.body;
    
    console.log(`[Room] Leave request: ${roomId} by ${userId}`);
    
    try {
      // Try MongoDB first
      const meeting = await Meeting.findOne({ roomId, isActive: true });
      
      if (meeting) {
        // Mark participant as left
        const participant = meeting.participants.find(p => p.userId === userId);
        if (participant) {
          participant.leftAt = new Date();
          await meeting.save();
        }
        
        // If all participants have left, end the meeting and delete data
        const activeParticipants = meeting.participants.filter(p => !p.leftAt).length;
        if (activeParticipants === 0) {
          meeting.isActive = false;
          meeting.endTime = new Date();
          await meeting.save();
          
          // Delete chat messages
          await ChatMessage.deleteMany({ roomId });
          
          console.log(`[DB] All participants left. Meeting ended and data deleted: ${roomId}`);
        }
      }
    } catch (dbError) {
      // MongoDB not available, use in-memory storage
      console.log('[Room] MongoDB not available, using in-memory storage');
      
      const room = inMemoryRooms.get(roomId);
      
      if (room) {
        // Mark participant as left
        const participant = room.participants.find(p => p.userId === userId);
        if (participant) {
          participant.leftAt = new Date();
        }
        
        // If all participants have left, delete the room
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

// API endpoint to get room information
app.get('/api/room/:roomCode', async (req, res) => {
  try {
    const { roomCode } = req.params;
    
    console.log(`[Room] Getting room info: ${roomCode}`);
    
    let meeting = null;
    
    try {
      // Try MongoDB first
      meeting = await Meeting.findOne({ 
        $or: [{ roomCode }, { meetingId: roomCode }], 
        isActive: true 
      });
    } catch (dbError) {
      console.log('[DB] Database not available, checking memory only');
    }
    
    // If not found in DB, check in-memory storage
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

// Track if server is already started
let serverStarted = false;
let isShuttingDown = false;

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Received SIGINT. Shutting down gracefully...');
  isShuttingDown = true;
  serverStarted = false;

  try {
    await mongoose.connection.close();
    console.log('📊 MongoDB connection closed');
  } catch (error) {
    console.log('⚠️ Error closing MongoDB connection:', error.message);
  }

  console.log('👋 Server shutdown complete');
  process.exit(0);
});

// Initialize database and start server
const startServer = async () => {
  if (serverStarted || isShuttingDown) {
    console.log('🚀 Server startup skipped (already running or shutting down)');
    return;
  }

  try {
    // Connect to database (optional - app works without it)
    await connectDB();

    // Start the server
    const PORT = process.env.PORT || 3001;

    // Handle server errors
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.log(`⚠️ Port ${PORT} already in use`);
        console.log('💡 Try: taskkill /f /im node.exe (Windows) or killall node (Mac/Linux)');
      } else if (!isShuttingDown) {
        console.error('❌ Server error:', error.message);
      }
    });

    server.listen(PORT, '0.0.0.0', () => {
      if (!isShuttingDown) {
        serverStarted = true;
        console.log(`🚀 Server running on port ${PORT}`);
        console.log(`🔗 Local: http://localhost:${PORT}`);
        console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`💾 Database: ${mongoose.connection.readyState === 1 ? 'Connected' : 'In-Memory Mode'}`);
      }
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error.message);
    process.exit(1);
  }
};

startServer();
