import mongoose from "mongoose";

import { ChartOfAccount } from "../models/ChartOfAccount.js";
import { FinancePeriodLock } from "../models/FinancePeriodLock.js";
import { JournalEntry } from "../models/JournalEntry.js";
import { User } from "../models/User.js";
import { Workspace } from "../models/Workspace.js";
import { WorkspaceMembership } from "../models/WorkspaceMembership.js";
import { deriveTeamMemberRoleFromMembership } from "./workspaceMembershipRoles.js";

const DEFAULT_WORKSPACE_NAME = process.env.DEFAULT_WORKSPACE_NAME || "Default Workspace";
const DEFAULT_WORKSPACE_SLUG = process.env.DEFAULT_WORKSPACE_SLUG || "default-workspace";
export const DISABLED_WORKSPACE_MESSAGE = "This workspace has been disabled. Please contact your administrator.";
export const WORKSPACE_ACCESS_DENIED_MESSAGE = "You do not have access to this workspace";

function normalizeWorkspaceId(workspaceId = null) {
  if (!workspaceId || !mongoose.isValidObjectId(workspaceId)) {
    return null;
  }

  return workspaceId;
}

function canBypassWorkspaceAccess(user) {
  return Boolean(user?.isAdmin || user?.isSystemAdmin);
}

function buildWorkspaceError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function findWorkspaceMembershipForUser(
  userId,
  workspaceId,
  { module = null, includeSuspended = false } = {}
) {
  if (!userId || !workspaceId) {
    return null;
  }

  const filter = {
    workspaceId,
    userId,
    ...(includeSuspended ? {} : { status: { $ne: "suspended" } })
  };

  if (module) {
    filter.modules = module;
  }

  return WorkspaceMembership.findOne(filter);
}

async function resolveDerivedAccountingState(workspaceId = null) {
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
  if (!normalizedWorkspaceId) {
    return { enabled: false, enabledAt: null };
  }

  const [journalEntry, chartAccount, periodLock] = await Promise.all([
    JournalEntry.findOne({ workspaceId: normalizedWorkspaceId }).sort({ createdAt: 1 }).select("createdAt"),
    ChartOfAccount.findOne({ workspaceId: normalizedWorkspaceId }).sort({ createdAt: 1 }).select("createdAt"),
    FinancePeriodLock.findOne({ workspaceId: normalizedWorkspaceId }).sort({ createdAt: 1 }).select("createdAt")
  ]);

  const enabledAtCandidates = [journalEntry?.createdAt, chartAccount?.createdAt, periodLock?.createdAt]
    .filter(Boolean)
    .sort((left, right) => new Date(left).getTime() - new Date(right).getTime());

  return {
    enabled: enabledAtCandidates.length > 0,
    enabledAt: enabledAtCandidates[0] || null
  };
}

export async function hydrateWorkspaceAccountingState(workspace) {
  if (!workspace?._id) {
    return workspace;
  }

  if (workspace.$locals?.accountingStateHydrated) {
    return workspace;
  }

  let accountingEnabled = Boolean(workspace.accountingEnabled);
  let accountingEnabledAt = workspace.accountingEnabledAt || null;

  if (!accountingEnabled) {
    const derivedState = await resolveDerivedAccountingState(workspace._id);
    if (derivedState.enabled) {
      accountingEnabled = true;
      accountingEnabledAt = accountingEnabledAt || derivedState.enabledAt || null;
    }
  }

  workspace.accountingEnabled = accountingEnabled;
  workspace.accountingEnabledAt = accountingEnabledAt;
  workspace.$locals = {
    ...(workspace.$locals || {}),
    accountingStateHydrated: true
  };

  return workspace;
}

export async function hydrateWorkspaceAccountingStateForMemberships(memberships = []) {
  await Promise.all(
    memberships
      .filter((membership) => membership?.workspaceId?._id)
      .map((membership) => hydrateWorkspaceAccountingState(membership.workspaceId))
  );

  return memberships;
}

async function findDefaultWorkspaceOwnerId(preferredOwnerId = null) {
  if (preferredOwnerId && mongoose.isValidObjectId(preferredOwnerId)) {
    return preferredOwnerId;
  }

  const adminUser = await User.findOne({ isAdmin: true }).sort({ createdAt: 1 }).select("_id");
  if (adminUser?._id) {
    return adminUser._id;
  }

  const firstUser = await User.findOne({}).sort({ createdAt: 1 }).select("_id");
  return firstUser?._id || null;
}

export async function ensureDefaultWorkspace(preferredOwnerId = null) {
  let workspace = await Workspace.findOne({ slug: DEFAULT_WORKSPACE_SLUG });
  if (workspace) {
    return workspace;
  }

  const ownerUserId = await findDefaultWorkspaceOwnerId(preferredOwnerId);
  workspace = await Workspace.create({
    name: DEFAULT_WORKSPACE_NAME,
    slug: DEFAULT_WORKSPACE_SLUG,
    ownerUserId,
    defaultCurrency: "USD",
    status: "active"
  });

  return workspace;
}

export async function listWorkspaceMembershipsForUser(
  userId,
  { module = null, includeSuspended = false } = {}
) {
  if (!userId || !mongoose.isValidObjectId(userId)) {
    return [];
  }

  const filter = {
    userId,
    ...(includeSuspended ? {} : { status: { $ne: "suspended" } })
  };

  if (module) {
    filter.modules = module;
  }

  const memberships = await WorkspaceMembership.find(filter)
    .populate("workspaceId")
    .sort({ createdAt: 1 });

  await hydrateWorkspaceAccountingStateForMemberships(memberships);

  return memberships.filter(
    (membership) => membership.workspaceId && membership.workspaceId.status !== "archived"
  );
}

export async function resolveWorkspaceFromRequest(
  req,
  { allowDefault = true, membershipModule = null, allowSingleMembershipFallback = true } = {}
) {
  const requestedWorkspaceId = req.headers["x-workspace-id"];

  if (requestedWorkspaceId) {
    if (!mongoose.isValidObjectId(requestedWorkspaceId)) {
      const error = new Error("Invalid workspace id.");
      error.statusCode = 400;
      throw error;
    }

    const workspace = await Workspace.findById(requestedWorkspaceId);
    if (!workspace) {
      throw buildWorkspaceError("Workspace not found.", 404);
    }

    if (!canBypassWorkspaceAccess(req.user)) {
      const membership = await findWorkspaceMembershipForUser(req.user?._id, requestedWorkspaceId, {
        module: membershipModule
      });

      if (!membership) {
        throw buildWorkspaceError(WORKSPACE_ACCESS_DENIED_MESSAGE, 403);
      }

      if (workspace.disabled) {
        throw buildWorkspaceError(DISABLED_WORKSPACE_MESSAGE, 403);
      }
    }

    return hydrateWorkspaceAccountingState(workspace);
  }

  if (allowSingleMembershipFallback && req.user?._id) {
    const memberships = await listWorkspaceMembershipsForUser(req.user._id, {
      module: membershipModule
    });

    if (memberships.length === 1 && memberships[0].workspaceId?._id) {
      return memberships[0].workspaceId;
    }
  }

  if (!allowDefault) {
    const error = new Error("Workspace context is required.");
    error.statusCode = 400;
    throw error;
  }

  const workspace = await ensureDefaultWorkspace(req.user?._id || null);
  return hydrateWorkspaceAccountingState(workspace);
}

export function workspaceContextMiddleware(options = {}) {
  return async function attachWorkspaceContext(req, res, next) {
    try {
      const workspace = await resolveWorkspaceFromRequest(req, options);
      if (workspace?.disabled && !canBypassWorkspaceAccess(req.user)) {
        throw buildWorkspaceError(DISABLED_WORKSPACE_MESSAGE, 403);
      }
      req.workspace = workspace;
      req.workspaceId = workspace?._id || null;
      return next();
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        message: error.message || "Unable to resolve workspace context."
      });
    }
  };
}

function buildLegacyMembership(user, workspace) {
  const workspaceRole = typeof user?.getWorkspaceRole === "function" ? user.getWorkspaceRole() : user?.workspaceRole || "manager";
  const financeRoles = typeof user?.getWorkspaceRoles === "function"
    ? user.getWorkspaceRoles()
    : Array.isArray(user?.workspaceRoles)
      ? user.workspaceRoles
      : [];
  const modules = typeof user?.getWorkspaceModules === "function"
    ? user.getWorkspaceModules()
    : Array.isArray(user?.workspaceModules)
      ? user.workspaceModules
      : [];

  return {
    _id: null,
    workspaceId: workspace?._id || null,
    userId: user?._id || null,
    email: user?.email || "",
    workspaceRole: workspaceRole === "finance" || workspaceRole === "warehouse" || workspaceRole === "staff" ? "member" : workspaceRole,
    financeRoles,
    modules,
    status: "active",
    invitedBy: null,
    isLegacyFallback: true
  };
}

export async function resolveWorkspaceMembershipFromRequest(req, { allowLegacyFallback = true } = {}) {
  if (!req.workspace?._id || !req.user?._id) {
    return null;
  }

  const membership = await WorkspaceMembership.findOne({
    workspaceId: req.workspace._id,
    userId: req.user._id,
    status: { $ne: "suspended" }
  });

  if (membership) {
    return membership;
  }

  if (!allowLegacyFallback || req.workspace?.slug !== DEFAULT_WORKSPACE_SLUG) {
    return null;
  }

  return buildLegacyMembership(req.user, req.workspace);
}

export function workspaceMembershipMiddleware(options = {}) {
  return async function attachWorkspaceMembership(req, res, next) {
    try {
      const membership = await resolveWorkspaceMembershipFromRequest(req, options);
      if (!membership && !canBypassWorkspaceAccess(req.user)) {
        return res.status(403).json({
          message: WORKSPACE_ACCESS_DENIED_MESSAGE
        });
      }
      req.workspaceMembership = membership;
      return next();
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        message: error.message || "Unable to resolve workspace membership."
      });
    }
  };
}

export function serializeWorkspace(workspace) {
  if (!workspace?._id) {
    return null;
  }

  return {
    id: workspace._id.toString(),
    name: workspace.name,
    slug: workspace.slug,
    ownerUserId: workspace.ownerUserId?.toString?.() || null,
    defaultCurrency: workspace.defaultCurrency || "USD",
    accountingEnabled: isAccountingEnabledForWorkspace(workspace),
    accountingEnabledAt: workspace.accountingEnabledAt || null,
    status: workspace.status,
    disabled: Boolean(workspace.disabled),
    disabledAt: workspace.disabledAt || null,
    disabledReason: workspace.disabledReason || null
  };
}

export function isAccountingEnabledForWorkspace(workspace) {
  return Boolean(workspace?.accountingEnabled);
}

export const isWorkspaceAccountingEnabled = isAccountingEnabledForWorkspace;

export function serializeWorkspaceMembership(membership) {
  if (!membership) {
    return null;
  }

  return {
    id: membership._id?.toString?.() || null,
    workspaceId: membership.workspaceId?.toString?.() || null,
    userId: membership.userId?.toString?.() || null,
    email: membership.email || "",
    workspaceRole: membership.workspaceRole || "member",
    teamRole: deriveTeamMemberRoleFromMembership(membership),
    financeRoles: Array.isArray(membership.financeRoles) ? membership.financeRoles : [],
    modules: Array.isArray(membership.modules) ? membership.modules : [],
    status: membership.status || "active",
    isLegacyFallback: Boolean(membership.isLegacyFallback)
  };
}

export function buildWorkspaceFilter(workspace, baseFilter = {}, { includeLegacy = true } = {}) {
  if (!workspace?._id) {
    return { ...baseFilter };
  }

  const allowLegacyRecords = includeLegacy && workspace.slug === DEFAULT_WORKSPACE_SLUG;

  if (!allowLegacyRecords) {
    return { ...baseFilter, workspaceId: workspace._id };
  }

  return {
    ...baseFilter,
    $or: [{ workspaceId: workspace._id }, { workspaceId: { $exists: false } }]
  };
}
