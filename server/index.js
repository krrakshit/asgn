const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const Redis = require('ioredis');
const path = require('path');
const config = {
  REDIS_CONFIG: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
  },
  CHANNELS: {
    TOP_STATS: 'top-stats',
    BOTTOM_STATS: 'bottom-stats'
  },
  DATA_RETENTION_MINUTES: 30,
  UPDATE_INTERVAL: 3000, // 3 sec time
  UI_PORT: 3000
}
const cors = require("cors")
class MonitoringServer {
  constructor() {
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = socketIo(this.server, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      }
    });
    
    this.redis = new Redis(config.REDIS_CONFIG);
    this.subscriber = new Redis(config.REDIS_CONFIG);
    
    // In-memory storage for latest data (last 30 minutes)
    this.clientData = new Map();
    
    this.setupMiddleware();
    this.setupRoutes();
    this.setupRedisSubscriptions();
    this.setupSocketHandlers();
    this.startCleanupInterval();
  }

  setupMiddleware() {
    this.app.use(express.static(path.join(__dirname, 'public')));
    this.app.use(express.json());
    this.app.use(cors());
  }

  setupRoutes() {
    // Serve the main UI
    this.app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });

    // API to get client list
    this.app.get('/api/clients', (req, res) => {
      const clients = Array.from(this.clientData.keys());
      res.json(clients);
    });

    // API to get data for specific client
    this.app.get('/api/clients/:clientId/data', (req, res) => {
      const { clientId } = req.params;
      const data = this.clientData.get(clientId) || [];
      const latestData = data.length > 0 ? data[data.length - 1] : null;
      res.json(latestData ? latestData.processes : []);
    });

    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ 
        status: 'OK', 
        clients: this.clientData.size,
        timestamp: new Date().toISOString()
      });
    });
  }

  setupRedisSubscriptions() {
    console.log('Setting up Redis subscriptions...');
    
    // Subscribe to both channels
    this.subscriber.subscribe(config.CHANNELS.TOP_STATS, config.CHANNELS.BOTTOM_STATS);
    
    this.subscriber.on('message', (channel, message) => {
      try {
        const data = JSON.parse(message);
        this.handleClientData(data);
      } catch (error) {
        console.error('Error parsing message:', error);
      }
    });

    this.subscriber.on('error', (error) => {
      console.error('Redis subscriber error:', error);
    });
  }

  handleClientData(data) {
    const { clientId, timestamp, processes, clientType } = data;
    
    // Initialize client data if not exists
    if (!this.clientData.has(clientId)) {
      this.clientData.set(clientId, []);
    }
    
    const clientHistory = this.clientData.get(clientId);
    
    // Add new data
    const newEntry = {
      timestamp: new Date(timestamp),
      processes,
      clientType
    };
    
    clientHistory.push(newEntry);
    
    // Remove old data (keep only last 30 minutes)
    const thirtyMinutesAgo = new Date(Date.now() - config.DATA_RETENTION_MINUTES * 60 * 1000);
    const filteredHistory = clientHistory.filter(entry => entry.timestamp > thirtyMinutesAgo);
    
    this.clientData.set(clientId, filteredHistory);
    
    // Emit to connected sockets
    this.io.emit('client-data', {
      clientId,
      latestData: processes,
      timestamp,
      clientType
    });
    
    console.log(`[${new Date().toLocaleTimeString()}] Received data from ${clientId} (${clientType}): ${processes.length} processes`);
  }

  setupSocketHandlers() {
    this.io.on('connection', (socket) => {
      console.log('UI Client connected:', socket.id);
      
      // Send current client list
      const clientList = Array.from(this.clientData.keys()).map(clientId => {
        const history = this.clientData.get(clientId);
        const latest = history.length > 0 ? history[history.length - 1] : null;
        return {
          clientId,
          clientType: latest ? latest.clientType : 'unknown',
          lastSeen: latest ? latest.timestamp : null
        };
      });
      
      socket.emit('client-list', clientList);
      
      socket.on('get-client-data', (clientId) => {
        const data = this.clientData.get(clientId) || [];
        const latestData = data.length > 0 ? data[data.length - 1] : null;
        socket.emit('client-data-response', { 
          clientId, 
          data: latestData ? latestData.processes : [],
          timestamp: latestData ? latestData.timestamp : null,
          clientType: latestData ? latestData.clientType : null
        });
      });
      
      socket.on('disconnect', () => {
        console.log('UI Client disconnected:', socket.id);
      });
    });
  }

  startCleanupInterval() {
    // Clean up old data every minute
    setInterval(() => {
      const thirtyMinutesAgo = new Date(Date.now() - config.DATA_RETENTION_MINUTES * 60 * 1000);
      
      for (const [clientId, history] of this.clientData.entries()) {
        const filteredHistory = history.filter(entry => entry.timestamp > thirtyMinutesAgo);
        
        if (filteredHistory.length === 0) {
          // Remove client if no recent data
          this.clientData.delete(clientId);
          console.log(`Removed inactive client: ${clientId}`);
        } else {
          this.clientData.set(clientId, filteredHistory);
        }
      }
    }, 60000); // 1 minute
  }

  start() {
    this.server.listen(config.UI_PORT, () => {
      console.log(`🚀 Monitoring server running on http://localhost:${config.UI_PORT}`);
      console.log(`📊 Dashboard: http://localhost:${config.UI_PORT}`);
      console.log(`🔍 Health check: http://localhost:${config.UI_PORT}/health`);
    });
  }

  async stop() {
    console.log('Shutting down server...');
    await this.redis.disconnect();
    await this.subscriber.disconnect();
    this.server.close();
  }
}

const server = new MonitoringServer();
server.start();

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n⏹️  Shutting down server...');
  await server.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n⏹️  Shutting down server...');
  await server.stop();
  process.exit(0);
});