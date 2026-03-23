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
  GBP: 0.79,
  JPY: 149.5,
  CAD: 1.35,
  AUD: 1.53,
  CHF: 0.89,
  CNY: 7.2,
  HKD: 7.81,
  SGD: 1.34,
  INR: 83.1,
  MXN: 16.9,
  BRL: 5.03,
  KRW: 1335,
  NOK: 10.7,
  SEK: 10.4,
  DKK: 6.87,
  NZD: 1.66,
  ZAR: 18.4,
  AED: 3.67,
  SAR: 3.75,
  QAR: 3.64,
  KWD: 0.31,
  BDT: 110,
  PKR: 278,
  NGN: 1540,
  EGP: 49.2,
  TRY: 32.1,
  RUB: 91.4,
  IDR: 15700
};

let liveRateState = {
  base: "USD",
  rates: null,
  timestamp: null
};

export function normalizeCurrencyCode(value, fallback = "USD") {
  const normalized = String(value || "").trim().toUpperCase();
  return normalized || fallback;
}

export function ensureCurrencySupported(value, label = "Currency") {
  const code = normalizeCurrencyCode(value);
  return SUPPORTED_CURRENCY_CODES.includes(code)
    ? null
    : `${label} must be a supported ISO-4217 currency code.`;
}

export function setLiveRates(payload = {}) {
  const base = normalizeCurrencyCode(payload.base || "USD");
  const rawRates = payload.rates && typeof payload.rates === "object" ? payload.rates : null;

  if (!rawRates) {
    liveRateState = {
      base: "USD",
      rates: null,
      timestamp: null
    };
    return getActiveExchangeRates();
  }

  const normalizedRates = Object.entries(rawRates).reduce((accumulator, [currency, value]) => {
    const code = normalizeCurrencyCode(currency);
    const numericValue = Number(value);
    if (Number.isFinite(numericValue) && numericValue > 0) {
      accumulator[code] = numericValue;
    }
    return accumulator;
  }, {});

  normalizedRates[base] = 1;

  liveRateState = {
    base,
    rates: normalizedRates,
    timestamp: payload.timestamp ? new Date(payload.timestamp) : new Date()
  };

  return getActiveExchangeRates();
}

export function clearLiveRates() {
  liveRateState = {
    base: "USD",
    rates: null,
    timestamp: null
  };
}

export function isUsingLiveRates() {
  return Boolean(liveRateState.rates && Object.keys(liveRateState.rates).length > 0);
}

export function getLiveRateTimestamp() {
  return liveRateState.timestamp || null;
}

export function getActiveExchangeRates() {
  return isUsingLiveRates() ? liveRateState.rates : STATIC_EXCHANGE_RATES;
}

export function getExchangeRate(fromCurrency, toCurrency, rates = getActiveExchangeRates()) {
  const from = normalizeCurrencyCode(fromCurrency);
  const to = normalizeCurrencyCode(toCurrency);

  if (from === to) {
    return 1;
  }

  const fromRate = Number(rates?.[from]);
  const toRate = Number(rates?.[to]);

  if (!Number.isFinite(fromRate) || fromRate <= 0 || !Number.isFinite(toRate) || toRate <= 0) {
    return null;
  }

  return toRate / fromRate;
}

export function convertAmount(amount, fromCurrency, toCurrency, rates = getActiveExchangeRates()) {
  const numericAmount = Number(amount || 0);
  if (!Number.isFinite(numericAmount)) {
    return 0;
  }

  const rate = getExchangeRate(fromCurrency, toCurrency, rates);
  if (!Number.isFinite(rate) || rate <= 0) {
    return 0;
  }

  return Number((numericAmount * rate).toFixed(2));
}

export function normalizeToBaseCurrency(amount, currency, baseCurrency = "USD", rates = getActiveExchangeRates()) {
  return convertAmount(amount, currency, baseCurrency, rates);
}
