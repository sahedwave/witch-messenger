import { SUPPORTED_CURRENCY_CODES } from "../../utils/currency.js";

export const NAV_ITEMS = [
  { id: "home", label: "Overview", icon: "⌂" },
  { id: "inbox", label: "Inbox", icon: "✉" },
  { id: "users", label: "Users", icon: "◉" },
  { id: "finances", label: "Finances", icon: "💰" },
  { id: "warehouse", label: "Warehouse", icon: "📦" },
  { id: "tasks", label: "Task Manager", icon: "☑" },
  { id: "projects", label: "Project Management", icon: "▣" }
];

export const COMMAND_ITEMS = [
  {
    command: "/invoice #[number]",
    description: "Render an invoice approval card in FinanceBot.",
    example: "/invoice 304",
    roles: ["finance", "owner", "manager"],
    scope: "finance"
  },
  {
    command: "/stock [item-name]",
    description: "Render a stock status card in WareBot.",
    example: "/stock cement",
    roles: ["warehouse", "owner", "manager"],
    scope: "warehouse"
  },
  {
    command: "/expense [amount] [category]",
    description: "Render an expense log card in FinanceBot.",
    example: "/expense 500 travel",
    roles: ["finance", "owner", "manager"],
    scope: "finance"
  },
  {
    command: "/order #[number]",
    description: "Render a shipment tracking card in WareBot.",
    example: "/order 9002",
    roles: ["warehouse", "owner", "manager"],
    scope: "warehouse"
  },
  {
    command: "/report",
    description: "Render a mini finance summary card.",
    example: "/report",
    roles: ["finance", "owner", "manager"],
    scope: "finance"
  }
];

export const FILTER_TABS = ["Chat", "Media", "Links", "Pinned"];
export const ROLE_BOT_VISIBILITY = {
  finance: ["finance"],
  warehouse: ["warehouse"],
  owner: ["finance", "warehouse"],
  manager: ["finance", "warehouse"]
};

export const SHIPMENT_STEPS = ["Packed", "Dispatched", "In Transit", "Delivered"];
export const WAREHOUSE_SHIPMENT_STATUS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "packed", label: "Packed" },
  { value: "dispatched", label: "Dispatched" },
  { value: "in_transit", label: "In transit" },
  { value: "delayed", label: "Delayed" },
  { value: "delivered", label: "Delivered" }
];
export const FINANCE_WORKSPACE_ROLES = ["viewer", "approver", "finance_staff", "accountant"];
export const PRIORITY_FINANCE_CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD"];
export const FINANCE_CURRENCY_OPTIONS = [
  ...PRIORITY_FINANCE_CURRENCIES,
  ...SUPPORTED_CURRENCY_CODES.filter((currency) => !PRIORITY_FINANCE_CURRENCIES.includes(currency)).sort((left, right) =>
    left.localeCompare(right)
  )
];
export const REACTIONS = [
  { emoji: "❤️", label: "Love" },
  { emoji: "😂", label: "Haha" },
  { emoji: "😮", label: "Wow" },
  { emoji: "😢", label: "Sad" },
  { emoji: "👍", label: "Like" },
  { emoji: "🔥", label: "Fire" }
];
export const FINANCE_MEDIA_SECTIONS = [
  { id: "reports", label: "Reports" },
  { id: "invoices", label: "Invoices" },
  { id: "expenses", label: "Expenses" },
  { id: "customers", label: "Customers" },
  { id: "payments", label: "Payments" },
  { id: "banks", label: "Banking" },
  { id: "payroll", label: "Payroll" }
];
