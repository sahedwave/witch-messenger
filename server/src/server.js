import dotenv from "dotenv";

import { createServerEnvironment } from "./app.js";
import { connectDB } from "./config/db.js";
import { validateProductionEnv } from "./validateEnv.js";

dotenv.config();
validateProductionEnv();

const {
  PORT = 5001,
  MONGODB_URI = "mongodb://127.0.0.1:27017/messenger-mvp",
  JWT_SECRET,
  CLIENT_URL = "http://localhost:5173,http://127.0.0.1:5173"
} = process.env;

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET is required.");
}

const { server, startBackgroundJobs } = createServerEnvironment({
  clientUrls: CLIENT_URL.split(",").map((value) => value.trim()),
  jwtSecret: JWT_SECRET
});

async function startServer() {
  await connectDB(MONGODB_URI);
  startBackgroundJobs();
  server.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error("Server startup failed", error);
  process.exit(1);
});
