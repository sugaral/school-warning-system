module.exports = {
  apps: [{
    name: 'warnsys-backend',
    script: 'dist/main.js',
    cwd: 'c:/Users/WS/Desktop/cursor-x/backend',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production'
    },
    error_file: 'c:/Users/WS/Desktop/cursor-x/backend/logs/error.log',
    out_file: 'c:/Users/WS/Desktop/cursor-x/backend/logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    time: true
  }]
};
