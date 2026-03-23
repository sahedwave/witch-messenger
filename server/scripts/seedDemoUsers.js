import dotenv from "dotenv";

import { connectDB } from "../src/config/db.js";
import { User } from "../src/models/User.js";
import { pickAvatarColor } from "../src/utils/avatarColor.js";

dotenv.config();

const demoUsers = [
  {
    name: "Alice Demo",
    email: "alice@example.com",
    password: "alice123"
  },
  {
    name: "Bob Demo",
    email: "bob@example.com",
    password: "bob12345"
  },
  {
    name: "Charlie Demo",
    email: "charlie@example.com",
    password: "charlie123"
  }
];

async function run() {
  await connectDB(process.env.MONGODB_URI);

  for (const demoUser of demoUsers) {
    const existing = await User.findOne({ email: demoUser.email });

    if (existing) {
      console.log(`Skipped existing demo user: ${demoUser.email}`);
      continue;
    }

    await User.create({
      name: demoUser.name,
      email: demoUser.email,
      password: demoUser.password,
      avatarColor: pickAvatarColor(demoUser.email)
    });

    console.log(`Created demo user: ${demoUser.email}`);
  }

  process.exit(0);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
