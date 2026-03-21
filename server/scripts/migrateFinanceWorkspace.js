import dotenv from "dotenv";

import { connectDB } from "../src/config/db.js";
import { ExpenseRecord } from "../src/models/ExpenseRecord.js";
import { FinanceActionLog } from "../src/models/FinanceActionLog.js";
import { InvoiceRecord } from "../src/models/InvoiceRecord.js";
import { User } from "../src/models/User.js";
import { Workspace } from "../src/models/Workspace.js";
import { WorkspaceMembership } from "../src/models/WorkspaceMembership.js";
import { ensureDefaultWorkspace } from "../src/utils/workspaceContext.js";

dotenv.config();

function normalizeWorkspaceMembershipRole(user) {
  const workspaceRole = typeof user.getWorkspaceRole === "function" ? user.getWorkspaceRole() : user.workspaceRole;
  if (workspaceRole === "owner" || workspaceRole === "manager") {
    return workspaceRole;
  }

  return "member";
}

function normalizeFinanceRoles(user) {
  if (typeof user.getWorkspaceRoles === "function") {
    return user.getWorkspaceRoles();
  }

  return Array.isArray(user.workspaceRoles) ? user.workspaceRoles : [];
}

function normalizeModules(user) {
  if (typeof user.getWorkspaceModules === "function") {
    return user.getWorkspaceModules();
  }

  return Array.isArray(user.workspaceModules) ? user.workspaceModules : [];
}

async function run() {
  await connectDB(process.env.MONGODB_URI);

  const defaultWorkspace = await ensureDefaultWorkspace();
  const invoiceCollection = InvoiceRecord.collection;

  try {
    const indexes = await invoiceCollection.indexes();
    const legacyInvoiceIndex = indexes.find((index) => index.unique && index.key?.invoiceNumber === 1 && !index.key?.workspaceId);
    if (legacyInvoiceIndex?.name) {
      await invoiceCollection.dropIndex(legacyInvoiceIndex.name);
    }
  } catch (error) {
    if (error?.codeName !== "IndexNotFound") {
      throw error;
    }
  }

  const [invoiceResult, expenseResult, actionResult, users] = await Promise.all([
    InvoiceRecord.updateMany(
      { workspaceId: { $exists: false } },
      { $set: { workspaceId: defaultWorkspace._id } }
    ),
    ExpenseRecord.updateMany(
      { workspaceId: { $exists: false } },
      { $set: { workspaceId: defaultWorkspace._id } }
    ),
    FinanceActionLog.updateMany(
      { workspaceId: { $exists: false } },
      { $set: { workspaceId: defaultWorkspace._id } }
    ),
    User.find({ workspaceEnabled: { $ne: false } }).select(
      "email workspaceEnabled workspaceRole workspaceRoles workspaceModules isAdmin"
    )
  ]);

  let membershipUpserts = 0;

  for (const user of users) {
    await WorkspaceMembership.findOneAndUpdate(
      {
        workspaceId: defaultWorkspace._id,
        userId: user._id
      },
      {
        $set: {
          email: user.email,
          workspaceRole: user.isAdmin ? "owner" : normalizeWorkspaceMembershipRole(user),
          financeRoles: normalizeFinanceRoles(user),
          modules: normalizeModules(user),
          status: "active"
        },
        $setOnInsert: {
          invitedBy: null
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    membershipUpserts += 1;
  }

  await InvoiceRecord.syncIndexes();

  console.log(
    JSON.stringify(
      {
        workspaceId: defaultWorkspace._id.toString(),
        workspaceSlug: defaultWorkspace.slug,
        invoicesBackfilled: invoiceResult.modifiedCount ?? 0,
        expensesBackfilled: expenseResult.modifiedCount ?? 0,
        financeActionsBackfilled: actionResult.modifiedCount ?? 0,
        membershipsUpserted: membershipUpserts
      },
      null,
      2
    )
  );

  process.exit(0);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
