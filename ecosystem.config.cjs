module.exports = {
  apps: [
    {
      name: 'PGlite Local Server',
      script: './bin/pglite-server.js',
      args: 'start ./data/genieos-local --port 12000 --log info',
      cwd: '/home/namastex/dev/pglite-embedded-server',
      interpreter: 'node',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production'
      },
      error_file: '/home/namastex/logs/pglite-server-error.log',
      out_file: '/home/namastex/logs/pglite-server-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      time: true
    }
  ]
};
