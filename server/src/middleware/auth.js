import jwt from "jsonwebtoken";

import { User } from "../models/User.js";

export async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({ message: "Authentication required." });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);
    const session = user?.findActiveSession(decoded.sessionId);

    if (
      !user ||
      !decoded.sessionId ||
      !session ||
      (decoded.sessionVersion || 0) !== (user.sessionVersion || 0)
    ) {
      return res.status(401).json({ message: "Session expired. Please log in again." });
    }

    req.userId = decoded.userId;
    req.user = user;
    req.sessionId = decoded.sessionId;
    return next();
  } catch (error) {
    return res.status(401).json({ message: "Invalid or expired token." });
  }
}
