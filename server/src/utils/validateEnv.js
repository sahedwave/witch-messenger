export function validateProductionEnv() {
  if (process.env.NODE_ENV !== "production") {
    return;
  }

  const required = ["MONGODB_URI", "CLIENT_URL", "JWT_SECRET"];
  const localhost = ["localhost", "127.0.0.1"];

  for (const key of required) {
    const value = process.env[key];
    if (!value) {
      console.error(`FATAL: ${key} is not set`);
      process.exit(1);
    }

    if (localhost.some((host) => String(value).includes(host))) {
      console.error(`FATAL: ${key} points to localhost in production`);
      process.exit(1);
    }
  }
}
