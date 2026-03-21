import { Router } from "express";

import authRoutes from "./authRoutes.js";
import conversationRoutes from "./conversationRoutes.js";
import expenseRoutes from "./expenseRoutes.js";
import invoiceRoutes from "./invoiceRoutes.js";
import notificationRoutes from "./notificationRoutes.js";
import orderRoutes from "./orderRoutes.js";
import productRoutes from "./productRoutes.js";
import userRoutes from "./userRoutes.js";

const router = Router();

router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/conversations", conversationRoutes);
router.use("/invoices", invoiceRoutes);
router.use("/expenses", expenseRoutes);
router.use("/products", productRoutes);
router.use("/orders", orderRoutes);
router.use("/notifications", notificationRoutes);

export default router;
