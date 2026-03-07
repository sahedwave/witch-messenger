import mongoose from "mongoose";

export async function connectDB(mongoUri) {
  await mongoose.connect(mongoUri);
  console.log("MongoDB connected");
}

