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
      max_memory_restart: "2048M",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
    },
  ],
};
