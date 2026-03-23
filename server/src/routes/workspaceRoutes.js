import express from "express";
import mongoose from "mongoose";

import { authMiddleware } from "../middleware/auth.js";
import { BankAccount } from "../models/BankAccount.js";
import { BankTransaction } from "../models/BankTransaction.js";
import { ChartOfAccount } from "../models/ChartOfAccount.js";
import { User } from "../models/User.js";
import { ExpenseRecord } from "../models/ExpenseRecord.js";
import { FinanceActionLog } from "../models/FinanceActionLog.js";
import { FinanceCustomer } from "../models/FinanceCustomer.js";
import { FinancePeriodLock } from "../models/FinancePeriodLock.js";
import { FinanceVendor } from "../models/FinanceVendor.js";
import { InvoiceRecord } from "../models/InvoiceRecord.js";
import { JournalEntry } from "../models/JournalEntry.js";
import { PayrollRecord } from "../models/PayrollRecord.js";
import { PurchaseOrder } from "../models/PurchaseOrder.js";
import { WarehouseOrder } from "../models/WarehouseOrder.js";
import { WarehouseProduct } from "../models/WarehouseProduct.js";
import { WarehouseStockMovement } from "../models/WarehouseStockMovement.js";
import { Workspace } from "../models/Workspace.js";
import { WorkspaceConversation } from "../models/WorkspaceConversation.js";
import { WorkspaceMembership } from "../models/WorkspaceMembership.js";
import { WorkspaceNotification } from "../models/WorkspaceNotification.js";
import { WorkspaceProject } from "../models/WorkspaceProject.js";
import { WorkspaceTask } from "../models/WorkspaceTask.js";
import { writeAuditLog } from "../utils/audit.js";
import { ensureWorkspaceChartOfAccounts } from "../utils/accounting.js";
import { ensureCurrencySupported, normalizeCurrencyCode } from "../utils/currency.js";
import { isValidEmail, validateName } from "../utils/validation.js";
import {
  DISABLED_WORKSPACE_MESSAGE,
  buildWorkspaceFilter,
  isAccountingEnabledForWorkspace,
  listWorkspaceMembershipsForUser,
  serializeWorkspace,
  serializeWorkspaceMembership,
  workspaceContextMiddleware,
  workspaceMembershipMiddleware
} from "../utils/workspaceContext.js";
import {
  deriveTeamMemberRoleFromMembership,
  isSupportedTeamMemberRole,
  resolveMembershipAccessFromTeamRole
} from "../utils/workspaceMembershipRoles.js";

const router = express.Router();
const WORKSPACE_ROLES = ["owner", "manager", "member"];
const MODULE_IDS = ["finance", "warehouse"];
const FINANCE_ROLES = ["viewer", "approver", "finance_staff", "accountant"];

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
    teamRole: deriveTeamMemberRoleFromMembership(membership),
    workspaceRoles: Array.isArray(membership?.financeRoles) ? membership.financeRoles : [],
    workspaceModules: Array.isArray(membership?.modules) ? membership.modules : [],
    presenceStatus: user?.presenceStatus || "offline",
    lastActiveAt: user?.lastActiveAt || null,
    membershipStatus: membership?.status || "active"
  };
}

function applyTeamMemberRoleToMembership(membership, role) {
  const roleConfig = resolveMembershipAccessFromTeamRole(role);
  if (!roleConfig) {
    return false;
  }

  membership.workspaceRole = roleConfig.workspaceRole;
  membership.modules = roleConfig.modules;
  membership.financeRoles = roleConfig.financeRoles;
  return true;
}

function normalizeModules(input) {
  if (!Array.isArray(input)) {
    return [];
  }

  return [...new Set(input.map((entry) => String(entry).trim()).filter(Boolean))];
}

function normalizeFinanceRoles(input) {
  if (!Array.isArray(input)) {
    return [];
  }

  return [...new Set(input.map((entry) => String(entry).trim()).filter(Boolean))];
}

async function findWorkspaceMemberRecord(workspaceId, memberId) {
  if (!mongoose.isValidObjectId(memberId)) {
    return null;
  }

  return WorkspaceMembership.findOne({
    workspaceId,
    $or: [{ _id: memberId }, { userId: memberId }]
  }).populate("userId", "name email isAdmin presenceStatus lastActiveAt");
}

async function syncWorkspaceOwnerRecord(workspaceId, preferredOwnerUserId = null) {
  const workspace = await Workspace.findById(workspaceId);
  if (!workspace) {
    return null;
  }

  if (preferredOwnerUserId && mongoose.isValidObjectId(preferredOwnerUserId)) {
    workspace.ownerUserId = preferredOwnerUserId;
    await workspace.save();
    return workspace;
  }

  const ownerMembership = await WorkspaceMembership.findOne({
    workspaceId,
    workspaceRole: "owner",
    status: { $ne: "suspended" }
  }).sort({ updatedAt: -1, createdAt: 1 });

  workspace.ownerUserId = ownerMembership?.userId || null;
  await workspace.save();
  return workspace;
}

function requireWorkspaceManager(req, res, next) {
  const workspaceRole = req.workspaceMembership?.workspaceRole;

  if (req.user?.isAdmin || workspaceRole === "owner" || workspaceRole === "manager") {
    return next();
  }

  return res.status(403).json({ message: "Workspace manager access is required." });
}

function requirePlatformAdmin(req, res, next) {
  if (req.user?.isAdmin || req.user?.isSystemAdmin) {
    return next();
  }

  return res.status(403).json({ message: "Platform owner access is required." });
}

function requireWorkspaceViewer(req, res, next) {
  if (req.workspaceMembership && req.workspaceMembership.status !== "suspended") {
    return next();
  }

  return res.status(403).json({ message: "Workspace access is required." });
}

function isPlatformAdminRequest(req) {
  return Boolean(req.user?.isAdmin || req.user?.isSystemAdmin);
}

function isWorkspaceOwnerRequest(req) {
  return req.workspaceMembership?.workspaceRole === "owner";
}

function isWorkspaceManagerRequest(req) {
  return req.workspaceMembership?.workspaceRole === "manager";
}

function canManageTargetMembership(req, membership, options = {}) {
  if (isPlatformAdminRequest(req)) {
    return { ok: true };
  }

  if (membership.userId?._id?.toString?.() === req.user?._id?.toString?.()) {
    return { ok: false, status: 400, message: "You cannot change your own role." };
  }

  if (isWorkspaceOwnerRequest(req)) {
    return { ok: true };
  }

  if (isWorkspaceManagerRequest(req)) {
    if (membership.workspaceRole === "owner" || membership.workspaceRole === "manager") {
      return { ok: false, status: 403, message: "Only the workspace owner can manage owners or managers." };
    }

    if (options.nextWorkspaceRole === "owner" || options.nextWorkspaceRole === "manager") {
      return { ok: false, status: 403, message: "Only the workspace owner can assign owner or manager access." };
    }

    if (options.toggleRole === "manager") {
      return { ok: false, status: 403, message: "Only the workspace owner can assign or remove manager access." };
    }
  }

  return { ok: true };
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

async function ensureWorkspaceGroupConversation(workspaceId) {
  const memberships = await WorkspaceMembership.find({
    workspaceId,
    status: { $ne: "suspended" }
  }).select("userId");

  const participantUserIds = memberships
    .map((membership) => membership.userId)
    .filter(Boolean);

  await WorkspaceConversation.findOneAndUpdate(
    {
      workspaceId,
      key: "general"
    },
    {
      $set: {
        title: "Workspace General",
        kind: "group",
        participantUserIds,
        status: "active",
        archived: false
      },
      $setOnInsert: {
        workspaceId,
        key: "general",
        botType: null,
        messages: []
      }
    },
    {
      upsert: true,
      new: true
    }
  );
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
      : conversation.kind === "group"
        ? conversation.title || "Workspace General"
      : otherParticipant?.name || conversation.title || "Workspace member";
  const lastMessage = conversation.messages?.[conversation.messages.length - 1] || null;
  const defaultPreview =
    conversation.kind === "bot"
      ? conversation.botType === "finance"
        ? "No finance records yet"
        : "No warehouse records yet"
      : conversation.kind === "group"
        ? "Share an update with everyone in this workspace"
      : `Workspace thread with ${title}`;

  return {
    id: conversation.kind === "bot" ? conversation.key : conversation._id.toString(),
    conversationId: conversation._id.toString(),
    conversationContext: "workspace",
    key: conversation.key,
    kind: conversation.kind,
    botType: conversation.botType || null,
    isBot: conversation.kind === "bot",
    isGroup: conversation.kind === "group",
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

function attachWorkspaceIdFromParams(req, _res, next) {
  if (req.params.id && !req.headers["x-workspace-id"]) {
    req.headers["x-workspace-id"] = req.params.id;
  }

  return next();
}

const workspaceParamContext = [
  attachWorkspaceIdFromParams,
  workspaceContextMiddleware({ allowDefault: false, allowSingleMembershipFallback: false }),
  workspaceMembershipMiddleware({ allowLegacyFallback: true })
];

router.get("/:id/members", ...workspaceParamContext, requireWorkspaceManager, async (req, res) => {
  try {
    const memberships = await WorkspaceMembership.find({
      workspaceId: req.workspaceId
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

router.post("/:id/members/invite", ...workspaceParamContext, requireWorkspaceManager, async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const name = String(req.body.name || "").trim();
    const requestedRole = req.body.role === undefined ? "" : String(req.body.role || "").trim();

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: "A valid member email is required." });
    }

    if (requestedRole && !isSupportedTeamMemberRole(requestedRole)) {
      return res.status(400).json({ message: `Invalid workspace role: ${requestedRole}` });
    }

    const roleConfig = requestedRole ? resolveMembershipAccessFromTeamRole(requestedRole) : null;
    const workspaceRole = String(req.body.workspaceRole || roleConfig?.workspaceRole || "member").trim();
    const modules = normalizeModules(req.body.modules ?? roleConfig?.modules ?? []);
    const financeRoles = normalizeFinanceRoles(req.body.financeRoles ?? roleConfig?.financeRoles ?? []);

    if (!WORKSPACE_ROLES.includes(workspaceRole)) {
      return res.status(400).json({ message: `Invalid workspace role: ${workspaceRole}` });
    }

    const invalidModule = modules.find((moduleId) => !MODULE_IDS.includes(moduleId));
    if (invalidModule) {
      return res.status(400).json({ message: `Invalid module: ${invalidModule}` });
    }

    const invalidFinanceRole = financeRoles.find((role) => !FINANCE_ROLES.includes(role));
    if (invalidFinanceRole) {
      return res.status(400).json({ message: `Invalid finance role: ${invalidFinanceRole}` });
    }

    if (financeRoles.length && !modules.includes("finance")) {
      return res.status(400).json({ message: "Finance roles can only be assigned when finance access is enabled." });
    }

    const permission = canManageTargetMembership(req, { workspaceRole: "member", userId: null }, {
      nextWorkspaceRole: workspaceRole
    });
    if (!permission.ok) {
      return res.status(permission.status).json({ message: permission.message });
    }
    const nameToUse = name || email.split("@")[0];
    const nameError = validateName(nameToUse);
    if (nameError) {
      return res.status(400).json({ message: nameError });
    }

    let user = await User.findOne({ email }).select("+password");
    if (!user) {
      user = await User.create({
        name: nameToUse,
        email,
        password: `invite-${Math.random().toString(36).slice(2, 14)}`
      });
    } else if (name && name !== user.name) {
      user.name = nameToUse;
      await user.save();
    }

    const membership = await WorkspaceMembership.findOneAndUpdate(
      {
        workspaceId: req.workspaceId,
        userId: user._id
      },
      {
        $set: {
          email: user.email,
          workspaceRole,
          modules,
          financeRoles,
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

    if (workspaceRole === "owner") {
      await syncWorkspaceOwnerRecord(req.workspaceId, user._id);
    }

    await writeAuditLog({
      actor: req.user._id,
      action: "workspace.member.invite",
      targetId: membership.userId?._id?.toString?.() || user._id.toString(),
      targetType: "WorkspaceMembership",
      metadata: {
        workspaceId: req.workspaceId?.toString?.() || null,
        email: user.email,
        role: requestedRole || null,
        workspaceRole,
        modules,
        financeRoles
      }
    });

    return res.status(201).json(serializeWorkspaceMember(membership, membership.userId));
  } catch (error) {
    return res.status(500).json({ message: "Unable to invite workspace member." });
  }
});

router.patch("/:id/members/:memberId/role", ...workspaceParamContext, requireWorkspaceManager, async (req, res) => {
  try {
    const role = String(req.body.role || "").trim();
    if (!isSupportedTeamMemberRole(role)) {
      return res.status(400).json({ message: `Invalid workspace role: ${role}` });
    }

    const membership = await findWorkspaceMemberRecord(req.workspaceId, req.params.memberId);
    if (!membership) {
      return res.status(404).json({ message: "Workspace membership not found." });
    }

    const roleConfig = resolveMembershipAccessFromTeamRole(role);
    const permission = canManageTargetMembership(req, membership, {
      nextWorkspaceRole: roleConfig?.workspaceRole || "member"
    });
    if (!permission.ok) {
      return res.status(permission.status).json({ message: permission.message });
    }

    applyTeamMemberRoleToMembership(membership, role);
    await membership.save();

    if (membership.workspaceRole === "owner") {
      await syncWorkspaceOwnerRecord(req.workspaceId, membership.userId?._id || membership.userId);
    } else if (req.workspace?.ownerUserId?.toString?.() === membership.userId?._id?.toString?.()) {
      await syncWorkspaceOwnerRecord(req.workspaceId);
    }

    await writeAuditLog({
      actor: req.user._id,
      action: "workspace.member.role.update",
      targetId: membership.userId?._id?.toString?.() || membership.userId?.toString?.() || null,
      targetType: "WorkspaceMembership",
      metadata: {
        workspaceId: req.workspaceId?.toString?.() || null,
        role
      }
    });

    return res.json(serializeWorkspaceMember(membership, membership.userId));
  } catch (error) {
    return res.status(500).json({ message: "Unable to update workspace member role." });
  }
});

router.patch("/:id/members/:memberId/roles/toggle", ...workspaceParamContext, requireWorkspaceManager, async (req, res) => {
  try {
    const role = String(req.body.role || "").trim();
    const toggleableRoles = ["viewer", "approver", "finance_staff", "warehouse_staff", "accountant", "manager"];
    const isPlatformAdmin = isPlatformAdminRequest(req);

    if (!toggleableRoles.includes(role)) {
      return res.status(400).json({ message: `Invalid toggle role: ${role}` });
    }

    const membership = await findWorkspaceMemberRecord(req.workspaceId, req.params.memberId);
    if (!membership) {
      return res.status(404).json({ message: "Workspace membership not found." });
    }

    const permission = canManageTargetMembership(req, membership, {
      toggleRole: role
    });
    if (!permission.ok) {
      return res.status(permission.status).json({ message: permission.message });
    }

    const nextFinanceRoles = [...new Set(Array.isArray(membership.financeRoles) ? membership.financeRoles : [])];
    const nextModules = [...new Set(Array.isArray(membership.modules) ? membership.modules : [])];
    let nextWorkspaceRole = membership.workspaceRole || "member";

    if (role === "manager") {
      if (!isPlatformAdmin && nextWorkspaceRole === "owner") {
        return res.status(400).json({ message: "Workspace owner access cannot be toggled here." });
      }

      if (nextWorkspaceRole === "manager") {
        nextWorkspaceRole = "member";
      } else {
        nextWorkspaceRole = "manager";
        if (!nextModules.includes("finance")) {
          nextModules.push("finance");
        }
        if (!nextModules.includes("warehouse")) {
          nextModules.push("warehouse");
        }
        for (const financeRole of ["viewer", "approver", "finance_staff"]) {
          if (!nextFinanceRoles.includes(financeRole)) {
            nextFinanceRoles.push(financeRole);
          }
        }
      }
    } else if (role === "warehouse_staff") {
      const hasWarehouseAccess = nextModules.includes("warehouse");
      membership.modules = hasWarehouseAccess
        ? nextModules.filter((entry) => entry !== "warehouse")
        : [...nextModules, "warehouse"];
    } else {
      const hasFinanceRole = nextFinanceRoles.includes(role);
      membership.financeRoles = hasFinanceRole
        ? nextFinanceRoles.filter((entry) => entry !== role)
        : [...nextFinanceRoles, role];

      if (!hasFinanceRole && !nextModules.includes("finance")) {
        membership.modules = [...new Set([...(membership.modules || []), "finance"])];
      }
    }

    if (role === "manager") {
      membership.workspaceRole = nextWorkspaceRole;
      membership.modules = nextModules;
      membership.financeRoles = nextFinanceRoles;
    } else if (role === "warehouse_staff") {
      membership.workspaceRole = nextWorkspaceRole;
      membership.financeRoles = nextFinanceRoles;
    } else {
      membership.workspaceRole = nextWorkspaceRole;
    }

    const normalizedModules = [...new Set(Array.isArray(membership.modules) ? membership.modules : [])];
    const normalizedFinanceRoles = [...new Set(Array.isArray(membership.financeRoles) ? membership.financeRoles : [])];

    if (!normalizedFinanceRoles.length && membership.workspaceRole !== "owner" && membership.workspaceRole !== "manager") {
      membership.modules = normalizedModules.filter((entry) => entry !== "finance");
    } else {
      membership.modules = normalizedModules;
    }

    membership.financeRoles = normalizedFinanceRoles;
    await membership.save();

    if (membership.workspaceRole === "owner") {
      await syncWorkspaceOwnerRecord(req.workspaceId, membership.userId?._id || membership.userId);
    } else if (req.workspace?.ownerUserId?.toString?.() === membership.userId?._id?.toString?.()) {
      await syncWorkspaceOwnerRecord(req.workspaceId);
    }

    await writeAuditLog({
      actor: req.user._id,
      action: "workspace.member.role.toggle",
      targetId: membership.userId?._id?.toString?.() || membership.userId?.toString?.() || null,
      targetType: "WorkspaceMembership",
      metadata: {
        workspaceId: req.workspaceId?.toString?.() || null,
        role,
        workspaceRole: membership.workspaceRole,
        modules: membership.modules,
        financeRoles: membership.financeRoles
      }
    });

    return res.json(serializeWorkspaceMember(membership, membership.userId));
  } catch (error) {
    return res.status(500).json({ message: "Unable to toggle workspace member role." });
  }
});

router.delete("/:id/members/:memberId", ...workspaceParamContext, requireWorkspaceManager, async (req, res) => {
  try {
    const membership = await findWorkspaceMemberRecord(req.workspaceId, req.params.memberId);
    if (!membership) {
      return res.status(404).json({ message: "Workspace membership not found." });
    }

    const permission = canManageTargetMembership(req, membership);
    if (!permission.ok) {
      return res.status(permission.status).json({ message: permission.message });
    }

    if (
      isWorkspaceOwnerRequest(req) &&
      membership.userId?._id?.toString?.() === req.user?._id?.toString?.()
    ) {
      return res.status(400).json({ message: "Workspace owners cannot remove themselves." });
    }

    await WorkspaceMembership.deleteOne({ _id: membership._id });

    if (req.workspace?.ownerUserId?.toString?.() === membership.userId?._id?.toString?.()) {
      await syncWorkspaceOwnerRecord(req.workspaceId);
    }

    await writeAuditLog({
      actor: req.user._id,
      action: "workspace.member.remove",
      targetId: membership.userId?._id?.toString?.() || membership.userId?.toString?.() || null,
      targetType: "WorkspaceMembership",
      metadata: {
        workspaceId: req.workspaceId?.toString?.() || null,
        email: membership.email || membership.userId?.email || null
      }
    });

    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ message: "Unable to remove workspace member." });
  }
});

router.post("/:id/disable", ...workspaceParamContext, requirePlatformAdmin, async (req, res) => {
  try {
    req.workspace.disabled = true;
    req.workspace.disabledAt = new Date();
    req.workspace.disabledReason = String(req.body.reason || "").trim() || null;
    await req.workspace.save();

    await writeAuditLog({
      actor: req.user._id,
      action: "workspace.disable",
      targetId: req.workspaceId?.toString?.() || null,
      targetType: "Workspace",
      metadata: {
        disabledAt: req.workspace.disabledAt?.toISOString?.() || null,
        disabledReason: req.workspace.disabledReason || null
      }
    });

    return res.json({
      success: true,
      workspace: serializeWorkspace(req.workspace),
      message: DISABLED_WORKSPACE_MESSAGE
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to disable this workspace." });
  }
});

router.post("/:id/enable", ...workspaceParamContext, requirePlatformAdmin, async (req, res) => {
  try {
    req.workspace.disabled = false;
    req.workspace.disabledAt = null;
    req.workspace.disabledReason = null;
    await req.workspace.save();

    await writeAuditLog({
      actor: req.user._id,
      action: "workspace.enable",
      targetId: req.workspaceId?.toString?.() || null,
      targetType: "Workspace",
      metadata: {
        enabledAt: new Date().toISOString()
      }
    });

    return res.json({
      success: true,
      workspace: serializeWorkspace(req.workspace)
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to enable this workspace." });
  }
});

router.delete("/:id", ...workspaceParamContext, requirePlatformAdmin, async (req, res) => {
  try {
    if (req.body?.confirm !== true) {
      return res.status(400).json({ message: "Explicit confirmation is required to delete a workspace." });
    }

    const workspaceId = req.workspaceId;

    await Promise.all([
      WorkspaceMembership.deleteMany({ workspaceId }),
      InvoiceRecord.deleteMany({ workspaceId }),
      ExpenseRecord.deleteMany({ workspaceId }),
      FinanceCustomer.deleteMany({ workspaceId }),
      FinanceVendor.deleteMany({ workspaceId }),
      WarehouseProduct.deleteMany({ workspaceId }),
      WarehouseOrder.deleteMany({ workspaceId }),
      WarehouseStockMovement.deleteMany({ workspaceId }),
      PurchaseOrder.deleteMany({ workspaceId }),
      WorkspaceTask.deleteMany({ workspaceId }),
      WorkspaceProject.deleteMany({ workspaceId }),
      WorkspaceConversation.deleteMany({ workspaceId }),
      WorkspaceNotification.deleteMany({ workspaceId }),
      JournalEntry.deleteMany({ workspaceId }),
      ChartOfAccount.deleteMany({ workspaceId }),
      FinancePeriodLock.deleteMany({ workspaceId }),
      FinanceActionLog.deleteMany({ workspaceId }),
      BankAccount.deleteMany({ workspaceId }),
      BankTransaction.deleteMany({ workspaceId }),
      PayrollRecord.deleteMany({ workspaceId })
    ]);

    await Workspace.deleteOne({ _id: workspaceId });

    await writeAuditLog({
      actor: req.user._id,
      action: "workspace.delete",
      targetId: workspaceId?.toString?.() || null,
      targetType: "Workspace",
      metadata: {
        workspaceName: req.workspace?.name || null,
        workspaceSlug: req.workspace?.slug || null
      }
    });

    return res.json({
      deleted: true,
      workspaceId: workspaceId?.toString?.() || null
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to delete this workspace." });
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
    await ensureWorkspaceGroupConversation(req.workspaceId);
    await ensureWorkspaceDirectConversations(req.workspaceId, req.user._id);

    const conversations = await WorkspaceConversation.find({
      workspaceId: req.workspaceId,
      archived: false,
      status: "active",
      $or: [
        { kind: "bot" },
        { kind: "group" },
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

    if (!["direct", "group"].includes(conversation.kind)) {
      return res.status(400).json({ message: "This workspace conversation does not accept text messages." });
    }

    const isParticipant = (conversation.participantUserIds || []).some(
      (participant) => participant?._id?.toString?.() === req.user._id.toString()
    );
    if (conversation.kind === "direct" && !isParticipant) {
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
    if (conversation.kind === "direct") {
      conversation.title =
        conversation.title ||
        conversation.participantUserIds.find((participant) => participant?._id?.toString?.() !== req.user._id.toString())?.name ||
        "Workspace member";
    } else if (conversation.kind === "group") {
      conversation.title = conversation.title || "Workspace General";
    }
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
      workspaceId: req.workspaceId
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
