import { PrismaClient } from "@prisma/client";

export const prisma = globalThis.__workspacePrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__workspacePrisma = prisma;
}
