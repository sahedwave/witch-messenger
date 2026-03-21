export const INVOICE_STORAGE_KEY = "messenger-mvp-invoices";

export function formatDisplayDate(value) {
  const [year = "", month = "", day = ""] = String(value || "").split("-");
  return day && month && year ? `${day}/${month}/${year}` : value;
}

export function readInvoices() {
  try {
    const raw = window.localStorage.getItem(INVOICE_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

export function writeInvoices(items) {
  window.localStorage.setItem(INVOICE_STORAGE_KEY, JSON.stringify(items));
}

export function buildInvoiceDraft(activeContact) {
  const today = new Date();
  const due = new Date(today);
  due.setDate(today.getDate() + 7);
  const todayKey = today.toISOString().slice(0, 10);
  const dueKey = due.toISOString().slice(0, 10);

  return {
    id: null,
    contactId: activeContact?.id || null,
    contactName: activeContact?.displayName || activeContact?.name || "",
    type: "quotation",
    status: "draft",
    title: "",
    docNumber: "",
    issueDate: todayKey,
    dueDate: dueKey,
    currency: "USD",
    notes: "",
    lineItems: [
      {
        id: `line-${Date.now()}`,
        description: "",
        quantity: 1,
        rate: 0
      }
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

export function normalizeLineItems(lineItems = []) {
  return lineItems.map((item, index) => ({
    id: item.id || `line-${Date.now()}-${index}`,
    description: item.description || "",
    quantity: Number(item.quantity || 0),
    rate: Number(item.rate || 0)
  }));
}

export function calculateInvoiceTotals(document) {
  const lineItems = normalizeLineItems(document.lineItems);
  const subtotal = lineItems.reduce(
    (sum, item) => sum + Math.max(0, Number(item.quantity || 0)) * Math.max(0, Number(item.rate || 0)),
    0
  );

  return {
    subtotal,
    total: subtotal,
    lineItems
  };
}

export function sortInvoices(items) {
  return [...items].sort((first, second) => new Date(second.updatedAt || second.createdAt) - new Date(first.updatedAt || first.createdAt));
}
