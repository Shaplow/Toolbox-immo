module.exports = {
  apps: [
    {
      name: "toolbox-web",
      script: "node_modules/.bin/next",
      args: "start",
      cwd: "/var/www/toolbox/web",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
    },
    {
      name: "toolbox-render",
      script: "/var/www/toolbox/render-engine/venv/bin/uvicorn",
      args: "api:app --host 127.0.0.1 --port 8000",
      cwd: "/var/www/toolbox/render-engine",
      interpreter: "none",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      env: {
        PYTHONUNBUFFERED: "1",
      },
    },
  ],
};
