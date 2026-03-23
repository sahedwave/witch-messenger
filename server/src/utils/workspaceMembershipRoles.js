export const TEAM_MEMBER_ROLES = [
  "member",
  "viewer",
  "approver",
  "finance_staff",
  "warehouse_staff",
  "accountant",
  "manager",
  "owner"
];

export function isSupportedTeamMemberRole(role) {
  return TEAM_MEMBER_ROLES.includes(String(role || "").trim());
}

export function resolveMembershipAccessFromTeamRole(role) {
  const normalizedRole = String(role || "").trim();

  switch (normalizedRole) {
    case "member":
      return {
        workspaceRole: "member",
        modules: [],
        financeRoles: []
      };
    case "owner":
      return {
        workspaceRole: "owner",
        modules: ["finance", "warehouse"],
        financeRoles: ["viewer", "approver", "finance_staff", "accountant"]
      };
    case "manager":
      return {
        workspaceRole: "manager",
        modules: ["finance", "warehouse"],
        financeRoles: ["viewer", "approver", "finance_staff"]
      };
    case "accountant":
      return {
        workspaceRole: "member",
        modules: ["finance"],
        financeRoles: ["accountant"]
      };
    case "finance_staff":
      return {
        workspaceRole: "member",
        modules: ["finance"],
        financeRoles: ["finance_staff"]
      };
    case "approver":
      return {
        workspaceRole: "member",
        modules: ["finance"],
        financeRoles: ["approver"]
      };
    case "viewer":
      return {
        workspaceRole: "member",
        modules: ["finance"],
        financeRoles: ["viewer"]
      };
    case "warehouse_staff":
      return {
        workspaceRole: "member",
        modules: ["warehouse"],
        financeRoles: []
      };
    default:
      return null;
  }
}

export function deriveTeamMemberRoleFromMembership(membership) {
  const workspaceRole = String(membership?.workspaceRole || "").trim();
  const financeRoles = Array.isArray(membership?.financeRoles) ? membership.financeRoles : [];
  const modules = Array.isArray(membership?.modules) ? membership.modules : [];

  if (workspaceRole === "owner" || workspaceRole === "manager") {
    return workspaceRole;
  }

  if (financeRoles.includes("accountant")) {
    return "accountant";
  }

  if (financeRoles.includes("finance_staff")) {
    return "finance_staff";
  }

  if (financeRoles.includes("approver")) {
    return "approver";
  }

  if (financeRoles.includes("viewer")) {
    return "viewer";
  }

  if (modules.includes("warehouse")) {
    return "warehouse_staff";
  }

  return "member";
}
