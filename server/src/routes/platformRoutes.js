import express from "express";
import mongoose from "mongoose";

import { authMiddleware } from "../middleware/auth.js";
import { User } from "../models/User.js";
import { Workspace } from "../models/Workspace.js";
import { WorkspaceMembership } from "../models/WorkspaceMembership.js";
import { pickAvatarColor } from "../utils/avatarColor.js";
import { writeAuditLog } from "../utils/audit.js";
import { serializeUser } from "../utils/serializers.js";
import { serializeWorkspace, serializeWorkspaceMembership } from "../utils/workspaceContext.js";
import { isValidEmail, validateName, validatePassword } from "../utils/validation.js";

const router = express.Router();
const WORKSPACE_ROLES = ["owner", "manager", "member"];
const MODULE_IDS = ["finance", "warehouse"];
const FINANCE_ROLES = ["viewer", "approver", "finance_staff", "accountant"];
const MEMBERSHIP_STATUSES = ["active", "invited", "suspended"];

router.use(authMiddleware);
router.use((req, res, next) => {
  if (!req.user?.isAdmin) {
    return res.status(403).json({ message: "Platform owner access is required." });
  }

  return next();
});

function slugifyWorkspaceName(value = "") {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function generateUniqueWorkspaceSlug(name, preferredSlug = "") {
  const baseSlug = slugifyWorkspaceName(preferredSlug || name) || `workspace-${Date.now()}`;
  let candidate = baseSlug;
  let suffix = 1;

  while (await Workspace.exists({ slug: candidate })) {
    candidate = `${baseSlug}-${suffix}`.slice(0, 80);
    suffix += 1;
  }

  return candidate;
}

function normalizeModules(input) {
  if (!Array.isArray(input)) {
    return [];
  }

  return [...new Set(input.map((entry) => String(entry).trim()))];
}

function normalizeFinanceRoles(input) {
  if (!Array.isArray(input)) {
    return [];
  }

  return [...new Set(input.map((entry) => String(entry).trim()))];
}

function serializePlatformMember(user, membership) {
  return {
    user: serializeUser(user),
    membership: serializeWorkspaceMembership(membership)
  };
}

async function syncWorkspaceOwner(workspaceId, preferredOwnerUserId = null) {
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

async function buildWorkspaceSummary(workspace) {
  const memberships = await WorkspaceMembership.find({
    workspaceId: workspace._id
  }).populate("userId", "name email isAdmin");

  const activeMemberships = memberships.filter((membership) => membership.status !== "suspended");
  const ownerMembership =
    activeMemberships.find((membership) => membership.workspaceRole === "owner") || null;
  const modules = [...new Set(activeMemberships.flatMap((membership) => membership.modules || []))];

  return {
    workspace: serializeWorkspace(workspace),
    owner: ownerMembership?.userId ? serializeUser(ownerMembership.userId) : null,
    memberCount: activeMemberships.length,
    suspendedMemberCount: memberships.length - activeMemberships.length,
    modules
  };
}

router.get("/workspaces", async (_req, res) => {
  try {
    const workspaces = await Workspace.find({}).sort({ createdAt: -1 });
    const summaries = await Promise.all(workspaces.map(buildWorkspaceSummary));

    return res.json({ workspaces: summaries });
  } catch (error) {
    return res.status(500).json({ message: "Unable to load platform workspaces." });
  }
});

router.post("/workspaces", async (req, res) => {
  try {
    const name = req.body.name?.trim() || "";
    const requestedSlug = req.body.slug?.trim() || "";

    if (!name) {
      return res.status(400).json({ message: "Workspace name is required." });
    }

    const slug = await generateUniqueWorkspaceSlug(name, requestedSlug);
    const workspace = await Workspace.create({
      name,
      slug,
      ownerUserId: null,
      status: "active"
    });

    await writeAuditLog({
      actor: req.user._id,
      action: "platform.workspace.create",
      targetId: workspace._id.toString(),
      targetType: "Workspace",
      metadata: {
        name: workspace.name,
        slug: workspace.slug
      }
    });

    return res.status(201).json({
      workspace: serializeWorkspace(workspace)
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to create workspace." });
  }
});

router.get("/workspaces/:workspaceId", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.workspaceId)) {
      return res.status(400).json({ message: "Invalid workspace id." });
    }

    const workspace = await Workspace.findById(req.params.workspaceId);
    if (!workspace) {
      return res.status(404).json({ message: "Workspace not found." });
    }

    const summary = await buildWorkspaceSummary(workspace);
    return res.json(summary);
  } catch (error) {
    return res.status(500).json({ message: "Unable to load workspace details." });
  }
});

router.get("/workspaces/:workspaceId/members", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.workspaceId)) {
      return res.status(400).json({ message: "Invalid workspace id." });
    }

    const workspace = await Workspace.findById(req.params.workspaceId);
    if (!workspace) {
      return res.status(404).json({ message: "Workspace not found." });
    }

    const memberships = await WorkspaceMembership.find({
      workspaceId: workspace._id
    })
      .sort({ createdAt: 1 })
      .populate("userId");

    return res.json({
      workspace: serializeWorkspace(workspace),
      members: memberships
        .filter((membership) => membership.userId)
        .map((membership) => serializePlatformMember(membership.userId, membership))
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to load workspace members." });
  }
});

router.post("/workspaces/:workspaceId/members", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.workspaceId)) {
      return res.status(400).json({ message: "Invalid workspace id." });
    }

    const workspace = await Workspace.findById(req.params.workspaceId);
    if (!workspace) {
      return res.status(404).json({ message: "Workspace not found." });
    }

    const email = req.body.email?.trim().toLowerCase() || "";
    const name = req.body.name?.trim() || "";
    const password = req.body.password?.trim() || "";
    const workspaceRole = String(req.body.workspaceRole || "member").trim();
    const modules = normalizeModules(req.body.modules);
    const financeRoles = normalizeFinanceRoles(req.body.financeRoles);
    const status = String(req.body.status || "active").trim();

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: "A valid customer email is required." });
    }

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

    if (!MEMBERSHIP_STATUSES.includes(status)) {
      return res.status(400).json({ message: `Invalid membership status: ${status}` });
    }

    let user = await User.findOne({ email }).select("+password");
    const nameToUse = name || email.split("@")[0];

    if (!user) {
      const nameError = validateName(nameToUse);
      if (nameError) {
        return res.status(400).json({ message: nameError });
      }

      const passwordError = validatePassword(password);
      if (passwordError) {
        return res.status(400).json({ message: passwordError });
      }

      user = await User.create({
        name: nameToUse,
        email,
        password,
        avatarColor: pickAvatarColor(email)
      });
    } else {
      if (name && name !== user.name) {
        const nameError = validateName(name);
        if (nameError) {
          return res.status(400).json({ message: nameError });
        }
        user.name = name;
      }

      if (password) {
        const passwordError = validatePassword(password);
        if (passwordError) {
          return res.status(400).json({ message: passwordError });
        }
        user.password = password;
      }

      if (user.isModified("name") || user.isModified("password")) {
        await user.save();
      }
    }

    const membership = await WorkspaceMembership.findOneAndUpdate(
      {
        workspaceId: workspace._id,
        userId: user._id
      },
      {
        $set: {
          email: user.email,
          workspaceRole,
          modules,
          financeRoles: modules.includes("finance") ? financeRoles : [],
          status,
          invitedBy: req.user._id
        }
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true
      }
    );

    if (workspaceRole === "owner" && status !== "suspended") {
      await syncWorkspaceOwner(workspace._id, user._id);
    } else if (workspace.ownerUserId?.toString?.() === user._id.toString()) {
      await syncWorkspaceOwner(workspace._id);
    }

    await writeAuditLog({
      actor: req.user._id,
      action: "platform.workspace.member.provision",
      targetId: user._id.toString(),
      targetType: "WorkspaceMembership",
      metadata: {
        workspaceId: workspace._id.toString(),
        email: user.email,
        workspaceRole,
        modules,
        financeRoles,
        status
      }
    });

    return res.status(201).json({
      member: serializePlatformMember(user, membership)
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to provision the customer account." });
  }
});

router.patch("/workspaces/:workspaceId/members/:userId", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.workspaceId)) {
      return res.status(400).json({ message: "Invalid workspace id." });
    }

    if (!mongoose.isValidObjectId(req.params.userId)) {
      return res.status(400).json({ message: "Invalid user id." });
    }

    const [workspace, user] = await Promise.all([
      Workspace.findById(req.params.workspaceId),
      User.findById(req.params.userId).select("+password")
    ]);

    if (!workspace) {
      return res.status(404).json({ message: "Workspace not found." });
    }

    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    const membership = await WorkspaceMembership.findOne({
      workspaceId: workspace._id,
      userId: user._id
    });

    if (!membership) {
      return res.status(404).json({ message: "Workspace membership not found." });
    }

    const email = req.body.email?.trim().toLowerCase();
    const name = req.body.name?.trim();
    const password = req.body.password?.trim();
    const workspaceRole = req.body.workspaceRole === undefined ? undefined : String(req.body.workspaceRole || "").trim();
    const modules = req.body.modules === undefined ? undefined : normalizeModules(req.body.modules);
    const financeRoles = req.body.financeRoles === undefined ? undefined : normalizeFinanceRoles(req.body.financeRoles);
    const status = req.body.status === undefined ? undefined : String(req.body.status || "").trim();

    if (email !== undefined) {
      if (!isValidEmail(email)) {
        return res.status(400).json({ message: "A valid customer email is required." });
      }

      const duplicateUser = await User.findOne({
        email,
        _id: { $ne: user._id }
      }).select("_id");

      if (duplicateUser) {
        return res.status(409).json({ message: "Another user already uses that email." });
      }

      user.email = email;
      membership.email = email;
    }

    if (name !== undefined) {
      const nameError = validateName(name);
      if (nameError) {
        return res.status(400).json({ message: nameError });
      }
      user.name = name;
    }

    if (password) {
      const passwordError = validatePassword(password);
      if (passwordError) {
        return res.status(400).json({ message: passwordError });
      }
      user.password = password;
    }

    if (workspaceRole !== undefined) {
      if (!WORKSPACE_ROLES.includes(workspaceRole)) {
        return res.status(400).json({ message: `Invalid workspace role: ${workspaceRole}` });
      }
      membership.workspaceRole = workspaceRole;
    }

    if (modules !== undefined) {
      const invalidModule = modules.find((moduleId) => !MODULE_IDS.includes(moduleId));
      if (invalidModule) {
        return res.status(400).json({ message: `Invalid module: ${invalidModule}` });
      }
      membership.modules = modules;
      if (!modules.includes("finance")) {
        membership.financeRoles = [];
      }
    }

    if (financeRoles !== undefined) {
      const invalidFinanceRole = financeRoles.find((role) => !FINANCE_ROLES.includes(role));
      if (invalidFinanceRole) {
        return res.status(400).json({ message: `Invalid finance role: ${invalidFinanceRole}` });
      }

      const effectiveModules = modules !== undefined ? modules : membership.modules || [];
      if (financeRoles.length && !effectiveModules.includes("finance")) {
        return res.status(400).json({ message: "Finance roles can only be assigned when finance access is enabled." });
      }

      membership.financeRoles = financeRoles;
    }

    if (status !== undefined) {
      if (!MEMBERSHIP_STATUSES.includes(status)) {
        return res.status(400).json({ message: `Invalid membership status: ${status}` });
      }
      membership.status = status;
    }

    await user.save();
    await membership.save();

    if (membership.workspaceRole === "owner" && membership.status !== "suspended") {
      await syncWorkspaceOwner(workspace._id, user._id);
    } else if (workspace.ownerUserId?.toString?.() === user._id.toString()) {
      await syncWorkspaceOwner(workspace._id);
    }

    await writeAuditLog({
      actor: req.user._id,
      action: "platform.workspace.member.update",
      targetId: user._id.toString(),
      targetType: "WorkspaceMembership",
      metadata: {
        workspaceId: workspace._id.toString(),
        email: membership.email,
        workspaceRole: membership.workspaceRole,
        modules: membership.modules,
        financeRoles: membership.financeRoles,
        status: membership.status
      }
    });

    return res.json({
      member: serializePlatformMember(user, membership)
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to update customer access." });
  }
});

router.patch("/workspaces/:workspaceId/members/:userId/status", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.workspaceId)) {
      return res.status(400).json({ message: "Invalid workspace id." });
    }

    if (!mongoose.isValidObjectId(req.params.userId)) {
      return res.status(400).json({ message: "Invalid user id." });
    }

    const nextStatus = String(req.body.status || "").trim();
    if (!["active", "suspended"].includes(nextStatus)) {
      return res.status(400).json({ message: "Status must be active or suspended." });
    }

    const membership = await WorkspaceMembership.findOne({
      workspaceId: req.params.workspaceId,
      userId: req.params.userId
    }).populate("userId");

    if (!membership || !membership.userId) {
      return res.status(404).json({ message: "Workspace membership not found." });
    }

    membership.status = nextStatus;
    await membership.save();
    await syncWorkspaceOwner(req.params.workspaceId);

    await writeAuditLog({
      actor: req.user._id,
      action: "platform.workspace.member.status",
      targetId: req.params.userId,
      targetType: "WorkspaceMembership",
      metadata: {
        workspaceId: req.params.workspaceId,
        status: nextStatus
      }
    });

    return res.json({
      member: serializePlatformMember(membership.userId, membership)
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to update membership status." });
  }
});

export default router;
