import crypto from "node:crypto";

import { Configuration, CountryCode, PlaidApi, PlaidEnvironments, Products } from "plaid";

function getPlaidConfig() {
  const clientId = process.env.PLAID_CLIENT_ID || "";
  const secret = process.env.PLAID_SECRET || "";
  const envName = (process.env.PLAID_ENV || "sandbox").toLowerCase();
  const webhookSecret = process.env.PLAID_WEBHOOK_SECRET || "";

  return {
    clientId,
    secret,
    envName,
    webhookSecret,
    configured: Boolean(clientId && secret)
  };
}

export function isPlaidConfigured() {
  return getPlaidConfig().configured;
}

function ensurePlaidConfigured() {
  if (!isPlaidConfigured()) {
    const error = new Error("Plaid integration not configured");
    error.code = "PLAID_NOT_CONFIGURED";
    throw error;
  }
}

function getPlaidClient() {
  ensurePlaidConfigured();
  const { clientId, secret, envName } = getPlaidConfig();
  const configuration = new Configuration({
    basePath: PlaidEnvironments[envName] || PlaidEnvironments.sandbox,
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": clientId,
        "PLAID-SECRET": secret
      }
    }
  });

  return new PlaidApi(configuration);
}

function isMockPlaidMode() {
  return process.env.NODE_ENV === "test";
}

export async function createLinkToken(userId, workspaceId) {
  if (isMockPlaidMode()) {
    return `link-sandbox-${workspaceId}-${userId}`;
  }

  const client = getPlaidClient();
  const response = await client.linkTokenCreate({
    user: {
      client_user_id: `${workspaceId}:${userId}`
    },
    client_name: "Workspace Finance",
    products: [Products.Transactions],
    country_codes: [CountryCode.Us, CountryCode.Gb, CountryCode.Ca],
    language: "en"
  });

  return response.data.link_token;
}

export async function exchangePublicToken(publicToken) {
  if (isMockPlaidMode()) {
    return {
      accessToken: `access-${publicToken}`,
      itemId: `item-${publicToken}`
    };
  }

  const client = getPlaidClient();
  const response = await client.itemPublicTokenExchange({
    public_token: publicToken
  });

  return {
    accessToken: response.data.access_token,
    itemId: response.data.item_id
  };
}

export async function fetchTransactions(accessToken, startDate, endDate) {
  if (isMockPlaidMode()) {
    return [
      {
        transactionDate: startDate,
        description: `Mock Plaid transaction ${accessToken}`,
        amount: -100,
        currency: "USD",
        category: "other",
        providerTransactionId: `mock-${accessToken}-${startDate}-${endDate}`,
        source: "bank_sync",
        plaidAccountId: "mock-account"
      }
    ];
  }

  const client = getPlaidClient();
  const response = await client.transactionsGet({
    access_token: accessToken,
    start_date: startDate,
    end_date: endDate
  });

  return (response.data.transactions || []).map((transaction) => ({
    transactionDate: transaction.date,
    description: transaction.name || transaction.merchant_name || "Plaid transaction",
    amount: Number(transaction.amount || 0) * -1,
    currency: transaction.iso_currency_code || transaction.unofficial_currency_code || "USD",
    category: Array.isArray(transaction.category) ? transaction.category[0] || "other" : "other",
    providerTransactionId: transaction.transaction_id,
    source: "bank_sync",
    plaidAccountId: transaction.account_id
  }));
}

export async function fetchAccountBalance(accessToken, accountId) {
  if (isMockPlaidMode()) {
    return {
      accountId,
      balance: 1250,
      currency: "USD",
      name: `Mock account ${accessToken}`,
      mask: "0000",
      subtype: "checking",
      institutionName: "Mock Bank"
    };
  }

  const client = getPlaidClient();
  const response = await client.accountsBalanceGet({
    access_token: accessToken
  });

  const account = (response.data.accounts || []).find((entry) => entry.account_id === accountId);
  if (!account) {
    throw new Error("Plaid account not found.");
  }

  return {
    accountId: account.account_id,
    balance: Number(account.balances?.current || 0),
    currency: account.balances?.iso_currency_code || account.balances?.unofficial_currency_code || "USD",
    name: account.name || "",
    mask: account.mask || "",
    subtype: account.subtype || account.type || "other",
    institutionName: account.official_name || account.name || ""
  };
}

export function verifyPlaidWebhookSignature(rawBody, signatureHeader) {
  const { webhookSecret } = getPlaidConfig();

  if (!webhookSecret) {
    return true;
  }

  if (!signatureHeader) {
    return false;
  }

  const expected = crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
}
