const Redis = require('ioredis');
const pidusage = require('pidusage');
const { exec } = require('child_process');
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

class ProcessMonitorClient {
  constructor(clientType, clientId) {
    this.clientType = clientType; // 'top' or 'bottom'
    this.clientId = clientId;
    this.redis = new Redis(config.REDIS_CONFIG);
    this.channel = clientType === 'top' ? config.CHANNELS.TOP_STATS : config.CHANNELS.BOTTOM_STATS;
  }

  async getProcessStats() {
    return new Promise((resolve, reject) => {
      // Get all running processes
      // exec('powershell "Get-Process | Select-Object Id, CPU, WorkingSet"', (error, stdout) => {
      //   if (error) {
      //     reject(error);
      //     return;
      //   }
           exec('ps -eo pid,pcpu,pmem --no-headers', (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }

        const processes = stdout.trim().split('\n')
          .map(line => {
            const [pid, cpu, memory] = line.trim().split(/\s+/);
            return {
              pid: parseInt(pid),
              cpu: parseFloat(cpu),
              memory: parseFloat(memory)
            };
          })
          .filter(proc => proc.pid && !isNaN(proc.cpu) && !isNaN(proc.memory));

        // Sort based on client type
        const sorted = processes.sort((a, b) => 
          this.clientType === 'top' ? b.cpu - a.cpu : a.cpu - b.cpu
        );

        // Get top/bottom 10
        const result = sorted.slice(0, 10);
        resolve(result);
      });
    });
  }

  async publishStats() {
    try {
      const stats = await this.getProcessStats();
      const message = {
        clientId: this.clientId,
        clientType: this.clientType,
        timestamp: new Date().toISOString(),
        processes: stats
      };

      await this.redis.publish(this.channel, JSON.stringify(message));
      console.log(`[${this.clientId}] Published ${stats.length} processes`);
    } catch (error) {
      console.error(`[${this.clientId}] Error:`, error.message);
    }
  }

  start() {
    console.log(`Starting ${this.clientType} client: ${this.clientId}`);
    
    // Initial publish
    this.publishStats();
    
    // Set interval for continuous monitoring
    setInterval(() => {
      this.publishStats();
    }, config.UPDATE_INTERVAL);
  }

  async stop() {
    await this.redis.disconnect();
  }
}

// Usage
const clientType = process.argv[2] || 'top'; // 'top' or 'bottom'
const clientId = process.argv[3] || `${clientType}-client-1`;

const client = new ProcessMonitorClient(clientType, clientId);
client.start();

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down client...');
  await client.stop();
  process.exit(0);
});