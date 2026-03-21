import { motion } from "framer-motion";
import { useState } from "react";

import { normalizeFinanceExpenseStatus } from "./finance-record-mappers.js";
import {
  bucketEntries,
  downloadCsvFile,
  financeMetricMeta,
  formatDate,
  formatMoney,
  formatPaymentMethod,
  formatTimeAgo,
  relativeTime,
  todayDateInputValue
} from "../WorkspaceMessenger.utils.js";

export function FinanceHeroStrip({ metrics, onSelect }) {
  const items = metrics.slice(0, 4);

  return (
    <div
      className="mb-6 grid gap-0 xl:grid-cols-4"
      style={{
        borderRadius: 22,
        padding: "20px 24px",
        background: "linear-gradient(135deg,#111827,#0f1f2e)",
        border: "1px solid rgba(16,185,129,0.14)",
        boxShadow: "0 20px 60px rgba(0,0,0,0.35)"
      }}
    >
      {items.map((metric, index) => {
        const meta = financeMetricMeta(metric);
        const expenseRatio = metric.id === "finance-expenses" ? 82 : null;

        return (
          <button
            key={metric.id}
            type="button"
            onClick={() => onSelect(metric)}
            className="text-left transition hover:-translate-y-0.5"
            style={{
              minHeight: 78,
              paddingLeft: index ? 24 : 0,
              borderLeft: index ? "1px solid rgba(255,255,255,0.06)" : "none"
            }}
          >
            <div className="flex items-center gap-3">
              <div
                className="flex h-8 w-8 items-center justify-center rounded-full text-sm"
                style={{
                  background: metric.id === "finance-overdue" ? "rgba(239,68,68,0.18)" : `${meta.accent}22`,
                  color: meta.accent
                }}
              >
                {metric.id === "finance-overdue" ? <span className="h-2.5 w-2.5 rounded-full bg-[#ef4444]" /> : meta.icon}
              </div>
              <span
                style={{
                  color: meta.accent,
                  fontSize: 10,
                  letterSpacing: "0.18em",
                  fontWeight: 700
                }}
              >
                {meta.label}
              </span>
            </div>
            <div
              style={{
                marginTop: 14,
                fontFamily: '"Sora","Manrope","DM Sans","Segoe UI",sans-serif',
                fontWeight: 800,
                fontSize: 32,
                lineHeight: 1.05,
                color: metric.id === "finance-overdue" ? "#ef4444" : "#f8fafc"
              }}
            >
              {metric.value}
            </div>
            {expenseRatio !== null ? (
              <div className="mt-3">
                <div className="h-2 overflow-hidden rounded-full bg-white/8">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${expenseRatio}%` }}
                    transition={{ duration: 1, ease: "easeOut" }}
                    className="h-full rounded-full"
                    style={{ background: "linear-gradient(90deg,#ef4444,#f87171)" }}
                  />
                </div>
                <div className="mt-2 text-xs text-slate-400">82% of budget</div>
              </div>
            ) : (
              <div className="mt-2 text-xs" style={{ color: meta.subColor }}>
                {metric.subvalue}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

function financeActivityCopy(entry) {
  const actor = entry.performedBy?.name || "FinanceBot";

  if (entry.itemType === "invoice") {
    const invoiceNumber = entry.metadata?.invoiceNumber || "invoice";

    switch (entry.action) {
      case "created":
        return {
          title: `${invoiceNumber} created`,
          body: `${actor} added the invoice to the finance queue.`,
          accent: "#94a3b8"
        };
      case "approved":
        return {
          title: `${invoiceNumber} approved`,
          body: `${actor} approved the invoice for payment.`,
          accent: "#10b981"
        };
      case "rejected":
        return {
          title: `${invoiceNumber} rejected`,
          body: entry.metadata?.rejectionReason
            ? `${actor} rejected it: ${entry.metadata.rejectionReason}`
            : `${actor} rejected the invoice.`,
          accent: "#ef4444"
        };
      case "paid":
        return {
          title: `${invoiceNumber} marked paid`,
          body: entry.metadata?.paymentStatus === "partial"
            ? `${actor} recorded a partial payment${entry.metadata?.paymentMethod ? ` via ${formatPaymentMethod(entry.metadata.paymentMethod).toLowerCase()}` : ""}${entry.metadata?.paymentReference ? ` (${entry.metadata.paymentReference})` : ""} and left a balance open.`
            : `${actor} confirmed the invoice was paid${entry.metadata?.paymentMethod ? ` via ${formatPaymentMethod(entry.metadata.paymentMethod).toLowerCase()}` : ""}${entry.metadata?.paymentReference ? ` (${entry.metadata.paymentReference})` : ""}.`,
          accent: "#22c55e"
        };
      case "recurring_issued":
        return {
          title: `${invoiceNumber} issued next recurring invoice`,
          body: entry.metadata?.generatedInvoiceNumber
            ? `${actor} generated ${entry.metadata.generatedInvoiceNumber} from the recurring schedule.`
            : `${actor} generated the next recurring invoice.`,
          accent: "#10b981"
        };
      case "reconciled":
        return {
          title: `${invoiceNumber} reconciled`,
          body: `${actor} reconciled the invoice.`,
          accent: "#38bdf8"
        };
      default:
        return {
          title: `${invoiceNumber} updated`,
          body: `${actor} updated the invoice.`,
          accent: "#94a3b8"
        };
    }
  }

  const amount = entry.metadata?.amount ? formatMoney(entry.metadata.amount, entry.metadata?.currency || "USD") : "Expense";
  const category = entry.metadata?.category ? ` under ${entry.metadata.category}` : "";

  switch (entry.action) {
    case "created":
    case "submitted":
      return {
        title: `${amount} expense logged`,
        body: `${actor} submitted an expense${category}.`,
        accent: "#10b981"
      };
    case "note_added":
      return {
        title: `Expense note updated`,
        body: `${actor} saved a finance note${category}.`,
        accent: "#94a3b8"
      };
    case "approved":
      return {
        title: `${amount} expense approved`,
        body: `${actor} approved the expense${category}.`,
        accent: "#10b981"
      };
    case "rejected":
      return {
        title: `${amount} expense rejected`,
        body: entry.metadata?.rejectionReason
          ? `${actor} rejected the expense: ${entry.metadata.rejectionReason}`
          : `${actor} rejected the expense${category}.`,
        accent: "#ef4444"
      };
    case "reimbursed":
      return {
        title: `${amount} expense reimbursed`,
        body: entry.metadata?.reference
          ? `${actor} reimbursed the expense${category} with ref ${entry.metadata.reference}.`
          : `${actor} reimbursed the expense${category}.`,
        accent: "#22c55e"
      };
    case "reconciled":
      return {
        title: `${amount} expense reconciled`,
        body: `${actor} reconciled the expense${category}.`,
        accent: "#38bdf8"
      };
    default:
      return {
        title: `Expense updated`,
        body: `${actor} updated an expense${category}.`,
        accent: "#94a3b8"
      };
  }
}

function operationsTimelineCategoryTone(category, financeMode = false) {
  if (category === "cross_module") {
    return financeMode ? "#c4b5fd" : "#7c3aed";
  }

  if (category === "warehouse") {
    return financeMode ? "#93c5fd" : "#2563eb";
  }

  if (category === "execution") {
    return financeMode ? "#fcd34d" : "#d97706";
  }

  return financeMode ? "#6ee7b7" : "#059669";
}

export function FinanceActivityFeed({ actions, compact = false }) {
  if (!actions.length) {
    return (
      <div
        className="rounded-2xl border p-4"
        style={{
          borderColor: "rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.04)",
          color: "#94a3b8"
        }}
      >
        No finance activity yet. Actions from invoices and expenses will appear here.
      </div>
    );
  }

  return (
    <div
      className="rounded-2xl border"
      style={{
        borderColor: "rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.04)"
      }}
    >
      {actions.map((entry, index) => {
        const copy = financeActivityCopy(entry);

        return (
          <div
            key={entry.id}
            style={{
              padding: compact ? "12px 14px" : "14px 16px",
              borderTop: index ? "1px solid rgba(255,255,255,0.06)" : "none",
              display: "grid",
              gap: 6
            }}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <span
                  aria-hidden="true"
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: copy.accent,
                    boxShadow: `0 0 16px ${copy.accent}55`
                  }}
                />
                <p
                  className="truncate"
                  style={{
                    margin: 0,
                    color: "#f8fafc",
                    fontWeight: 700,
                    fontSize: compact ? 13 : 14
                  }}
                >
                  {copy.title}
                </p>
              </div>
              <span className="shrink-0 text-xs text-slate-500">{relativeTime(entry.createdAt)}</span>
            </div>
            <p
              style={{
                margin: 0,
                color: "#94a3b8",
                fontSize: compact ? 12 : 13,
                lineHeight: 1.6
              }}
            >
              {copy.body}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function sortFinanceApprovalMessages(messages, sectionId) {
  const sorted = [...messages];

  if (sectionId === "needs-review") {
    sorted.sort((first, second) => {
      const firstOverdue = first.metadata.status === "overdue" ? 1 : 0;
      const secondOverdue = second.metadata.status === "overdue" ? 1 : 0;
      if (firstOverdue !== secondOverdue) {
        return secondOverdue - firstOverdue;
      }

      return new Date(first.metadata.dueDate).getTime() - new Date(second.metadata.dueDate).getTime();
    });
    return sorted;
  }

  sorted.sort((first, second) => new Date(first.createdAt).getTime() - new Date(second.createdAt).getTime());
  return sorted;
}

export function buildFinanceApprovalSections(messages) {
  const sections = [
    {
      id: "needs-review",
      title: "Needs Review",
      description: "Pending invoices and expenses waiting for a decision.",
      accent: "#f59e0b",
      items: []
    },
    {
      id: "awaiting-payment",
      title: "Awaiting Payment",
      description: "Approved and partially paid invoices that still need payment attention.",
      accent: "#22c55e",
      items: []
    },
    {
      id: "awaiting-reconciliation",
      title: "Awaiting Reconciliation",
      description: "Paid invoices and approved or reimbursed expenses that still need reconciliation.",
      accent: "#38bdf8",
      items: []
    }
  ];

  const sectionMap = new Map(sections.map((section) => [section.id, section]));

  messages.forEach((message) => {
    if (message.type === "invoice") {
      if (message.metadata.status === "pending" || message.metadata.status === "overdue") {
        sectionMap.get("needs-review")?.items.push(message);
        return;
      }

      if (message.metadata.status === "approved" || message.metadata.status === "partial") {
        sectionMap.get("awaiting-payment")?.items.push(message);
        return;
      }

      if (message.metadata.status === "paid") {
        sectionMap.get("awaiting-reconciliation")?.items.push(message);
      }
      return;
    }

    if (
      message.type === "expense" &&
      message.metadata.expenseId &&
      normalizeFinanceExpenseStatus(message.metadata.status) === "pending_review"
    ) {
      sectionMap.get("needs-review")?.items.push(message);
      return;
    }

    if (
      message.type === "expense" &&
      message.metadata.expenseId &&
      ["approved", "reimbursed"].includes(normalizeFinanceExpenseStatus(message.metadata.status))
    ) {
      sectionMap.get("awaiting-reconciliation")?.items.push(message);
    }
  });

  return sections
    .map((section) => ({
      ...section,
      items: sortFinanceApprovalMessages(section.items, section.id)
    }))
    .filter((section) => section.items.length > 0);
}

export function buildFinanceQueueSummary(messages) {
  const invoiceMessages = messages.filter((message) => message.type === "invoice");
  const expenseMessages = messages.filter((message) => message.type === "expense");

  const pendingDecision = [
    ...invoiceMessages.filter(
      (message) => message.metadata.status === "pending" || message.metadata.status === "overdue"
    ),
    ...expenseMessages.filter(
      (message) => message.metadata.expenseId && normalizeFinanceExpenseStatus(message.metadata.status) === "pending_review"
    )
  ];
  const overdueInvoices = invoiceMessages.filter((message) => message.metadata.status === "overdue");
  const dueSoonInvoices = invoiceMessages.filter((message) => {
    if (!["pending", "approved", "partial"].includes(message.metadata.status)) {
      return false;
    }

    const diffDays = Math.ceil((new Date(message.metadata.dueDate).getTime() - Date.now()) / 86400000);
    return diffDays >= 0 && diffDays <= 1;
  });
  const awaitingPayment = invoiceMessages.filter((message) => ["approved", "partial"].includes(message.metadata.status));
  const awaitingReconciliation = [
    ...invoiceMessages.filter((message) => message.metadata.status === "paid"),
    ...expenseMessages.filter(
      (message) => message.metadata.expenseId && ["approved", "reimbursed"].includes(normalizeFinanceExpenseStatus(message.metadata.status))
    )
  ];

  const notices = [];

  if (overdueInvoices.length) {
    notices.push({
      id: "overdue",
      eyebrow: "Urgent",
      title: `${overdueInvoices.length} overdue invoice${overdueInvoices.length === 1 ? "" : "s"} need attention`,
      body: "These invoices have passed their due date and should be reviewed or escalated first.",
      accent: "#ef4444",
      tone: "danger"
    });
  }

  if (dueSoonInvoices.length) {
    notices.push({
      id: "due-soon",
      eyebrow: "Due today",
      title: `${dueSoonInvoices.length} invoice${dueSoonInvoices.length === 1 ? "" : "s"} are close to deadline`,
      body: "These invoices are due now or within the next day and should stay near the top of the queue.",
      accent: "#f59e0b",
      tone: "warning"
    });
  }

  if (awaitingReconciliation.length) {
    notices.push({
      id: "reconciliation",
      eyebrow: "Follow-through",
      title: `${awaitingReconciliation.length} item${awaitingReconciliation.length === 1 ? "" : "s"} await reconciliation`,
      body: "Payments and expenses are still open until reconciliation is finished.",
      accent: "#38bdf8",
      tone: "info"
    });
  }

  if (!notices.length && (pendingDecision.length || awaitingPayment.length)) {
    notices.push({
      id: "queue-steady",
      eyebrow: "Queue status",
      title: `${pendingDecision.length + awaitingPayment.length} finance item${pendingDecision.length + awaitingPayment.length === 1 ? "" : "s"} are in motion`,
      body: "The queue is active, but there are no overdue or reconciliation risks at the moment.",
      accent: "#10b981",
      tone: "success"
    });
  }

  return {
    pendingDecision,
    overdueInvoices,
    dueSoonInvoices,
    awaitingPayment,
    awaitingReconciliation,
    notices
  };
}

export function FinanceQueueSummary({ summary, compact = false }) {
  const stats = [
    {
      id: "pending",
      label: "Needs review",
      value: summary.pendingDecision.length,
      accent: "#f59e0b"
    },
    {
      id: "overdue",
      label: "Overdue",
      value: summary.overdueInvoices.length,
      accent: "#ef4444"
    },
    {
      id: "payment",
      label: "Awaiting payment",
      value: summary.awaitingPayment.length,
      accent: "#22c55e"
    },
    {
      id: "reconciliation",
      label: "Awaiting reconciliation",
      value: summary.awaitingReconciliation.length,
      accent: "#38bdf8"
    }
  ];

  return (
    <div
      className="finance-record-digest rounded-[24px] p-5"
      style={{
        border: "1px solid rgba(16,185,129,0.16)",
        background: "linear-gradient(135deg, rgba(16,185,129,0.08), rgba(15,23,42,0.78))",
        boxShadow: "0 16px 42px rgba(0,0,0,0.22)"
      }}
    >
      <div className={`flex flex-wrap items-start justify-between gap-4 ${compact ? "mb-4" : "mb-5"}`}>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400">FinanceBot priorities</div>
          <h3
            style={{
              marginTop: 8,
              fontFamily: '"Sora","Manrope","DM Sans","Segoe UI",sans-serif',
              fontSize: compact ? 22 : 24,
              lineHeight: 1.15,
              fontWeight: 700,
              color: "#f8fafc"
            }}
          >
            What needs attention now
          </h3>
          <p className="mt-2 max-w-2xl text-sm text-slate-400">
            Live queue guidance from the current finance records. These notices update as invoice and expense states change.
          </p>
        </div>
      </div>

      <div className={`grid gap-3 ${compact ? "md:grid-cols-2 xl:grid-cols-4" : "md:grid-cols-2 xl:grid-cols-4"}`}>
        {stats.map((stat) => (
          <div
            key={stat.id}
            className="rounded-[18px] px-4 py-3"
            style={{
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.04)"
            }}
          >
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: stat.accent }}>
              {stat.label}
            </div>
            <div
              style={{
                marginTop: 10,
                fontFamily: '"Sora","Manrope","DM Sans","Segoe UI",sans-serif',
                fontSize: 28,
                lineHeight: 1,
                fontWeight: 800,
                color: "#f8fafc"
              }}
            >
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      <div className={`mt-4 grid gap-3 ${compact ? "lg:grid-cols-1" : "lg:grid-cols-3"}`}>
        {summary.notices.map((notice) => (
          <div
            key={notice.id}
            className="rounded-[18px] px-4 py-4"
            style={{
              border: `1px solid ${notice.accent}33`,
              background: `${notice.accent}10`
            }}
          >
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: notice.accent }}>
              {notice.eyebrow}
            </div>
            <div className="mt-2 text-base font-semibold text-slate-50">{notice.title}</div>
            <div className="mt-2 text-sm leading-6 text-slate-300">{notice.body}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function FinanceRelationshipSummary({ customers = [], vendors = [] }) {
  const topCustomers = customers.slice(0, 3);
  const topVendors = vendors.slice(0, 3);

  return (
    <div
      className="rounded-[24px] p-5"
      style={{
        border: "1px solid rgba(255,255,255,0.08)",
        background: "linear-gradient(180deg,#111827 0%,#10192a 100%)",
        boxShadow: "0 12px 32px rgba(0,0,0,0.28)"
      }}
    >
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400">Relationship pulse</div>
      <h3 className="mt-2 text-xl font-bold text-white">Active finance contacts</h3>
      <p className="mt-2 text-sm text-slate-400">Quick visibility into the customer and vendor records this workspace is using most recently.</p>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Customers</div>
          <div className="mt-3 space-y-3">
            {topCustomers.length ? topCustomers.map((customer) => (
              <div key={customer.id} className="rounded-[16px] border border-white/8 bg-white/5 px-4 py-3">
                <div className="text-sm font-semibold text-slate-100">{customer.name}</div>
                <div className="mt-1 text-xs text-slate-400">{customer.email || "No email saved"}</div>
              </div>
            )) : <div className="rounded-[16px] border border-white/8 bg-white/5 px-4 py-3 text-sm text-slate-400">No customer records yet.</div>}
          </div>
        </div>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Vendors</div>
          <div className="mt-3 space-y-3">
            {topVendors.length ? topVendors.map((vendor) => (
              <div key={vendor.id} className="rounded-[16px] border border-white/8 bg-white/5 px-4 py-3">
                <div className="text-sm font-semibold text-slate-100">{vendor.name}</div>
                <div className="mt-1 text-xs text-slate-400">{vendor.email || "No email saved"}</div>
              </div>
            )) : <div className="rounded-[16px] border border-white/8 bg-white/5 px-4 py-3 text-sm text-slate-400">No vendor records yet.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

export function FinanceFilterToolbar({
  customerOptions = [],
  vendorOptions = [],
  invoiceFilter,
  expenseFilter,
  reportingWindow = "all",
  onInvoiceFilterChange,
  onExpenseFilterChange,
  onReportingWindowChange
}) {
  return (
    <div
      className="rounded-[24px] p-5"
      style={{
        border: "1px solid rgba(255,255,255,0.08)",
        background: "linear-gradient(180deg,#111827 0%,#10192a 100%)",
        boxShadow: "0 12px 32px rgba(0,0,0,0.28)"
      }}
    >
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400">Finance filters</div>
      <h3 className="mt-2 text-xl font-bold text-white">Narrow the queue by contact or status</h3>
      <p className="mt-2 text-sm text-slate-400">Use lightweight filters to review invoice and expense work without leaving the current finance workspace.</p>

      <div className="mt-4 max-w-[240px]">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Reporting window</span>
          <select value={reportingWindow} onChange={(event) => onReportingWindowChange?.(event.target.value)} className="w-full rounded-[14px] border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-100 outline-none">
            <option value="all">All time</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
          </select>
        </label>
      </div>

      <div className="mt-5 grid gap-6 xl:grid-cols-2">
        <div className="grid gap-3 rounded-[20px] border border-white/8 bg-white/4 p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Invoices</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Customer</span>
              <select value={invoiceFilter.customerId} onChange={(event) => onInvoiceFilterChange("customerId", event.target.value)} className="w-full rounded-[14px] border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-100 outline-none">
                <option value="">All customers</option>
                {customerOptions.map((customer) => (
                  <option key={customer.id} value={customer.id}>{customer.name}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Status</span>
              <select value={invoiceFilter.status} onChange={(event) => onInvoiceFilterChange("status", event.target.value)} className="w-full rounded-[14px] border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-100 outline-none">
                <option value="">All statuses</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="partial">Partial</option>
                <option value="paid">Paid</option>
                <option value="overdue">Overdue</option>
                <option value="reconciled">Reconciled</option>
                <option value="rejected">Rejected</option>
              </select>
            </label>
          </div>
        </div>

        <div className="grid gap-3 rounded-[20px] border border-white/8 bg-white/4 p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Expenses</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Vendor</span>
              <select value={expenseFilter.vendorId} onChange={(event) => onExpenseFilterChange("vendorId", event.target.value)} className="w-full rounded-[14px] border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-100 outline-none">
                <option value="">All vendors</option>
                {vendorOptions.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>{vendor.name}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Status</span>
              <select value={expenseFilter.status} onChange={(event) => onExpenseFilterChange("status", event.target.value)} className="w-full rounded-[14px] border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-100 outline-none">
                <option value="">All statuses</option>
                <option value="draft">Draft</option>
                <option value="pending_review">Pending review</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="reimbursed">Reimbursed</option>
                <option value="reconciled">Reconciled</option>
              </select>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}

export function FinanceRecordDigest({
  title,
  subtitle,
  items = [],
  kind = "invoice",
  onSelectItem = null,
  selectedItemId = ""
}) {
  return (
    <div
      className="rounded-[24px] p-5"
      style={{
        border: "1px solid rgba(255,255,255,0.08)",
        background: "linear-gradient(180deg,#111827 0%,#10192a 100%)",
        boxShadow: "0 12px 32px rgba(0,0,0,0.28)"
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400">{kind}</div>
          <h3 className="mt-2 text-xl font-bold text-white">{title}</h3>
          <p className="mt-2 text-sm text-slate-400">{subtitle}</p>
        </div>
        <div className="rounded-full border border-white/8 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-300">
          {items.length} item{items.length === 1 ? "" : "s"}
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {items.length ? items.map((item) => {
          const isSelected = selectedItemId === item.id;
          const Tag = onSelectItem ? "button" : "div";
          return (
          <Tag
            key={item.id}
            type={onSelectItem ? "button" : undefined}
            onClick={onSelectItem ? () => onSelectItem(item) : undefined}
            className={`w-full rounded-[18px] border px-4 py-4 text-left ${isSelected ? "border-emerald-400/30 bg-emerald-500/10" : "border-white/8 bg-white/5"} ${onSelectItem ? "transition hover:border-white/15 hover:bg-white/[0.08]" : ""}`}
          >
            {kind === "invoice" ? (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-100">{item.metadata.invoiceNumber}</div>
                    <div className="mt-1 text-xs text-slate-400">{item.metadata.companyName}</div>
                  </div>
                  <span className="rounded-full border border-white/8 bg-white/5 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-300">
                    {item.metadata.status}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {item.metadata.recurring?.enabled && !item.metadata.recurringSourceInvoiceId ? (
                    <span className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-300">
                      Template
                    </span>
                  ) : null}
                  {item.metadata.recurringSourceInvoiceId ? (
                    <span className="rounded-full border border-sky-400/20 bg-sky-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-300">
                      Generated run #{item.metadata.recurringSequence || 1}
                    </span>
                  ) : null}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                  <span>{formatMoney(item.metadata.amount, item.metadata.currency)}</span>
                  <span>Remaining {formatMoney(item.metadata.outstandingAmount || 0, item.metadata.currency)}</span>
                  <span>Due {formatDate(item.metadata.dueDate)}</span>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-100">{item.metadata.vendorName || "Vendor"}</div>
                    <div className="mt-1 text-xs text-slate-400 capitalize">{item.metadata.category}</div>
                  </div>
                  <span className="rounded-full border border-white/8 bg-white/5 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-300">
                    {item.metadata.status}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                  <span>{formatMoney(item.metadata.amount, item.metadata.currency)}</span>
                  <span>{formatDate(item.createdAt)}</span>
                </div>
              </>
            )}
          </Tag>
        );
        }) : (
          <div className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-4 text-sm text-slate-400">
            No matching {kind === "invoice" ? "invoices" : "expenses"} right now.
          </div>
        )}
      </div>
    </div>
  );
}

export function FinanceOperationalInsights({
  recurringDueInvoices = [],
  partialPaymentInvoices = [],
  topCustomers = [],
  topVendors = [],
  canIssueRecurring = false,
  issuingInvoiceId = null,
  onIssueRecurring = null
}) {
  const sections = [
    {
      id: "recurring-due",
      title: "Recurring invoices due",
      description: "Manually issue the next invoice from recurring templates when the next issue date arrives.",
      items: recurringDueInvoices,
      empty: "No recurring invoices are due right now."
    },
    {
      id: "partial-history",
      title: "Partial payment history",
      description: "Invoices with payment history that still carry an open balance.",
      items: partialPaymentInvoices,
      empty: "No partial payment history needs review right now."
    },
    {
      id: "customer-balance",
      title: "Customers with open balances",
      description: "Customers currently carrying the highest outstanding invoice balance.",
      items: topCustomers,
      empty: "No customers currently owe money."
    },
    {
      id: "vendor-usage",
      title: "Most used vendors",
      description: "Vendors appearing most often in the expense flow.",
      items: topVendors,
      empty: "No vendor usage is available yet."
    }
  ];

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      {sections.map((section) => (
        <div
          key={section.id}
          className="rounded-[24px] p-5"
          style={{
            border: "1px solid rgba(255,255,255,0.08)",
            background: "linear-gradient(180deg,#111827 0%,#10192a 100%)",
            boxShadow: "0 12px 32px rgba(0,0,0,0.28)"
          }}
        >
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400">{section.id.replace("-", " ")}</div>
          <h3 className="mt-2 text-xl font-bold text-white">{section.title}</h3>
          <p className="mt-2 text-sm text-slate-400">{section.description}</p>

          <div className="mt-5 space-y-3">
            {section.items.length ? section.items.map((item) => {
              if (section.id === "recurring-due") {
                return (
                  <div key={item.id} className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-100">{item.invoiceNumber}</div>
                        <div className="mt-1 text-xs text-slate-400">{item.companyName}</div>
                        <div className="mt-2 text-xs text-amber-200">Due to issue {formatDate(item.recurring?.nextIssueDate)}</div>
                      </div>
                      {canIssueRecurring ? (
                        <button
                          type="button"
                          onClick={() => onIssueRecurring?.(item)}
                          disabled={issuingInvoiceId === item.id}
                          className="rounded-[12px] border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-300 disabled:opacity-60"
                        >
                          {issuingInvoiceId === item.id ? "Issuing..." : "Issue next"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              }

              if (section.id === "partial-history") {
                return (
                  <div key={item.id} className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-100">{item.invoiceNumber}</div>
                        <div className="mt-1 text-xs text-slate-400">{item.companyName}</div>
                      </div>
                      <div className="text-right text-xs text-slate-400">
                        <div>{item.payments.length} payment{item.payments.length === 1 ? "" : "s"}</div>
                        <div className="mt-1 text-amber-200">{formatMoney(item.outstandingAmount || 0, item.currency)} open</div>
                      </div>
                    </div>
                    <div className="mt-3 space-y-2">
                      {item.payments.slice(-3).reverse().map((payment, index) => (
                        <div key={`${item.id}-payment-${payment.id || index}`} className="flex items-center justify-between gap-3 rounded-[14px] border border-white/8 bg-white/5 px-3 py-2 text-xs text-slate-300">
                          <div>
                            <div>{formatMoney(payment.amount, item.currency)}</div>
                            <div className="mt-1 text-slate-500">{formatDateTime(payment.recordedAt)}</div>
                            <div className="mt-1 text-slate-500">
                              {formatPaymentMethod(payment.method)}
                              {payment.reference ? ` · ${payment.reference}` : ""}
                            </div>
                          </div>
                          <div className="text-right">
                            <div>{payment.recordedBy?.name || "Finance staff"}</div>
                            <div className="mt-1 text-slate-500">{formatMoney(payment.remainingBalance || 0, item.currency)} left</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              }

              if (section.id === "customer-balance") {
                return (
                  <div key={item.name} className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-4">
                    <div className="text-sm font-semibold text-slate-100">{item.name}</div>
                    <div className="mt-2 flex items-center justify-between gap-3 text-xs text-slate-400">
                      <span>{item.invoiceCount} invoice{item.invoiceCount === 1 ? "" : "s"} open</span>
                      <span className="text-amber-200">{formatMoneyDisplay((item.outstandingAmountByCurrency ?? item.outstandingAmount) || 0)}</span>
                    </div>
                  </div>
                );
              }

              return (
                <div key={item.name} className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-4">
                  <div className="text-sm font-semibold text-slate-100">{item.name}</div>
                  <div className="mt-2 flex items-center justify-between gap-3 text-xs text-slate-400">
                    <span>{item.expenseCount} expense{item.expenseCount === 1 ? "" : "s"}</span>
                    <span className="text-sky-300">{formatMoneyDisplay((item.totalAmountByCurrency ?? item.totalAmount) || 0)}</span>
                  </div>
                </div>
              );
            }) : (
              <div className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-4 text-sm text-slate-400">
                {section.empty}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function FinanceReportingSnapshot({
  statusBreakdown = {},
  recurringSummary = {},
  recentPayments = [],
  recurringTemplates = []
}) {
  const breakdownItems = [
    ["pending", "Pending"],
    ["approved", "Approved"],
    ["partial", "Partial"],
    ["paid", "Paid"],
    ["overdue", "Overdue"],
    ["reconciled", "Reconciled"],
    ["rejected", "Rejected"]
  ];

  return (
    <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
      <div
        className="rounded-[24px] p-5"
        style={{
          border: "1px solid rgba(255,255,255,0.08)",
          background: "linear-gradient(180deg,#111827 0%,#10192a 100%)",
          boxShadow: "0 12px 32px rgba(0,0,0,0.28)"
        }}
      >
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400">Reporting snapshot</div>
        <h3 className="mt-2 text-xl font-bold text-white">Invoice status breakdown</h3>
        <p className="mt-2 text-sm text-slate-400">A quick read on how invoices are moving through review, payment, and reconciliation.</p>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {breakdownItems.map(([id, label]) => (
            <div key={id} className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</div>
              <div className="mt-3 text-2xl font-bold text-slate-100">{statusBreakdown[id] || 0}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-6">
        <div
          className="rounded-[24px] p-5"
          style={{
            border: "1px solid rgba(255,255,255,0.08)",
            background: "linear-gradient(180deg,#111827 0%,#10192a 100%)",
            boxShadow: "0 12px 32px rgba(0,0,0,0.28)"
          }}
        >
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400">Recurring lifecycle</div>
          <h3 className="mt-2 text-xl font-bold text-white">Template vs generated activity</h3>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {[
              ["Templates", recurringSummary.templates || 0],
              ["Generated", recurringSummary.generated || 0],
              ["Due now", recurringSummary.due || 0]
            ].map(([label, value]) => (
              <div key={label} className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</div>
                <div className="mt-3 text-2xl font-bold text-slate-100">{value}</div>
              </div>
            ))}
          </div>
        </div>

        <div
          className="rounded-[24px] p-5"
          style={{
            border: "1px solid rgba(255,255,255,0.08)",
            background: "linear-gradient(180deg,#111827 0%,#10192a 100%)",
            boxShadow: "0 12px 32px rgba(0,0,0,0.28)"
          }}
        >
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400">Template history</div>
          <h3 className="mt-2 text-xl font-bold text-white">Recurring usage by template</h3>
          <div className="mt-5 space-y-3">
            {recurringTemplates.length ? recurringTemplates.map((template) => (
              <div key={template.id} className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-semibold text-slate-100">{template.invoiceNumber}</div>
                      {template.dueNow ? (
                        <span className="rounded-full border border-amber-400/40 bg-amber-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-200">
                          Due now
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 text-xs text-slate-400">{template.customerName}</div>
                    <div className="mt-2 text-xs text-slate-500">
                      Next issue {template.nextIssueDate ? formatDate(template.nextIssueDate) : "not scheduled"}
                    </div>
                    <div className="mt-2 text-xs text-slate-500">
                      {formatPaymentMethod(template.frequency)}
                      {template.interval > 1 ? ` every ${template.interval} cycles` : " schedule"} · {formatMoney(template.amount, template.currency)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold text-slate-100">{template.generatedCount} generated</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {template.lastIssuedAt ? `Last issued ${formatDateTime(template.lastIssuedAt)}` : "No generated runs yet"}
                    </div>
                  </div>
                </div>
                {template.latestRun ? (
                  <div className="mt-3 rounded-[14px] border border-white/8 bg-white/5 px-3 py-3 text-xs text-slate-300">
                    <div className="font-semibold text-slate-100">Latest generated invoice</div>
                    <div className="mt-2 flex items-start justify-between gap-3">
                      <div>
                        <div>{template.latestRun.invoiceNumber}</div>
                        <div className="mt-1 text-slate-500">
                          Run #{template.latestRun.recurringSequence || 1} · {formatDateTime(template.latestRun.createdAt || template.latestRun.dueDate)}
                        </div>
                      </div>
                      <div className="text-right">
                        <div>{formatMoney(template.latestRun.amount, template.latestRun.currency)}</div>
                        <div className="mt-1 text-slate-500">{template.latestRun.statusLabel}</div>
                      </div>
                    </div>
                  </div>
                ) : null}
                {template.generatedRuns.length ? (
                  <div className="mt-3 space-y-2">
                    {template.generatedRuns.map((run) => (
                      <div key={run.id} className="rounded-[14px] border border-white/8 bg-white/5 px-3 py-3 text-xs text-slate-300">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-semibold text-slate-100">{run.invoiceNumber}</div>
                            <div className="mt-1 text-slate-500">
                              Run #{run.recurringSequence || 1} · {formatDateTime(run.createdAt || run.dueDate)}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-semibold text-slate-100">{formatMoney(run.amount, run.currency)}</div>
                            <div className="mt-1 text-slate-500">{run.statusLabel}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            )) : (
              <div className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-4 text-sm text-slate-400">
                No recurring template history is available in this reporting view yet.
              </div>
            )}
          </div>
        </div>

        <div
          className="rounded-[24px] p-5"
          style={{
            border: "1px solid rgba(255,255,255,0.08)",
            background: "linear-gradient(180deg,#111827 0%,#10192a 100%)",
            boxShadow: "0 12px 32px rgba(0,0,0,0.28)"
          }}
        >
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400">Recent payment activity</div>
          <h3 className="mt-2 text-xl font-bold text-white">Latest recorded payments</h3>
          <div className="mt-5 space-y-3">
            {recentPayments.length ? recentPayments.map((payment, index) => (
              <div key={payment.id || `${payment.invoiceId}-${index}`} className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-100">{payment.invoiceNumber}</div>
                    <div className="mt-1 text-xs text-slate-400">{payment.customerName}</div>
                    <div className="mt-2 text-xs text-slate-500">{formatDateTime(payment.recordedAt)}</div>
                    <div className="mt-2 text-xs text-slate-500">
                      {formatPaymentMethod(payment.method)}
                      {payment.reference ? ` · Ref ${payment.reference}` : ""}
                    </div>
                    {payment.note ? <div className="mt-2 text-xs text-slate-500">{payment.note}</div> : null}
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold text-emerald-300">{formatMoney(payment.amount, payment.currency)}</div>
                    <div className="mt-1 text-xs text-slate-500">{formatMoney(payment.remainingBalance || 0, payment.currency)} left</div>
                    {payment.recordedBy?.name ? <div className="mt-1 text-xs text-slate-500">{payment.recordedBy.name}</div> : null}
                  </div>
                </div>
              </div>
            )) : (
              <div className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-4 text-sm text-slate-400">
                No payments recorded in this reporting window yet.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function FinanceCurrencyBreakdown({ bucket = {}, muted = false }) {
  const entries = bucketEntries(bucket);
  if (!entries.length) {
    return <span className={muted ? "text-slate-500" : "text-slate-300"}>{formatMoney(0)}</span>;
  }

  return (
    <div className="space-y-1">
      {entries.map(([currency, amount]) => (
        <div key={`bucket-${currency}`} className={`text-xs ${muted ? "text-slate-500" : "text-slate-300"}`}>
          {formatMoney(amount, currency)} {currency}
        </div>
      ))}
    </div>
  );
}

export function FinanceActionLogList({ actions = [], emptyLabel = "No recent actions yet." }) {
  return (
    <div className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Recent actions</div>
      <div className="mt-3 space-y-3">
        {actions.length ? actions.map((action, index) => (
          <div key={`${action.id || action.createdAt || index}-finance-action`} className="rounded-[14px] border border-white/8 bg-slate-950/40 px-3 py-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-100">
                  {String(action.action || "updated").replace(/_/g, " ")}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {action.actorName || action.actor?.name || "Finance workspace"}
                </div>
                {action.note ? <div className="mt-2 text-xs text-slate-400">{action.note}</div> : null}
              </div>
              <div className="text-right text-xs text-slate-500">
                {formatTimeAgo(action.createdAt)}
              </div>
            </div>
          </div>
        )) : (
          <div className="text-sm text-slate-400">{emptyLabel}</div>
        )}
      </div>
    </div>
  );
}

export function FinanceBalanceSheetPanel({
  workspaceDefaultCurrency = "USD",
  financeBalanceSheetReport = null,
  onLoadFinanceBalanceSheetReport = null
}) {
  const [asOfDate, setAsOfDate] = useState(todayDateInputValue());
  const [loading, setLoading] = useState(false);
  const normalizedBaseCurrency = workspaceDefaultCurrency || "USD";

  async function refreshBalanceSheet() {
    if (!onLoadFinanceBalanceSheetReport) {
      return;
    }
    setLoading(true);
    try {
      await onLoadFinanceBalanceSheetReport({
        asOfDate,
        baseCurrency: normalizedBaseCurrency
      });
    } finally {
      setLoading(false);
    }
  }

  const sections = [
    ["Assets", financeBalanceSheetReport?.assets || {}],
    ["Liabilities", financeBalanceSheetReport?.liabilities || {}],
    ["Equity", financeBalanceSheetReport?.equity || {}]
  ];

  return (
    <div
      className="rounded-[24px] p-5"
      style={{
        border: "1px solid rgba(255,255,255,0.08)",
        background: "linear-gradient(180deg,#111827 0%,#10192a 100%)",
        boxShadow: "0 12px 32px rgba(0,0,0,0.28)"
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400">Balance sheet</div>
          <h3 className="mt-2 text-xl font-bold text-white">Assets, liabilities, and equity</h3>
          <p className="mt-2 text-sm text-slate-400">Point-in-time position in raw currencies and approx. normalized totals.</p>
        </div>
        <button
          type="button"
          onClick={() =>
            downloadCsvFile("finance-balance-sheet.csv", [
              ["Section", "Line", "Currency", "Amount"],
              ...sections.flatMap(([sectionLabel, sectionData]) =>
                Object.entries(sectionData)
                  .filter(([key]) => key !== "total")
                  .flatMap(([key, bucket]) =>
                    bucketEntries(bucket || {}).map(([currency, amount]) => [sectionLabel, key, currency, amount])
                  )
              )
            ])
          }
          className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-200"
        >
          Export CSV
        </button>
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">As of date</span>
          <input
            type="date"
            value={asOfDate}
            onChange={(event) => setAsOfDate(event.target.value)}
            className="mt-2 rounded-[14px] border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-slate-100 outline-none"
          />
        </label>
        <button
          type="button"
          onClick={refreshBalanceSheet}
          className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-4 py-2 text-xs font-semibold text-emerald-300"
        >
          {loading ? "Refreshing..." : "Refresh balance sheet"}
        </button>
      </div>
      <div className="mt-5 grid gap-4 xl:grid-cols-3">
        {sections.map(([sectionLabel, sectionData]) => (
          <div key={sectionLabel} className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{sectionLabel}</div>
            <div className="mt-2 text-sm font-semibold text-emerald-300">
              approx. {formatMoney(financeBalanceSheetReport?.normalizedTotals?.[sectionLabel.toLowerCase()] || 0, normalizedBaseCurrency)}
            </div>
            <div className="mt-3 space-y-3">
              {Object.entries(sectionData || {})
                .filter(([key]) => key !== "total")
                .map(([key, bucket]) => (
                  <div key={`${sectionLabel}-${key}`}>
                    <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{key.replace(/([A-Z])/g, " $1").trim()}</div>
                    <div className="mt-1"><FinanceCurrencyBreakdown bucket={bucket || {}} /></div>
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Total assets</div>
          <div className="mt-2"><FinanceCurrencyBreakdown bucket={financeBalanceSheetReport?.assets?.total || {}} /></div>
        </div>
        <div className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Total liabilities</div>
          <div className="mt-2"><FinanceCurrencyBreakdown bucket={financeBalanceSheetReport?.liabilities?.total || {}} /></div>
        </div>
        <div className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Total equity</div>
          <div className="mt-2"><FinanceCurrencyBreakdown bucket={financeBalanceSheetReport?.equity?.total || {}} /></div>
        </div>
        <div className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Balance check</div>
          <div className={`mt-2 text-sm font-semibold ${financeBalanceSheetReport?.balanceCheck?.isBalanced ? "text-emerald-300" : "text-amber-200"}`}>
            {financeBalanceSheetReport?.balanceCheck?.isBalanced ? "Balanced" : "Approx. mismatch"}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Diff {formatMoney(financeBalanceSheetReport?.balanceCheck?.difference || 0, normalizedBaseCurrency)}
          </div>
        </div>
      </div>
    </div>
  );
}

