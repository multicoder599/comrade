// pm2 process definition for the Comrade Shop POS server.
// Start with:  pm2 start ecosystem.config.cjs
// The NODE_ENV below is REQUIRED — dist/boot.js only binds its ports when
// NODE_ENV=production. Starting dist/boot.js directly without it leaves a
// silent, idle process that listens on nothing.
module.exports = {
  apps: [
    {
      name: "comrade",
      script: "dist/boot.js",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
