import express from "express";

import { BankAccount } from "../models/BankAccount.js";
import { fetchTransactions as fetchPlaidTransactions, isPlaidConfigured, verifyPlaidWebhookSignature } from "../services/plaidService.js";
import { syncBankAccount } from "../services/bankSyncService.js";

const router = express.Router();

router.post("/plaid", async (req, res) => {
  try {
    if (!isPlaidConfigured()) {
      return res.status(503).json({ message: "Plaid integration not configured" });
    }

    const signatureHeader = req.get("x-plaid-signature") || req.get("plaid-verification");
    const rawBody = JSON.stringify(req.body || {});
    if (!verifyPlaidWebhookSignature(rawBody, signatureHeader)) {
      return res.status(401).json({ message: "Invalid Plaid webhook signature." });
    }

    if (req.body?.webhook_type !== "TRANSACTIONS" || req.body?.webhook_code !== "SYNC_UPDATES_AVAILABLE") {
      return res.json({ received: true, ignored: true });
    }

    const itemId = String(req.body?.item_id || "").trim();
    if (!itemId) {
      return res.status(400).json({ message: "Plaid webhook item id is required." });
    }

    const account = await BankAccount.findOne({
      plaidItemId: itemId,
      status: { $ne: "disconnected" }
    });
    if (!account?.plaidAccessToken || !account?.plaidAccountId) {
      return res.json({ received: true, ignored: true });
    }

    const endDate = new Date();
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const transactions = await fetchPlaidTransactions(
      account.plaidAccessToken,
      startDate.toISOString().slice(0, 10),
      endDate.toISOString().slice(0, 10)
    );
    const filteredTransactions = transactions.filter(
      (entry) => !entry.plaidAccountId || entry.plaidAccountId === account.plaidAccountId
    );
    const syncResult = await syncBankAccount(account._id, filteredTransactions);

    account.lastSyncedAt = new Date();
    await account.save();

    return res.json({ received: true, ...syncResult });
  } catch (_error) {
    return res.status(500).json({ message: "Unable to process Plaid webhook." });
  }
});

export default router;
