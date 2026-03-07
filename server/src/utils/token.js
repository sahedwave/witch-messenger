import crypto from "node:crypto";
import jwt from "jsonwebtoken";

export function createSessionId() {
  return crypto.randomBytes(18).toString("hex");
}

export function signToken(user, sessionId) {
  return jwt.sign(
    {
      userId: user._id.toString(),
      sessionVersion: user.sessionVersion || 0,
      sessionId
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "7d"
    }
  );
}
