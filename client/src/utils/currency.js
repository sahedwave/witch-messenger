export const SUPPORTED_CURRENCY_CODES = [
  "USD",
  "EUR",
  "GBP",
  "JPY",
  "CAD",
  "AUD",
  "CHF",
  "CNY",
  "HKD",
  "SGD",
  "INR",
  "MXN",
  "BRL",
  "KRW",
  "NOK",
  "SEK",
  "DKK",
  "NZD",
  "ZAR",
  "AED",
  "SAR",
  "QAR",
  "KWD",
  "BDT",
  "PKR",
  "NGN",
  "EGP",
  "TRY",
  "RUB",
  "IDR"
];

export const STATIC_EXCHANGE_RATES = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.78,
  JPY: 149.8,
  CAD: 1.35,
  AUD: 1.52,
  CHF: 0.88,
  CNY: 7.19,
  HKD: 7.82,
  SGD: 1.34,
  INR: 83.1,
  MXN: 16.9,
  BRL: 4.96,
  KRW: 1338,
  NOK: 10.62,
  SEK: 10.35,
  DKK: 6.87,
  NZD: 1.64,
  ZAR: 18.47,
  AED: 3.67,
  SAR: 3.75,
  QAR: 3.64,
  KWD: 0.31,
  BDT: 109.7,
  PKR: 278.5,
  NGN: 1498,
  EGP: 48.6,
  TRY: 32.1,
  RUB: 91.5,
  IDR: 15640
};

export function normalizeCurrencyCode(value = "USD", fallback = "USD") {
  const code = String(value || "").trim().toUpperCase();
  return code || fallback;
}

export function getExchangeRate(fromCurrency = "USD", toCurrency = "USD", rates = STATIC_EXCHANGE_RATES) {
  const from = normalizeCurrencyCode(fromCurrency);
  const to = normalizeCurrencyCode(toCurrency);
  const fromRate = Number(rates?.[from] || 0);
  const toRate = Number(rates?.[to] || 0);

  if (!fromRate || !toRate) {
    return from === to ? 1 : 0;
  }

  return to === from ? 1 : toRate / fromRate;
}

export function convertAmount(amount = 0, fromCurrency = "USD", toCurrency = "USD", rates = STATIC_EXCHANGE_RATES) {
  const numericAmount = Number(amount || 0);
  if (!Number.isFinite(numericAmount)) {
    return 0;
  }

  const rate = getExchangeRate(fromCurrency, toCurrency, rates);
  if (!rate) {
    return 0;
  }

  return Number((numericAmount * rate).toFixed(2));
}

export function normalizeToBaseCurrency(amount = 0, currency = "USD", baseCurrency = "USD", rates = STATIC_EXCHANGE_RATES) {
  return convertAmount(amount, currency, baseCurrency, rates);
}
