module.exports = {
  apps: [
    {
      name: "agentphalanx-runtime",
      script: "scripts/start-runtime.ts",
      interpreter: "node_modules/.bin/tsx",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
