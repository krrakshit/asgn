module.exports = {
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
};