module.exports = {
  apps : [
    {
      name: "Express App",
      script: "./bin/www",
      interpreter_args: "--max-old-space-size=16000",
      instances: 1,
      // merge_logs: true,
      // exec_mode: "cluster",
      env: {
        // PORT: 3000,
        NODE_ENV: "production"
      },
      env_dev: {
        PORT: 3100,
        NODE_ENV: "development"
      }
    }
  ]
};
