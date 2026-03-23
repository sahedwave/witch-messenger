import bcrypt from "bcryptjs";
import { PrismaClient, ConversationType, ConversationMemberRole, ExpenseCategory, InvoiceStatus, MessageType, NotificationType, OrderStatus, StockAlertStatus, StockAlertType, UserRole } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const password = await bcrypt.hash("Password123!", 10);

  const users = await Promise.all(
    [
      { name: "Maya Rahman", email: "owner@example.com", role: UserRole.owner, department: "Executive" },
      { name: "Jordan Lee", email: "manager@example.com", role: UserRole.manager, department: "Operations" },
      { name: "Farhan Karim", email: "finance@example.com", role: UserRole.finance, department: "Finance" },
      { name: "Nadia Sultana", email: "warehouse@example.com", role: UserRole.warehouse, department: "Warehouse" },
      { name: "Rafi Hasan", email: "staff@example.com", role: UserRole.staff, department: "Support" },
      { name: "FinanceBot", email: "financebot@example.com", role: UserRole.finance, department: "Bots" },
      { name: "WareBot", email: "warebot@example.com", role: UserRole.warehouse, department: "Bots" }
    ].map((entry) =>
      prisma.user.upsert({
        where: { email: entry.email },
        update: { ...entry, password, isOnline: true },
        create: { ...entry, password, isOnline: true }
      })
    )
  );

  const [owner, manager, financeOfficer, warehouseSupervisor, staff, financeBot, wareBot] = users;

  const financeConversation = await prisma.conversation.create({
    data: {
      type: ConversationType.bot,
      name: "FinanceBot",
      createdById: owner.id,
      members: {
        create: [
          { userId: owner.id, role: ConversationMemberRole.admin },
          { userId: manager.id, role: ConversationMemberRole.member },
          { userId: financeOfficer.id, role: ConversationMemberRole.member }
        ]
      }
    }
  });

  const warehouseConversation = await prisma.conversation.create({
    data: {
      type: ConversationType.bot,
      name: "WareBot",
      createdById: owner.id,
      members: {
        create: [
          { userId: owner.id, role: ConversationMemberRole.admin },
          { userId: manager.id, role: ConversationMemberRole.member },
          { userId: warehouseSupervisor.id, role: ConversationMemberRole.member }
        ]
      }
    }
  });

  await prisma.budget.create({
    data: {
      department: "Operations",
      totalAmount: 50000,
      spentAmount: 41200,
      period: "monthly",
      startDate: new Date("2026-03-01"),
      endDate: new Date("2026-03-31"),
      createdById: manager.id
    }
  });

  const products = await Promise.all(
    [
      {
        name: "Cardboard Boxes",
        sku: "BX-001",
        description: "Shipping boxes for outbound orders",
        category: "Packaging",
        unit: "boxes",
        currentStock: 12,
        minimumStock: 40,
        reorderQuantity: 120,
        warehouseLocation: "A-01"
      },
      {
        name: "Thermal Labels",
        sku: "LB-204",
        description: "Labels for shipment printing",
        category: "Packaging",
        unit: "rolls",
        currentStock: 18,
        minimumStock: 60,
        reorderQuantity: 200,
        warehouseLocation: "B-02"
      },
      {
        name: "Packing Sleeves",
        sku: "PS-312",
        description: "Protective sleeves for fragile items",
        category: "Packaging",
        unit: "packs",
        currentStock: 84,
        minimumStock: 40,
        reorderQuantity: 80,
        warehouseLocation: "C-07"
      }
    ].map((product) =>
      prisma.product.upsert({
        where: { sku: product.sku },
        update: product,
        create: product
      })
    )
  );

  const invoiceEntries = [
    { invoiceNumber: "INV-301", companyName: "Northwind Labs", amount: 12400, dueDate: "2026-03-12", status: InvoiceStatus.pending },
    { invoiceNumber: "INV-302", companyName: "Bluehaven Retail", amount: 8800, dueDate: "2026-03-11", status: InvoiceStatus.pending },
    { invoiceNumber: "INV-303", companyName: "Elm Street Supply", amount: 16350, dueDate: "2026-03-08", status: InvoiceStatus.overdue }
  ];

  for (const invoice of invoiceEntries) {
    const message = await prisma.message.create({
      data: {
        conversationId: financeConversation.id,
        senderId: financeBot.id,
        type: MessageType.invoice,
        content: `${invoice.invoiceNumber} requires review.`,
        metadata: invoice
      }
    });

    await prisma.invoice.create({
      data: {
        invoiceNumber: invoice.invoiceNumber,
        companyName: invoice.companyName,
        amount: invoice.amount,
        dueDate: new Date(invoice.dueDate),
        status: invoice.status,
        createdById: financeOfficer.id,
        conversationId: financeConversation.id,
        messageId: message.id
      }
    });
  }

  const expenseEntries = [
    { amount: 450, category: ExpenseCategory.supplies, note: "Packaging tape", date: "2026-03-09" },
    { amount: 1280, category: ExpenseCategory.travel, note: "Supplier visit", date: "2026-03-07" },
    { amount: 920, category: ExpenseCategory.marketing, note: "Trade fair collateral", date: "2026-03-03" }
  ];

  for (const entry of expenseEntries) {
    const message = await prisma.message.create({
      data: {
        conversationId: financeConversation.id,
        senderId: financeOfficer.id,
        type: MessageType.expense,
        content: `${entry.note} logged as expense.`,
        metadata: entry
      }
    });

    await prisma.expense.create({
      data: {
        amount: entry.amount,
        category: entry.category,
        note: entry.note,
        loggedById: financeOfficer.id,
        conversationId: financeConversation.id,
        messageId: message.id,
        createdAt: new Date(entry.date)
      }
    });
  }

  const lowStockEntries = [
    { product: products[0], type: StockAlertType.low_stock },
    { product: products[1], type: StockAlertType.low_stock }
  ];

  for (const entry of lowStockEntries) {
    const message = await prisma.message.create({
      data: {
        conversationId: warehouseConversation.id,
        senderId: wareBot.id,
        type: MessageType.stock_alert,
        content: `${entry.product.name} is below minimum stock.`,
        metadata: {
          productName: entry.product.name,
          sku: entry.product.sku,
          currentStock: entry.product.currentStock,
          minimumStock: entry.product.minimumStock
        }
      }
    });

    await prisma.stockAlert.create({
      data: {
        productId: entry.product.id,
        alertType: entry.type,
        currentStock: entry.product.currentStock,
        minimumStock: entry.product.minimumStock,
        status: StockAlertStatus.active,
        conversationId: warehouseConversation.id,
        messageId: message.id
      }
    });
  }

  const shipmentMessage = await prisma.message.create({
    data: {
      conversationId: warehouseConversation.id,
      senderId: wareBot.id,
      type: MessageType.shipment,
      content: "Shipment ORD-9001 is in transit.",
      metadata: {
        orderNumber: "ORD-9001",
        destination: "Dhaka Central Depot",
        status: "in_transit"
      }
    }
  });

  await prisma.order.create({
    data: {
      orderNumber: "ORD-9001",
      productId: products[2].id,
      quantity: 80,
      status: OrderStatus.in_transit,
      supplierName: "Packline Asia",
      destination: "Dhaka Central Depot",
      estimatedDelivery: new Date("2026-03-12"),
      createdById: warehouseSupervisor.id,
      conversationId: warehouseConversation.id,
      messageId: shipmentMessage.id
    }
  });

  await prisma.notification.createMany({
    data: [
      {
        userId: manager.id,
        type: NotificationType.invoice_pending,
        title: "FinanceBot",
        body: "Invoice INV-301 needs approval",
        referenceType: "invoice"
      },
      {
        userId: warehouseSupervisor.id,
        type: NotificationType.low_stock,
        title: "WareBot",
        body: "Cardboard Boxes below minimum stock",
        referenceType: "stock_alert"
      }
    ]
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
