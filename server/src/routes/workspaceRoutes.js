import express from "express";
import mongoose from "mongoose";

import { authMiddleware } from "../middleware/auth.js";
import { User } from "../models/User.js";
import { ExpenseRecord } from "../models/ExpenseRecord.js";
import { InvoiceRecord } from "../models/InvoiceRecord.js";
import { PurchaseOrder } from "../models/PurchaseOrder.js";
import { WarehouseOrder } from "../models/WarehouseOrder.js";
import { WarehouseProduct } from "../models/WarehouseProduct.js";
import { Workspace } from "../models/Workspace.js";
import { WorkspaceConversation } from "../models/WorkspaceConversation.js";
import { WorkspaceMembership } from "../models/WorkspaceMembership.js";
import { WorkspaceProject } from "../models/WorkspaceProject.js";
import { WorkspaceTask } from "../models/WorkspaceTask.js";
import { writeAuditLog } from "../utils/audit.js";
import { ensureWorkspaceChartOfAccounts } from "../utils/accounting.js";
import { ensureCurrencySupported, normalizeCurrencyCode } from "../utils/currency.js";
import {
  buildWorkspaceFilter,
  isAccountingEnabledForWorkspace,
  listWorkspaceMembershipsForUser,
  serializeWorkspace,
  serializeWorkspaceMembership,
  workspaceContextMiddleware,
  workspaceMembershipMiddleware
} from "../utils/workspaceContext.js";

const router = express.Router();

router.use(authMiddleware);

function serializeWorkspaceMember(membership, user) {
  return {
    id: user?._id?.toString?.() || membership?.userId?.toString?.() || "",
    membershipId: membership?._id?.toString?.() || null,
    name: user?.name || membership?.email || "Workspace member",
    email: user?.email || membership?.email || "",
    isAdmin: Boolean(user?.isAdmin),
    workspaceEnabled: membership?.status !== "suspended",
    workspaceRole: membership?.workspaceRole || "member",
    workspaceRoles: Array.isArray(membership?.financeRoles) ? membership.financeRoles : [],
    workspaceModules: Array.isArray(membership?.modules) ? membership.modules : [],
    presenceStatus: user?.presenceStatus || "offline",
    lastActiveAt: user?.lastActiveAt || null,
    membershipStatus: membership?.status || "active"
  };
}

function requireWorkspaceManager(req, res, next) {
  const workspaceRole = req.workspaceMembership?.workspaceRole;

  if (req.user?.isAdmin || workspaceRole === "owner" || workspaceRole === "manager") {
    return next();
  }

  return res.status(403).json({ message: "Workspace manager access is required." });
}

function requireWorkspaceViewer(req, res, next) {
  if (req.workspaceMembership && req.workspaceMembership.status !== "suspended") {
    return next();
  }

  return res.status(403).json({ message: "Workspace access is required." });
}

function buildScopedWorkspaceFilter(req, baseFilter = {}) {
  return buildWorkspaceFilter(req.workspace, baseFilter, {
    includeLegacy: Boolean(req.workspaceMembership?.isLegacyFallback)
  });
}

function hasWorkspaceModule(req, moduleId) {
  return Array.isArray(req.workspaceMembership?.modules) && req.workspaceMembership.modules.includes(moduleId);
}

function startOfTodayUtc(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function endOfTodayUtc(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
}

function addMoneyBucket(target, currency, amount) {
  const key = String(currency || "USD").trim().toUpperCase() || "USD";
  target[key] = Number((Number(target[key] || 0) + Number(amount || 0)).toFixed(2));
}

function buildLowStockWorkspaceExpr() {
  return {
    $and: [
      {
        $gt: [
          {
            $ifNull: ["$reorderThreshold", "$minimumStock"]
          },
          0
        ]
      },
      {
        $lte: [
          "$currentStock",
          {
            $ifNull: ["$reorderThreshold", "$minimumStock"]
          }
        ]
      }
    ]
  };
}

function buildDirectConversationKey(firstUserId, secondUserId) {
  return ["direct", firstUserId.toString(), secondUserId.toString()].sort().join(":");
}

async function ensureWorkspaceBotConversations(workspaceId, modules = []) {
  const targetModules = [...new Set(modules)].filter((moduleId) => ["finance", "warehouse"].includes(moduleId));

  if (!targetModules.length) {
    return;
  }

  await Promise.all(
    targetModules.map((moduleId) =>
      WorkspaceConversation.findOneAndUpdate(
        {
          workspaceId,
          key: `${moduleId}bot`
        },
        {
          $setOnInsert: {
            workspaceId,
            key: `${moduleId}bot`,
            kind: "bot",
            botType: moduleId,
            title: moduleId === "finance" ? "FinanceBot" : "WareBot",
            participantUserIds: [],
            messages: [],
            status: "active",
            archived: false
          }
        },
        {
          upsert: true,
          new: true
        }
      )
    )
  );
}

async function ensureWorkspaceDirectConversations(workspaceId, currentUserId) {
  const memberships = await WorkspaceMembership.find({
    workspaceId,
    status: { $ne: "suspended" },
    userId: { $ne: currentUserId }
  })
    .sort({ createdAt: 1 })
    .populate("userId", "name");

  await Promise.all(
    memberships
      .filter((membership) => membership.userId?._id)
      .map((membership) =>
        WorkspaceConversation.findOneAndUpdate(
          {
            workspaceId,
            key: buildDirectConversationKey(currentUserId, membership.userId._id)
          },
          {
            $setOnInsert: {
              workspaceId,
              key: buildDirectConversationKey(currentUserId, membership.userId._id),
              kind: "direct",
              title: membership.userId.name || membership.email || "Workspace member",
              participantUserIds: [currentUserId, membership.userId._id],
              messages: [],
              status: "active",
              archived: false
            }
          },
          {
            upsert: true,
            new: true
          }
        )
      )
  );
}

function serializeConversationMessage(message) {
  return {
    id: message._id?.toString?.() || null,
    senderId: message.senderUserId?.toString?.() || message.senderKey || "",
    senderName: message.senderName || "Workspace member",
    type: message.type || "text",
    content: message.content || "",
    metadata: message.metadata || null,
    createdAt: message.createdAt
  };
}

function serializeWorkspaceConversation(conversation, viewerId = null) {
  const participants = Array.isArray(conversation.participantUserIds) ? conversation.participantUserIds : [];
  const otherParticipant =
    conversation.kind === "direct"
      ? participants.find((participant) => participant?._id?.toString?.() !== viewerId?.toString?.())
      : null;
  const title =
    conversation.kind === "bot"
      ? conversation.title || (conversation.botType === "finance" ? "FinanceBot" : "WareBot")
      : otherParticipant?.name || conversation.title || "Workspace member";
  const lastMessage = conversation.messages?.[conversation.messages.length - 1] || null;
  const defaultPreview =
    conversation.kind === "bot"
      ? conversation.botType === "finance"
        ? "No finance records yet"
        : "No warehouse records yet"
      : `Workspace thread with ${title}`;

  return {
    id: conversation.kind === "bot" ? conversation.key : conversation._id.toString(),
    conversationId: conversation._id.toString(),
    conversationContext: "workspace",
    key: conversation.key,
    kind: conversation.kind,
    botType: conversation.botType || null,
    isBot: conversation.kind === "bot",
    title,
    counterpartUser:
      conversation.kind === "direct" && otherParticipant
        ? {
            id: otherParticipant._id?.toString?.() || null,
            name: otherParticipant.name || conversation.title || "Workspace member",
            email: otherParticipant.email || "",
            presenceStatus: otherParticipant.presenceStatus || "offline"
          }
        : null,
    participantUserIds: participants.map((participant) => participant?._id?.toString?.() || participant?.toString?.() || "").filter(Boolean),
    messages: Array.isArray(conversation.messages) ? conversation.messages.map(serializeConversationMessage) : [],
    preview: lastMessage?.content || defaultPreview,
    updatedAt: conversation.updatedAt,
    archived: Boolean(conversation.archived)
  };
}

router.get("/", async (req, res) => {
  try {
    const memberships = await listWorkspaceMembershipsForUser(req.user._id);

    return res.json({
      workspaces: memberships.map((membership) => ({
        workspace: serializeWorkspace(membership.workspaceId),
        membership: serializeWorkspaceMembership(membership)
      }))
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to load workspaces." });
  }
});

router.use(workspaceContextMiddleware({ allowDefault: false, allowSingleMembershipFallback: true }));
router.use(workspaceMembershipMiddleware({ allowLegacyFallback: true }));

router.get("/context", async (req, res) => {
  return res.json({
    workspace: serializeWorkspace(req.workspace),
    membership: serializeWorkspaceMembership(req.workspaceMembership)
  });
});

router.get("/overview", requireWorkspaceViewer, async (req, res) => {
  try {
    const financeEnabled = hasWorkspaceModule(req, "finance");
    const warehouseEnabled = hasWorkspaceModule(req, "warehouse");
    const now = new Date();
    const todayStart = startOfTodayUtc(now);
    const todayEnd = endOfTodayUtc(now);

    const [
      pendingInvoiceCount,
      overdueInvoiceCount,
      pendingExpenseCount,
      outstandingInvoiceRows,
      reconcileInvoiceCount,
      reconcileExpenseCount,
      lowStockCount,
      pendingShipmentCount,
      pendingPurchaseOrderCount,
      delayedOrderCount,
      warehouseAttentionCount,
      overdueTasks,
      dueTodayTasks,
      unassignedTaskCount,
      myTaskCount,
      activeProjects,
      projectsWithOverdueTasks
    ] = await Promise.all([
      financeEnabled
        ? InvoiceRecord.countDocuments(buildScopedWorkspaceFilter(req, { status: "pending_review" }))
        : Promise.resolve(0),
      financeEnabled
        ? InvoiceRecord.countDocuments(buildScopedWorkspaceFilter(req, { status: "overdue" }))
        : Promise.resolve(0),
      financeEnabled
        ? ExpenseRecord.countDocuments(buildScopedWorkspaceFilter(req, { status: "pending_review" }))
        : Promise.resolve(0),
      financeEnabled
        ? InvoiceRecord.aggregate([
            {
              $match: buildScopedWorkspaceFilter(req, {
                status: { $in: ["pending_review", "approved", "partial", "overdue"] }
              })
            },
            {
              $project: {
                currency: { $ifNull: ["$currency", "USD"] },
                outstanding: {
                  $max: [
                    0,
                    {
                      $subtract: [
                        { $round: [{ $multiply: [{ $ifNull: ["$amount", 0] }, 100] }, 0] },
                        { $round: [{ $multiply: [{ $ifNull: ["$paidAmount", 0] }, 100] }, 0] }
                      ]
                    }
                  ]
                }
              }
            },
            { $group: { _id: "$currency", amountCents: { $sum: "$outstanding" } } }
          ])
        : Promise.resolve([]),
      financeEnabled
        ? InvoiceRecord.countDocuments(buildScopedWorkspaceFilter(req, { status: "paid" }))
        : Promise.resolve(0),
      financeEnabled
        ? ExpenseRecord.countDocuments(buildScopedWorkspaceFilter(req, { status: { $in: ["approved", "reimbursed"] } }))
        : Promise.resolve(0),
      warehouseEnabled
        ? WarehouseProduct.countDocuments(
            buildScopedWorkspaceFilter(req, {
              productStatus: "active",
              $expr: buildLowStockWorkspaceExpr()
            })
          )
        : Promise.resolve(0),
      warehouseEnabled
        ? WarehouseOrder.countDocuments(
            buildScopedWorkspaceFilter(req, {
              status: { $in: ["pending", "packed", "dispatched", "in_transit"] }
            })
          )
        : Promise.resolve(0),
      warehouseEnabled
        ? PurchaseOrder.countDocuments(
            buildScopedWorkspaceFilter(req, {
              status: { $in: ["sent", "acknowledged", "partially_received"] }
            })
          )
        : Promise.resolve(0),
      warehouseEnabled
        ? WarehouseOrder.countDocuments(buildScopedWorkspaceFilter(req, { status: "delayed" }))
        : Promise.resolve(0),
      warehouseEnabled
        ? WarehouseProduct.countDocuments(
            buildScopedWorkspaceFilter(req, {
              productStatus: "active",
              $expr: buildLowStockWorkspaceExpr()
            })
          )
        : Promise.resolve(0),
      WorkspaceTask.find(
        buildScopedWorkspaceFilter(req, {
          dueDate: { $lt: todayStart }
        })
      )
        .select("status dueDate projectId")
        .lean(),
      WorkspaceTask.find(
        buildScopedWorkspaceFilter(req, {
          dueDate: { $gte: todayStart, $lte: todayEnd }
        })
      )
        .select("status dueDate")
        .lean(),
      WorkspaceTask.countDocuments(
        buildScopedWorkspaceFilter(req, {
          $and: [
            {
              $or: [
                { assignedTo: { $exists: false } },
                { assignedTo: { $size: 0 } }
              ]
            },
            {
              $or: [{ assigneeUserId: null }, { assigneeUserId: { $exists: false } }]
            }
          ]
        })
      ),
      WorkspaceTask.countDocuments(
        buildScopedWorkspaceFilter(req, {
          $or: [
            { assignedTo: req.user._id },
            { assigneeUserId: req.user._id }
          ],
          status: { $nin: ["done", "completed"] }
        })
      ),
      WorkspaceProject.find(buildScopedWorkspaceFilter(req, { status: { $in: ["planning", "active"] } }))
        .select("_id status")
        .lean(),
      WorkspaceTask.aggregate([
        {
          $match: buildScopedWorkspaceFilter(req, {
            projectId: { $ne: null, $exists: true },
            dueDate: { $lt: todayStart },
            status: { $nin: ["done", "completed"] }
          })
        },
        { $group: { _id: "$projectId" } }
      ])
    ]);

    const outstandingAmount = {};
    outstandingInvoiceRows.forEach((row) => {
      addMoneyBucket(outstandingAmount, row._id || "USD", Number(row.amountCents || 0) / 100);
    });

    const overdueTaskCount = overdueTasks.filter((task) => !["done", "completed"].includes(String(task.status || "").toLowerCase())).length;
    const dueTodayTaskCount = dueTodayTasks.filter((task) => !["done", "completed"].includes(String(task.status || "").toLowerCase())).length;
    const activeProjectIds = new Set(activeProjects.map((project) => project._id.toString()));
    const overdueProjectCount = projectsWithOverdueTasks.filter((entry) => activeProjectIds.has(String(entry._id))).length;

    return res.json({
      finance: financeEnabled
        ? {
            pendingApprovals: pendingInvoiceCount,
            overdueInvoices: overdueInvoiceCount,
            pendingExpenses: pendingExpenseCount,
            outstandingAmount,
            reconcileQueue: reconcileInvoiceCount + reconcileExpenseCount
          }
        : null,
      warehouse: warehouseEnabled
        ? {
            lowStock: lowStockCount,
            pendingShipments: pendingShipmentCount,
            pendingPOCount: pendingPurchaseOrderCount,
            needsAttention: warehouseAttentionCount + delayedOrderCount + pendingPurchaseOrderCount
          }
        : null,
      tasks: {
        overdue: overdueTaskCount,
        dueToday: dueTodayTaskCount,
        unassigned: unassignedTaskCount,
        myTasks: myTaskCount
      },
      projects: {
        withOverdueTasks: overdueProjectCount,
        active: activeProjects.length
      }
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to load workspace overview." });
  }
});

router.get("/settings", requireWorkspaceViewer, async (req, res) => {
  try {
    const memberships = await WorkspaceMembership.find({
      workspaceId: req.workspaceId
    })
      .sort({ createdAt: 1 })
      .populate("userId", "name email isAdmin presenceStatus lastActiveAt");

    const activeMemberships = memberships.filter((membership) => membership.status !== "suspended");
    const managers = activeMemberships
      .filter((membership) => membership.workspaceRole === "owner" || membership.workspaceRole === "manager")
      .map((membership) => serializeWorkspaceMember(membership, membership.userId))
      .slice(0, 6);
    const ownerMember =
      managers.find((member) => member.workspaceRole === "owner") ||
      managers[0] ||
      null;
    const workspaceModules = [...new Set(activeMemberships.flatMap((membership) => membership.modules || []))];

    return res.json({
      workspace: serializeWorkspace(req.workspace),
      membership: serializeWorkspaceMembership(req.workspaceMembership),
      summary: {
        owner: ownerMember,
        managers,
        workspaceModules,
        capabilities: {
          defaultCurrency: req.workspace?.defaultCurrency || "USD",
          accountingEnabled: isAccountingEnabledForWorkspace(req.workspace),
          accountingEnabledAt: req.workspace?.accountingEnabledAt || null
        },
        activeMembers: activeMemberships.length,
        suspendedMembers: memberships.length - activeMemberships.length,
        usesLegacyFallback: Boolean(req.workspaceMembership?.isLegacyFallback)
      }
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to load workspace settings." });
  }
});

router.patch("/settings/default-currency", requireWorkspaceManager, async (req, res) => {
  try {
    const currency = normalizeCurrencyCode(req.body.defaultCurrency || "USD");
    const currencyError = ensureCurrencySupported(currency, "Workspace default currency");
    if (currencyError) {
      return res.status(400).json({ message: currencyError });
    }

    const workspace = await Workspace.findOneAndUpdate(
      { _id: req.workspaceId },
      {
        $set: {
          defaultCurrency: currency
        }
      },
      {
        new: true,
        runValidators: true
      }
    );

    await writeAuditLog({
      actor: req.user._id,
      action: "workspace.default_currency.update",
      targetId: req.workspaceId?.toString?.() || null,
      targetType: "Workspace",
      metadata: {
        workspaceId: req.workspaceId?.toString?.() || null,
        defaultCurrency: currency
      }
    });

    return res.json({
      success: true,
      workspace: serializeWorkspace(workspace),
      capabilities: {
        defaultCurrency: workspace?.defaultCurrency || "USD",
        accountingEnabled: isAccountingEnabledForWorkspace(workspace),
        accountingEnabledAt: workspace?.accountingEnabledAt || null
      }
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to update workspace default currency." });
  }
});

router.post("/settings/accounting/enable", requireWorkspaceManager, async (req, res) => {
  try {
    let workspace = req.workspace;

    if (!isAccountingEnabledForWorkspace(workspace)) {
      const enabledAt = new Date();
      workspace = await Workspace.findOneAndUpdate(
        { _id: req.workspaceId },
        {
          $set: {
            accountingEnabled: true,
            accountingEnabledAt: enabledAt
          }
        },
        {
          new: true,
          runValidators: true
        }
      );

      await ensureWorkspaceChartOfAccounts(req.workspaceId);

      await writeAuditLog({
        actor: req.user._id,
        action: "workspace.accounting.enable",
        targetId: req.workspaceId?.toString?.() || null,
        targetType: "Workspace",
        metadata: {
          workspaceId: req.workspaceId?.toString?.() || null,
          workspaceName: workspace?.name || req.workspace?.name || "",
          accountingEnabledAt: enabledAt.toISOString()
        }
      });
    }

    return res.json({
      success: true,
      workspace: serializeWorkspace(workspace),
      capabilities: {
        accountingEnabled: isAccountingEnabledForWorkspace(workspace),
        accountingEnabledAt: workspace?.accountingEnabledAt || null
      }
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to enable accounting for this workspace." });
  }
});

router.get("/conversations", requireWorkspaceViewer, async (req, res) => {
  try {
    const modules = Array.isArray(req.workspaceMembership?.modules) ? req.workspaceMembership.modules : [];
    await ensureWorkspaceBotConversations(req.workspaceId, modules);
    await ensureWorkspaceDirectConversations(req.workspaceId, req.user._id);

    const conversations = await WorkspaceConversation.find({
      workspaceId: req.workspaceId,
      archived: false,
      status: "active",
      $or: [
        { kind: "bot" },
        { participantUserIds: req.user._id }
      ]
    })
      .sort({ updatedAt: -1 })
      .populate("participantUserIds", "name email presenceStatus");

    return res.json(
      conversations.map((conversation) => serializeWorkspaceConversation(conversation, req.user._id))
    );
  } catch (error) {
    return res.status(500).json({ message: "Unable to load workspace conversations." });
  }
});

router.post("/conversations/:id/messages", requireWorkspaceViewer, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid workspace conversation id." });
    }

    const content = String(req.body.content || "").trim();
    if (!content) {
      return res.status(400).json({ message: "Message content is required." });
    }

    const conversation = await WorkspaceConversation.findOne({
      _id: req.params.id,
      workspaceId: req.workspaceId,
      archived: false,
      status: "active"
    }).populate("participantUserIds", "name email presenceStatus");

    if (!conversation) {
      return res.status(404).json({ message: "Workspace conversation not found." });
    }

    if (conversation.kind !== "direct") {
      return res.status(400).json({ message: "Only direct workspace conversations accept text messages right now." });
    }

    const isParticipant = (conversation.participantUserIds || []).some(
      (participant) => participant?._id?.toString?.() === req.user._id.toString()
    );
    if (!isParticipant) {
      return res.status(403).json({ message: "You are not a participant in this workspace conversation." });
    }

    conversation.messages.push({
      senderUserId: req.user._id,
      senderKey: req.user._id.toString(),
      senderName: req.user.name || req.user.email || "Workspace member",
      type: "text",
      content,
      createdAt: new Date()
    });
    conversation.title =
      conversation.title ||
      conversation.participantUserIds.find((participant) => participant?._id?.toString?.() !== req.user._id.toString())?.name ||
      "Workspace member";
    await conversation.save();
    await conversation.populate("participantUserIds", "name email presenceStatus");

    await writeAuditLog({
      actor: req.user._id,
      action: "workspace.conversation.message.create",
      targetId: conversation._id.toString(),
      targetType: "WorkspaceConversation",
      metadata: {
        workspaceId: req.workspaceId?.toString?.() || null,
        conversationKey: conversation.key,
        kind: conversation.kind
      }
    });

    return res.json(serializeWorkspaceConversation(conversation, req.user._id));
  } catch (error) {
    return res.status(500).json({ message: "Unable to send the workspace message." });
  }
});

router.get("/members", requireWorkspaceManager, async (req, res) => {
  try {
    const memberships = await WorkspaceMembership.find({
      workspaceId: req.workspaceId,
      status: { $ne: "suspended" }
    })
      .sort({ createdAt: 1 })
      .populate("userId", "name email isAdmin presenceStatus lastActiveAt");

    return res.json(
      memberships.map((membership) => serializeWorkspaceMember(membership, membership.userId))
    );
  } catch (error) {
    return res.status(500).json({ message: "Unable to load workspace members." });
  }
});

router.post("/:id/invite-accountant", requireWorkspaceManager, async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const name = String(req.body.name || "").trim();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: "A valid accountant email is required." });
    }

    if (!name) {
      return res.status(400).json({ message: "Accountant name is required." });
    }

    let user = await User.findOne({ email });
    if (!user) {
      user = await User.create({
        name,
        email,
        password: `invite-${Math.random().toString(36).slice(2, 12)}`
      });
    }

    const membership = await WorkspaceMembership.findOneAndUpdate(
      {
        workspaceId: req.workspaceId,
        userId: user._id
      },
      {
        $set: {
          email,
          workspaceRole: "member",
          financeRoles: ["accountant"],
          modules: ["finance"],
          status: "invited",
          invitedBy: req.user._id
        }
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
        runValidators: true
      }
    ).populate("userId", "name email isAdmin presenceStatus lastActiveAt");

    await writeAuditLog({
      actor: req.user._id,
      action: "workspace.accountant.invite",
      targetId: membership.userId?._id?.toString?.() || user._id.toString(),
      targetType: "WorkspaceMembership",
      metadata: {
        workspaceId: req.workspaceId?.toString?.() || null,
        email,
        name
      }
    });

    return res.status(201).json(serializeWorkspaceMember(membership, membership.userId));
  } catch (_error) {
    return res.status(500).json({ message: "Unable to invite accountant." });
  }
});

router.patch("/members/:id/access", requireWorkspaceManager, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid user id." });
    }

    const targetUser = await User.findById(req.params.id).select("name email isAdmin presenceStatus lastActiveAt");
    if (!targetUser) {
      return res.status(404).json({ message: "User not found." });
    }

    const allowedWorkspaceRoles = req.user?.isAdmin
      ? ["owner", "manager", "member"]
      : ["manager", "member"];
    const allowedModules = ["finance", "warehouse"];

    const nextWorkspaceEnabled =
      req.body.workspaceEnabled === undefined ? undefined : req.body.workspaceEnabled;
    if (nextWorkspaceEnabled !== undefined && typeof nextWorkspaceEnabled !== "boolean") {
      return res.status(400).json({ message: "Workspace access flag must be true or false." });
    }

    let nextWorkspaceRole;
    if (req.body.workspaceRole !== undefined) {
      nextWorkspaceRole = req.body.workspaceRole === null ? null : String(req.body.workspaceRole).trim();
      if (nextWorkspaceRole && !allowedWorkspaceRoles.includes(nextWorkspaceRole)) {
        return res.status(400).json({ message: `Invalid workspace role: ${nextWorkspaceRole}` });
      }
    }

    let nextModules;
    if (req.body.workspaceModules !== undefined) {
      if (!Array.isArray(req.body.workspaceModules)) {
        return res.status(400).json({ message: "Workspace modules must be an array." });
      }

      nextModules = [...new Set(req.body.workspaceModules.map((module) => String(module).trim()))];
      const invalidModule = nextModules.find((module) => !allowedModules.includes(module));
      if (invalidModule) {
        return res.status(400).json({ message: `Invalid workspace module: ${invalidModule}` });
      }
    }

    let membership = await WorkspaceMembership.findOne({
      workspaceId: req.workspaceId,
      userId: targetUser._id
    });

    if (!membership && nextWorkspaceEnabled === false) {
      return res.status(404).json({ message: "Workspace membership not found." });
    }

    if (!membership) {
      membership = await WorkspaceMembership.create({
        workspaceId: req.workspaceId,
        userId: targetUser._id,
        email: targetUser.email,
        workspaceRole: nextWorkspaceRole || "member",
        financeRoles: [],
        modules: nextModules || [],
        status: "active",
        invitedBy: req.user._id
      });
    } else {
      if (nextWorkspaceRole !== undefined) {
        membership.workspaceRole = nextWorkspaceRole || "member";
      }

      if (nextModules !== undefined) {
        membership.modules = nextModules;
        if (!membership.modules.includes("finance") && membership.financeRoles?.length) {
          membership.financeRoles = [];
        }
      }

      if (nextWorkspaceEnabled !== undefined) {
        membership.status = nextWorkspaceEnabled ? "active" : "suspended";
      }

      await membership.save();
    }

    await membership.populate("userId", "name email isAdmin presenceStatus lastActiveAt");

    await writeAuditLog({
      actor: req.user._id,
      action: "workspace.member.access.update",
      targetId: targetUser._id.toString(),
      targetType: "WorkspaceMembership",
      metadata: {
        workspaceId: req.workspaceId?.toString?.() || null,
        email: targetUser.email,
        workspaceEnabled: membership.status !== "suspended",
        workspaceRole: membership.workspaceRole || null,
        workspaceModules: membership.modules || []
      }
    });

    return res.json(serializeWorkspaceMember(membership, membership.userId));
  } catch (error) {
    return res.status(500).json({ message: "Unable to update workspace access." });
  }
});

export default router;
