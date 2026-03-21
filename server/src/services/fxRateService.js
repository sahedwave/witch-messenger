import {
  STATIC_EXCHANGE_RATES,
  SUPPORTED_CURRENCY_CODES,
  clearLiveRates,
  normalizeCurrencyCode,
  setLiveRates
} from "../utils/currency.js";

const FX_CACHE_TTL_MS = 60 * 60 * 1000;
const fxRateCache = new Map();

function normalizeFetchedRates(baseCurrency, rawRates = {}) {
  const base = normalizeCurrencyCode(baseCurrency || "USD");
  const normalized = Object.entries(rawRates).reduce((accumulator, [currency, value]) => {
    const code = normalizeCurrencyCode(currency);
    if (!SUPPORTED_CURRENCY_CODES.includes(code)) {
      return accumulator;
    }

    const numericValue = Number(value);
    if (Number.isFinite(numericValue) && numericValue > 0) {
      accumulator[code] = numericValue;
    }
    return accumulator;
  }, {});

  normalized[base] = 1;
  return normalized;
}

export async function fetchLiveRates(baseCurrency = "USD") {
  const normalizedBase = normalizeCurrencyCode(baseCurrency || "USD");
  const response = await fetch(`https://api.exchangerate-api.com/v4/latest/${encodeURIComponent(normalizedBase)}`, {
    signal: AbortSignal.timeout(5000)
  });

  if (!response.ok) {
    throw new Error(`FX provider returned ${response.status}.`);
  }

  const payload = await response.json();
  const rates = normalizeFetchedRates(payload.base || normalizedBase, payload.rates || {});

  if (!Object.keys(rates).length) {
    throw new Error("FX provider returned no usable rates.");
  }

  const timestamp = new Date();
  fxRateCache.set(normalizedBase, {
    base: normalizedBase,
    rates,
    timestamp
  });
  setLiveRates({
    base: normalizedBase,
    rates,
    timestamp
  });

  return {
    base: normalizedBase,
    rates,
    source: "live",
    timestamp
  };
}

export async function getCachedRates(baseCurrency = "USD", options = {}) {
  const normalizedBase = normalizeCurrencyCode(baseCurrency || "USD");
  const cached = fxRateCache.get(normalizedBase);
  const forceRefresh = options.forceRefresh === true;

  if (!forceRefresh && cached?.timestamp && Date.now() - cached.timestamp.getTime() < FX_CACHE_TTL_MS) {
    setLiveRates(cached);
    return {
      ...cached,
      source: "live"
    };
  }

  try {
    return await fetchLiveRates(normalizedBase);
  } catch (_error) {
    clearLiveRates();
    return {
      base: normalizedBase,
      rates: cached?.rates || STATIC_EXCHANGE_RATES,
      source: cached?.rates ? "live" : "static",
      timestamp: cached?.timestamp || null
    };
  }
}
