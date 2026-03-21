import { useEffect, useMemo, useRef, useState } from "react";

import {
  buildInvoiceDraft,
  calculateInvoiceTotals,
  formatDisplayDate
} from "../invoice-utils";

const DOC_TYPE_OPTIONS = [
  { value: "quotation", label: "Quotation" },
  { value: "invoice", label: "Invoice" }
];
const STATUS_ACTIONS = {
  quotation: [
    { value: "approved", label: "Approve" },
    { value: "revision-requested", label: "Need revision" },
    { value: "rejected", label: "Reject" }
  ],
  invoice: [
    { value: "approved", label: "Approve" },
    { value: "paid", label: "Mark paid" },
    { value: "revision-requested", label: "Need revision" }
  ]
};

function formatMoney(value, currency) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: 2
  }).format(Number(value || 0));
}

function statusLabel(status) {
  switch (status) {
    case "revision-requested":
      return "Revision requested";
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "paid":
      return "Paid";
    case "sent":
      return "Sent";
    default:
      return "Draft";
  }
}

export function InvoiceFlyout({
  activeContact,
  documents = [],
  onSaveDocument = () => {},
  onDeleteDocument = () => {},
  onUpdateStatus = () => {}
}) {
  const [draft, setDraft] = useState(() => buildInvoiceDraft(activeContact));
  const [editingId, setEditingId] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const formRef = useRef(null);

  useEffect(() => {
    setDraft(buildInvoiceDraft(activeContact));
    setEditingId(null);
    setShowHistory(false);
  }, [activeContact?.id]);

  const conversationDocuments = useMemo(
    () =>
      activeContact
        ? documents.filter((entry) => entry.contactId === activeContact.id)
        : [],
    [activeContact, documents]
  );
  const totals = useMemo(() => calculateInvoiceTotals(draft), [draft]);

  function updateDraft(field, value) {
    setDraft((current) => ({
      ...current,
      [field]: value
    }));
  }

  function updateLineItem(lineId, field, value) {
    setDraft((current) => ({
      ...current,
      lineItems: current.lineItems.map((item) =>
        item.id === lineId ? { ...item, [field]: field === "description" ? value : Number(value || 0) } : item
      )
    }));
  }

  function addLineItem() {
    setDraft((current) => ({
      ...current,
      lineItems: [
        ...current.lineItems,
        {
          id: `line-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
          description: "",
          quantity: 1,
          rate: 0
        }
      ]
    }));
  }

  function removeLineItem(lineId) {
    setDraft((current) => ({
      ...current,
      lineItems:
        current.lineItems.length > 1
          ? current.lineItems.filter((item) => item.id !== lineId)
          : current.lineItems
    }));
  }

  function handleEditDocument(document) {
    setEditingId(document.id);
    setDraft({
      ...document,
      lineItems: document.lineItems.map((item) => ({ ...item }))
    });
    setShowHistory(false);
    window.requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function handleSubmit(event) {
    event.preventDefault();
    onSaveDocument(draft);
    setDraft(buildInvoiceDraft(activeContact));
    setEditingId(null);
  }

  function handleCancelEdit() {
    setDraft(buildInvoiceDraft(activeContact));
    setEditingId(null);
  }

  if (!activeContact) {
    return (
      <section className="chat-action-card secondary rail-flyout invoice-flyout">
        <div className="pdf-review-empty">
          <strong>Invoice viewer</strong>
          <p>Open a conversation first, then create a quotation or invoice linked to that user.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="chat-action-card secondary rail-flyout invoice-flyout">
      <div className="invoice-flyout-head">
        <div>
          <strong>Invoice / quotation viewer</strong>
          <p>Create, review, and update business documents without dumping them into chat.</p>
        </div>
      </div>

      <section className="invoice-summary-grid">
        <div>
          <strong>{conversationDocuments.length}</strong>
          <span>Linked docs</span>
        </div>
        <div>
          <strong>{conversationDocuments.filter((entry) => entry.status === "approved").length}</strong>
          <span>Approved</span>
        </div>
        <div>
          <strong>{conversationDocuments.filter((entry) => entry.status === "paid").length}</strong>
          <span>Paid</span>
        </div>
      </section>

      <div className="invoice-history-toolbar">
        <button
          className={`ghost-button subtle-button compact ${showHistory ? "is-active" : ""}`}
          type="button"
          onClick={() => setShowHistory((current) => !current)}
        >
          History
        </button>
        {conversationDocuments.length ? (
          <span>{conversationDocuments.length} saved records</span>
        ) : (
          <span>No saved records yet</span>
        )}
      </div>

      {showHistory ? (
        conversationDocuments.length ? (
          <section className="invoice-document-list">
            {conversationDocuments.slice(0, 6).map((document) => {
              const documentTotals = calculateInvoiceTotals(document);
              return (
                <article key={document.id} className={`invoice-document-card is-${document.type}`}>
                  <button
                    className="invoice-delete-button"
                    type="button"
                    aria-label={`Delete ${document.title || document.docNumber || "document"}`}
                    title="Delete document"
                    onClick={() => onDeleteDocument(document.id)}
                  >
                    ×
                  </button>
                  <div className="invoice-document-copy">
                    <strong>{document.title || `${document.type === "invoice" ? "Invoice" : "Quotation"} ${document.docNumber || ""}`.trim()}</strong>
                    <span>
                      {document.type === "invoice" ? "Invoice" : "Quotation"} · {statusLabel(document.status)}
                    </span>
                    <small>
                      {document.docNumber || "No number"} · Due {formatDisplayDate(document.dueDate)} · {formatMoney(documentTotals.total, document.currency)}
                    </small>
                  </div>
                  <div className="invoice-document-actions">
                    <button className="ghost-button subtle-button compact" type="button" onClick={() => handleEditDocument(document)}>
                      Edit
                    </button>
                    {STATUS_ACTIONS[document.type]?.map((action) => (
                      document.status !== action.value ? (
                        <button
                          key={action.value}
                          className="ghost-button subtle-button compact"
                          type="button"
                          onClick={() => onUpdateStatus(document.id, action.value)}
                        >
                          {action.label}
                        </button>
                      ) : null
                    ))}
                  </div>
                </article>
              );
            })}
          </section>
        ) : (
          <div className="pdf-review-empty">
            <strong>No business documents yet</strong>
            <p>Create the first quotation or invoice for {activeContact.displayName || activeContact.name}.</p>
          </div>
        )
      ) : null}

      <form ref={formRef} className="invoice-form" onSubmit={handleSubmit}>
        <div className="invoice-form-head">
          <strong>{editingId ? "Edit document" : "New document"}</strong>
          <span>Build a clean record, then review status inside this conversation.</span>
        </div>
        <div className="invoice-form-row">
          <label>
            <span>Type</span>
            <select value={draft.type} onChange={(event) => updateDraft("type", event.target.value)}>
              {DOC_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Number</span>
            <input
              type="text"
              value={draft.docNumber}
              placeholder="QT-2026-018"
              onChange={(event) => updateDraft("docNumber", event.target.value)}
            />
          </label>
        </div>
        <div className="invoice-form-row">
          <label>
            <span>Title</span>
            <input
              type="text"
              value={draft.title}
              placeholder="Website redesign quotation"
              onChange={(event) => updateDraft("title", event.target.value)}
            />
          </label>
          <label>
            <span>Currency</span>
            <select value={draft.currency} onChange={(event) => updateDraft("currency", event.target.value)}>
              <option value="USD">USD</option>
              <option value="BDT">BDT</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
            </select>
          </label>
        </div>
        <div className="invoice-form-row">
          <label>
            <span>Issue date</span>
            <input type="date" value={draft.issueDate} onChange={(event) => updateDraft("issueDate", event.target.value)} />
          </label>
          <label>
            <span>Due date</span>
            <input type="date" value={draft.dueDate} onChange={(event) => updateDraft("dueDate", event.target.value)} />
          </label>
        </div>

        <section className="invoice-line-items">
          <div className="invoice-form-head">
            <strong>Line items</strong>
            <button className="ghost-button subtle-button compact" type="button" onClick={addLineItem}>
              Add item
            </button>
          </div>
          {draft.lineItems.map((item) => (
            <div key={item.id} className="invoice-line-row">
              <input
                type="text"
                value={item.description}
                placeholder="UI design package"
                onChange={(event) => updateLineItem(item.id, "description", event.target.value)}
              />
              <input
                type="number"
                min="1"
                value={item.quantity}
                onChange={(event) => updateLineItem(item.id, "quantity", event.target.value)}
              />
              <input
                type="number"
                min="0"
                step="0.01"
                value={item.rate}
                onChange={(event) => updateLineItem(item.id, "rate", event.target.value)}
              />
              <button className="ghost-button subtle-button compact" type="button" onClick={() => removeLineItem(item.id)}>
                Remove
              </button>
            </div>
          ))}
        </section>

        <label>
          <span>Notes</span>
          <textarea
            rows={3}
            value={draft.notes}
            placeholder="Payment terms, delivery scope, or revision notes"
            onChange={(event) => updateDraft("notes", event.target.value)}
          />
        </label>

        <div className="invoice-totals-card">
          <strong>Total</strong>
          <span>{formatMoney(totals.total, draft.currency)}</span>
          <small>{draft.lineItems.length} line items</small>
        </div>

        <div className="invoice-submit-row">
          <button className="ghost-button compact-header-toggle calendar-save-button" type="submit">
            {editingId ? "Save changes" : "Save document"}
          </button>
          {editingId ? (
            <button className="ghost-button subtle-button compact" type="button" onClick={handleCancelEdit}>
              Cancel
            </button>
          ) : null}
        </div>
      </form>
    </section>
  );
}
