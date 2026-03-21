import { useEffect, useMemo, useState } from "react";

import { FINANCE_CURRENCY_OPTIONS } from "../WorkspaceMessenger.constants.js";
import { formatDateTime, resolveWorkspaceDefaultCurrency } from "../WorkspaceMessenger.utils.js";

export function WorkspaceMemberAccessPanel({
  members = [],
  loading = false,
  canManage = false,
  canBootstrapManage = false,
  workspaceScope = "both",
  currentUserId = null,
  savingMemberId = null,
  onToggleRole,
  onUpdateWorkspaceAccess,
  onRefresh
}) {
  const visibleMembers = members;
  const workspaceRoleOptions = [
    { id: "owner", label: "Workspace Owner" },
    { id: "manager", label: "Workspace Manager" },
    { id: "member", label: "Workspace Member" }
  ];
  const moduleOptions = [
    { id: "finance", label: "Finance" },
    { id: "warehouse", label: "Warehouse" }
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400">
            {canBootstrapManage ? "Workspace bootstrap" : "Workspace access"}
          </div>
          <h3
            style={{
              marginTop: 8,
              fontFamily: '"Sora","Manrope","DM Sans","Segoe UI",sans-serif',
              fontSize: 24,
              lineHeight: 1.15,
              fontWeight: 700,
              color: "#f8fafc"
            }}
          >
            Workspace team access
          </h3>
          <p className="mt-2 max-w-2xl text-sm text-slate-400">
            {canBootstrapManage
              ? "As the app owner, you can grant workspace access, choose the first workspace owner or manager, assign module access, and then fine-tune finance roles for each customer account."
              : "Manage workspace members, assign module access, and keep finance-specific permissions limited to members who need them."}
          </p>
        </div>
        {canManage ? (
          <button
            type="button"
            onClick={onRefresh}
            className="rounded-[14px] border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200"
          >
            Refresh members
          </button>
        ) : null}
      </div>

      {!canManage ? (
        <div
          className="rounded-[24px] p-6 text-sm text-slate-400"
          style={{ border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)" }}
        >
          Your current workspace role can use this workspace, but only workspace managers or admins can manage member access.
        </div>
      ) : loading ? (
        <div
          className="rounded-[24px] p-6 text-sm text-slate-400"
          style={{ border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)" }}
        >
          Loading workspace members...
        </div>
      ) : visibleMembers.length ? (
        <div className="grid gap-4">
          {visibleMembers.map((member) => {
            const roles = Array.isArray(member.workspaceRoles) ? member.workspaceRoles : [];
            const modules = Array.isArray(member.workspaceModules) ? member.workspaceModules : [];
            const showFinanceRoleSection =
              workspaceScope !== "warehouse" && (canBootstrapManage || modules.includes("finance") || roles.length > 0);
            const roleOptions = [
              { id: "viewer", label: "Viewer" },
              { id: "approver", label: "Approver" },
              { id: "finance_staff", label: "Finance Staff" },
              { id: "accountant", label: "Accountant" }
            ];

            return (
              <div
                key={member.id}
                className="rounded-[24px] p-5"
                style={{
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "linear-gradient(180deg,#111827 0%,#10192a 100%)",
                  boxShadow: "0 12px 32px rgba(0,0,0,0.28)"
                }}
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-base font-semibold text-white">
                      {member.name}
                      {member.id === currentUserId ? " (You)" : ""}
                    </div>
                    <div className="mt-1 text-sm text-slate-400">{member.email}</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span
                        className="rounded-full border px-3 py-1 text-xs font-semibold"
                        style={{
                          borderColor: "rgba(255,255,255,0.08)",
                          background: member.workspaceEnabled ? "rgba(16,185,129,0.14)" : "rgba(255,255,255,0.05)",
                          color: member.workspaceEnabled ? "#10b981" : "#94a3b8"
                        }}
                      >
                        {member.workspaceEnabled ? "Workspace enabled" : "Workspace disabled"}
                      </span>
                      <span
                        className="rounded-full border px-3 py-1 text-xs font-semibold"
                        style={{
                          borderColor: "rgba(255,255,255,0.08)",
                          background: "rgba(255,255,255,0.05)",
                          color: "#f8fafc"
                        }}
                      >
                        {member.workspaceRole || "member"}
                      </span>
                      {(modules.length ? modules : ["no modules"]).map((moduleId) => (
                        <span
                          key={`${member.id}-module-${moduleId}`}
                          className="rounded-full border px-3 py-1 text-xs font-semibold"
                          style={{
                            borderColor: "rgba(255,255,255,0.08)",
                            background: "rgba(255,255,255,0.05)",
                            color: "#cbd5e1"
                          }}
                        >
                          {moduleId}
                        </span>
                      ))}
                    </div>
                    {showFinanceRoleSection ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {(roles.length ? roles : ["no finance role"]).map((role) => (
                          <span
                            key={`${member.id}-${role}`}
                            className="rounded-full border px-3 py-1 text-xs font-semibold"
                            style={{
                              borderColor: "rgba(255,255,255,0.08)",
                              background: "rgba(255,255,255,0.05)",
                              color: role === "no finance role" ? "#94a3b8" : "#f8fafc"
                            }}
                          >
                            {role.replace("_", " ")}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="text-right text-xs text-slate-500">
                    <div>{member.isAdmin ? "Admin" : member.workspaceRole || "member"}</div>
                    <div className="mt-1">{member.presenceStatus || "offline"}</div>
                  </div>
                </div>

                {canBootstrapManage ? (
                  <div
                    className="mt-4 space-y-3 rounded-[18px] p-4"
                    style={{
                      border: "1px solid rgba(255,255,255,0.06)",
                      background: "rgba(255,255,255,0.03)"
                    }}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                        Workspace access
                      </div>
                      <button
                        type="button"
                        disabled={savingMemberId === member.id}
                        onClick={() =>
                          onUpdateWorkspaceAccess?.(member, {
                            workspaceEnabled: !member.workspaceEnabled
                          })
                        }
                        className="rounded-full border px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
                        style={{
                          borderColor: member.workspaceEnabled ? "rgba(239,68,68,0.28)" : "rgba(16,185,129,0.36)",
                          background: member.workspaceEnabled ? "rgba(239,68,68,0.1)" : "rgba(16,185,129,0.14)",
                          color: member.workspaceEnabled ? "#f87171" : "#10b981"
                        }}
                      >
                        {member.workspaceEnabled ? "Disable workspace" : "Enable workspace"}
                      </button>
                    </div>

                    <div>
                      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                        Workspace role
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {workspaceRoleOptions.map((option) => {
                          const active = (member.workspaceRole || "") === option.id;
                          return (
                            <button
                              key={`${member.id}-workspace-role-${option.id}`}
                              type="button"
                              disabled={savingMemberId === member.id}
                              onClick={() => onUpdateWorkspaceAccess?.(member, { workspaceRole: option.id, workspaceEnabled: true })}
                              className="rounded-full border px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
                              style={{
                                borderColor: active ? "rgba(96,165,250,0.36)" : "rgba(255,255,255,0.1)",
                                background: active ? "rgba(96,165,250,0.14)" : "rgba(255,255,255,0.05)",
                                color: active ? "#60a5fa" : "#cbd5e1"
                              }}
                            >
                              {option.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                        Workspace modules
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {moduleOptions.map((option) => {
                          const active = modules.includes(option.id);
                          const nextModules = active ? modules.filter((entry) => entry !== option.id) : [...modules, option.id];
                          return (
                            <button
                              key={`${member.id}-workspace-module-${option.id}`}
                              type="button"
                              disabled={savingMemberId === member.id}
                              onClick={() =>
                                onUpdateWorkspaceAccess?.(member, {
                                  workspaceModules: nextModules,
                                  workspaceEnabled: true
                                })
                              }
                              className="rounded-full border px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
                              style={{
                                borderColor: active ? "rgba(16,185,129,0.36)" : "rgba(255,255,255,0.1)",
                                background: active ? "rgba(16,185,129,0.14)" : "rgba(255,255,255,0.05)",
                                color: active ? "#10b981" : "#cbd5e1"
                              }}
                            >
                              {option.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ) : null}

                {showFinanceRoleSection ? (
                  <div
                    className="mt-4 space-y-3 rounded-[18px] p-4"
                    style={{
                      border: "1px solid rgba(255,255,255,0.06)",
                      background: "rgba(255,255,255,0.03)"
                    }}
                  >
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                      Finance roles
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {roleOptions.map((option) => {
                        const active = roles.includes(option.id);
                        return (
                          <button
                            key={`${member.id}-${option.id}`}
                            type="button"
                            disabled={!canManage || savingMemberId === member.id}
                            onClick={() => onToggleRole?.(member, option.id)}
                            className="rounded-full border px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
                            style={{
                              borderColor: active ? "rgba(16,185,129,0.36)" : "rgba(255,255,255,0.1)",
                              background: active ? "rgba(16,185,129,0.14)" : "rgba(255,255,255,0.05)",
                              color: active ? "#10b981" : "#cbd5e1"
                            }}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div
          className="rounded-[24px] p-6 text-sm text-slate-400"
          style={{ border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)" }}
        >
          No workspace members are assigned yet.
        </div>
      )}
    </div>
  );
}

export function WorkspaceAdminOverviewPanel({
  workspace = null,
  membership = null,
  settings = null,
  accountingEnabled = false,
  accountingEnabledAt = null,
  loading = false,
  onRefresh = null,
  onEnableAccounting = null,
  enablingAccounting = false,
  onUpdateDefaultCurrency = null,
  savingDefaultCurrency = false,
  onInviteAccountant = null,
  invitingAccountant = false,
  members = []
}) {
  const summary = settings?.summary || {};
  const managers = Array.isArray(summary.managers) ? summary.managers : [];
  const moduleChips = Array.isArray(membership?.modules) ? membership.modules : [];
  const workspaceModules = Array.isArray(summary.workspaceModules) ? summary.workspaceModules : [];
  const roleLabel = membership?.workspaceRole || "member";
  const canEnableAccounting = Boolean(onEnableAccounting) && (membership?.workspaceRole === "owner" || membership?.workspaceRole === "manager" || membership?.isAdmin);
  const canUpdateDefaultCurrency = Boolean(onUpdateDefaultCurrency) && (membership?.workspaceRole === "owner" || membership?.workspaceRole === "manager" || membership?.isAdmin);
  const canInviteAccountant = Boolean(onInviteAccountant) && (membership?.workspaceRole === "owner" || membership?.workspaceRole === "manager" || membership?.isAdmin);
  const [defaultCurrencyDraft, setDefaultCurrencyDraft] = useState(resolveWorkspaceDefaultCurrency(workspace, settings));
  const [accountantInvite, setAccountantInvite] = useState({ email: "", name: "" });
  const accountantMembers = useMemo(
    () => (Array.isArray(members) ? members.filter((member) => Array.isArray(member.workspaceRoles) && member.workspaceRoles.includes("accountant")) : []),
    [members]
  );

  useEffect(() => {
    setDefaultCurrencyDraft(resolveWorkspaceDefaultCurrency(workspace, settings));
  }, [settings, workspace]);

  return (
    <div
      className="rounded-[24px] p-6"
      style={{
        border: "1px solid rgba(255,255,255,0.08)",
        background: "linear-gradient(180deg,#0f172a 0%,#10192a 100%)",
        boxShadow: "0 12px 32px rgba(0,0,0,0.28)"
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-300">
            Workspace settings
          </div>
          <h3
            style={{
              marginTop: 8,
              fontFamily: '"Sora","Manrope","DM Sans","Segoe UI",sans-serif',
              fontSize: 24,
              lineHeight: 1.15,
              fontWeight: 700,
              color: "#f8fafc"
            }}
          >
            {workspace?.name || "Workspace"}
          </h3>
          <p className="mt-2 max-w-2xl text-sm text-slate-400">
            Keep workspace ownership, module access, and member responsibilities visible from one place without mixing them into daily finance or warehouse actions.
          </p>
        </div>
        {onRefresh ? (
          <button
            type="button"
            onClick={onRefresh}
            className="rounded-[14px] border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200"
          >
            Refresh settings
          </button>
        ) : null}
      </div>

      {loading ? (
        <div
          className="mt-5 rounded-[18px] p-4 text-sm text-slate-400"
          style={{ border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.03)" }}
        >
          Loading workspace summary...
        </div>
      ) : (
        <>
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <div className="rounded-[18px] border border-white/10 bg-white/5 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Your role</div>
              <div className="mt-2 text-lg font-semibold text-white">{roleLabel}</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {(moduleChips.length ? moduleChips : ["no modules"]).map((moduleId) => (
                  <span
                    key={`membership-module-${moduleId}`}
                    className="rounded-full border px-3 py-1 text-xs font-semibold"
                    style={{
                      borderColor: "rgba(255,255,255,0.08)",
                      background: "rgba(255,255,255,0.05)",
                      color: moduleId === "no modules" ? "#94a3b8" : "#cbd5e1"
                    }}
                  >
                    {moduleId}
                  </span>
                ))}
              </div>
            </div>

            <div className="rounded-[18px] border border-white/10 bg-white/5 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Ownership</div>
              <div className="mt-2 text-lg font-semibold text-white">{summary.owner?.name || "Unassigned"}</div>
              <div className="mt-1 text-sm text-slate-400">{summary.owner?.email || "No owner assigned yet"}</div>
            </div>

            <div className="rounded-[18px] border border-white/10 bg-white/5 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Default currency</div>
              <div className="mt-2 text-lg font-semibold text-white">{resolveWorkspaceDefaultCurrency(workspace, settings)}</div>
              {canUpdateDefaultCurrency ? (
                <div className="mt-3 space-y-2">
                  <select
                    value={defaultCurrencyDraft}
                    onChange={(event) => setDefaultCurrencyDraft(event.target.value)}
                    className="w-full rounded-[14px] border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none"
                  >
                    {FINANCE_CURRENCY_OPTIONS.map((currency) => (
                      <option key={`workspace-default-currency-${currency}`} value={currency}>
                        {currency}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => onUpdateDefaultCurrency?.(defaultCurrencyDraft)}
                    disabled={savingDefaultCurrency || defaultCurrencyDraft === resolveWorkspaceDefaultCurrency(workspace, settings)}
                    className="rounded-[12px] border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {savingDefaultCurrency ? "Saving..." : "Save default currency"}
                  </button>
                </div>
              ) : (
                <div className="mt-2 text-xs text-slate-500">Used as the default when new finance and purchasing records are created.</div>
              )}
            </div>

            <div className="rounded-[18px] border border-white/10 bg-white/5 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Managers</div>
              <div className="mt-2 text-lg font-semibold text-white">{managers.length}</div>
              <div className="mt-3 space-y-1 text-sm text-slate-400">
                {managers.length ? managers.slice(0, 3).map((manager) => <div key={manager.id}>{manager.name}</div>) : <div>No managers assigned</div>}
              </div>
            </div>

            <div className="rounded-[18px] border border-white/10 bg-white/5 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Members</div>
              <div className="mt-2 text-lg font-semibold text-white">{summary.activeMembers || 0}</div>
              <div className="mt-1 text-sm text-slate-400">
                {summary.suspendedMembers || 0} suspended
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {(workspaceModules.length ? workspaceModules : ["no modules"]).map((moduleId) => (
                  <span
                    key={`workspace-module-${moduleId}`}
                    className="rounded-full border px-3 py-1 text-xs font-semibold"
                    style={{
                      borderColor: "rgba(255,255,255,0.08)",
                      background: "rgba(255,255,255,0.05)",
                      color: moduleId === "no modules" ? "#94a3b8" : "#cbd5e1"
                    }}
                  >
                    {moduleId}
                  </span>
                ))}
              </div>
            </div>

            <div className="rounded-[18px] border border-white/10 bg-white/5 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Accounting module</div>
              <div className="mt-2 text-lg font-semibold text-white">{accountingEnabled ? "Enabled" : "Not enabled"}</div>
              <div className="mt-1 text-sm text-slate-400">
                {accountingEnabledAt
                  ? `Active since ${formatDateTime(accountingEnabledAt)}`
                  : "Finance workflow is currently running without optional accounting entitlement."}
              </div>
              {accountingEnabledAt ? (
                <div className="mt-3 rounded-[14px] border border-emerald-400/18 bg-emerald-500/8 px-3 py-3 text-xs leading-5 text-emerald-100">
                  Accounting coverage begins from this activation point forward. Earlier Finance workflow records remain operational history until an explicit backfill path exists.
                </div>
              ) : null}
              {!accountingEnabled && canEnableAccounting ? (
                <button
                  type="button"
                  onClick={onEnableAccounting}
                  disabled={enablingAccounting}
                  className="mt-3 rounded-[14px] border border-emerald-400/30 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-200 transition disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {enablingAccounting ? "Enabling..." : "Enable accounting"}
                </button>
              ) : null}
            </div>
          </div>

          {summary.usesLegacyFallback ? (
            <div
              className="mt-4 rounded-[18px] p-4"
              style={{
                border: "1px solid rgba(245,158,11,0.28)",
                background: "rgba(245,158,11,0.08)"
              }}
            >
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-300">Compatibility mode</div>
              <div className="mt-2 text-sm leading-6 text-amber-100">
                This workspace is still using legacy membership fallback for the current session. Explicit membership is preferred and will give you stricter tenant isolation.
              </div>
            </div>
          ) : null}

          {canInviteAccountant ? (
            <div className="mt-4 rounded-[18px] border border-white/10 bg-white/5 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Invite accountant</div>
              <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                <input
                  value={accountantInvite.name}
                  onChange={(event) => setAccountantInvite((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Accountant name"
                  className="rounded-[14px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none"
                />
                <input
                  type="email"
                  value={accountantInvite.email}
                  onChange={(event) => setAccountantInvite((current) => ({ ...current, email: event.target.value }))}
                  placeholder="accountant@firm.com"
                  className="rounded-[14px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none"
                />
                <button
                  type="button"
                  disabled={invitingAccountant}
                  onClick={async () => {
                    const invited = await onInviteAccountant?.(accountantInvite);
                    if (invited?.membershipId || invited?.id) {
                      setAccountantInvite({ email: "", name: "" });
                    }
                  }}
                  className="rounded-[14px] border border-sky-400/25 bg-sky-500/15 px-4 py-3 text-sm font-semibold text-sky-200 disabled:opacity-60"
                >
                  {invitingAccountant ? "Inviting..." : "Send invite"}
                </button>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {accountantMembers.length ? accountantMembers.map((member) => (
                  <span
                    key={`accountant-${member.id}`}
                    className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-200"
                  >
                    {member.name} · accountant
                  </span>
                )) : (
                  <span className="text-sm text-slate-400">No accountant members yet.</span>
                )}
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

export function PlatformOwnerProvisioningPanel({
  currentUser = null,
  workspaces = [],
  loading = false,
  selectedWorkspaceId = null,
  onSelectWorkspace = null,
  onRefresh = null,
  onCreateWorkspace = null,
  creatingWorkspace = false,
  onProvisionMember = null,
  provisioningMember = false
}) {
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceSlug, setWorkspaceSlug] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPassword, setCustomerPassword] = useState("");
  const [workspaceRole, setWorkspaceRole] = useState("owner");
  const [modules, setModules] = useState(["finance", "warehouse"]);
  const [financeRoles, setFinanceRoles] = useState(["approver", "finance_staff"]);

  const selectedWorkspace = useMemo(
    () => workspaces.find((entry) => entry.workspace?.id === selectedWorkspaceId) || null,
    [selectedWorkspaceId, workspaces]
  );

  function toggleModule(moduleId) {
    setModules((current) => {
      const nextModules = current.includes(moduleId)
        ? current.filter((entry) => entry !== moduleId)
        : [...current, moduleId];

      if (!nextModules.includes("finance")) {
        setFinanceRoles([]);
      }

      return nextModules;
    });
  }

  function toggleFinanceRole(roleId) {
    setFinanceRoles((current) =>
      current.includes(roleId)
        ? current.filter((entry) => entry !== roleId)
        : [...current, roleId]
    );
  }

  async function handleCreateWorkspace(event) {
    event.preventDefault();
    const createdWorkspace = await onCreateWorkspace?.({
      name: workspaceName,
      slug: workspaceSlug
    });

    if (createdWorkspace?.id) {
      setWorkspaceName("");
      setWorkspaceSlug("");
      onSelectWorkspace?.(createdWorkspace.id);
    }
  }

  async function handleProvisionMember(event) {
    event.preventDefault();
    if (!selectedWorkspaceId) {
      return;
    }

    const nextMember = await onProvisionMember?.(selectedWorkspaceId, {
      name: customerName,
      email: customerEmail,
      password: customerPassword,
      workspaceRole,
      modules,
      financeRoles: modules.includes("finance") ? financeRoles : []
    });

    if (nextMember) {
      setCustomerName("");
      setCustomerEmail("");
      setCustomerPassword("");
      setWorkspaceRole("owner");
      setModules(["finance", "warehouse"]);
      setFinanceRoles(["approver", "finance_staff"]);
    }
  }

  return (
    <div
      className="rounded-[24px] p-6"
      style={{
        border: "1px solid rgba(255,255,255,0.08)",
        background: "linear-gradient(180deg,#07111f 0%,#0b1728 100%)",
        boxShadow: "0 12px 32px rgba(0,0,0,0.28)"
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300">Platform owner</div>
          <h3
            style={{
              marginTop: 8,
              fontFamily: '"Sora","Manrope","DM Sans","Segoe UI",sans-serif',
              fontSize: 24,
              lineHeight: 1.15,
              fontWeight: 700,
              color: "#f8fafc"
            }}
          >
            Customer provisioning
          </h3>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">
            Only your platform-owner account can see this area. Create customer workspaces, assign the first customer account, and choose whether each workspace gets finance, warehouse, or both.
          </p>
        </div>
        <div className="rounded-[18px] border border-white/10 bg-white/5 px-4 py-3 text-right">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Signed in as</div>
          <div className="mt-1 text-sm font-semibold text-white">{currentUser?.name || "Platform owner"}</div>
          <div className="text-xs text-slate-400">{currentUser?.email || ""}</div>
        </div>
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-5">
          <div className="rounded-[20px] border border-white/10 bg-white/[0.04] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Workspaces</div>
                <div className="mt-1 text-sm text-slate-300">
                  Pick a workspace to view its customer members and edit access.
                </div>
              </div>
              {onRefresh ? (
                <button
                  type="button"
                  onClick={onRefresh}
                  className="rounded-[14px] border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200"
                >
                  Refresh list
                </button>
              ) : null}
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {loading ? (
                <div className="rounded-[16px] border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400">
                  Loading customer workspaces...
                </div>
              ) : workspaces.length ? (
                workspaces.map((entry) => {
                  const isSelected = entry.workspace?.id === selectedWorkspaceId;
                  const modules = Array.isArray(entry.modules) ? entry.modules : [];

                  return (
                    <button
                      key={entry.workspace?.id}
                      type="button"
                      onClick={() => onSelectWorkspace?.(entry.workspace?.id)}
                      className="rounded-[18px] p-4 text-left transition"
                      style={{
                        border: isSelected ? "1px solid rgba(16,185,129,0.35)" : "1px solid rgba(255,255,255,0.08)",
                        background: isSelected ? "rgba(16,185,129,0.08)" : "rgba(255,255,255,0.03)"
                      }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-base font-semibold text-white">{entry.workspace?.name || "Workspace"}</div>
                          <div className="mt-1 text-xs text-slate-400">{entry.workspace?.slug || ""}</div>
                        </div>
                        <div className="text-right text-xs text-slate-500">
                          <div>{entry.memberCount || 0} members</div>
                          <div>{entry.suspendedMemberCount || 0} suspended</div>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {(modules.length ? modules : ["no modules"]).map((moduleId) => (
                          <span
                            key={`${entry.workspace?.id}-${moduleId}`}
                            className="rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]"
                            style={{
                              borderColor: "rgba(255,255,255,0.08)",
                              background: "rgba(255,255,255,0.05)",
                              color: moduleId === "no modules" ? "#94a3b8" : "#cbd5e1"
                            }}
                          >
                            {moduleId}
                          </span>
                        ))}
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-3 text-sm">
                        <span className="text-slate-400">{entry.owner?.email || "Owner not assigned"}</span>
                        <span className="font-semibold text-emerald-300">{isSelected ? "Selected" : "Select workspace"}</span>
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="rounded-[16px] border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400">
                  No customer workspaces yet. Create the first one below.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-5">
          <form
            onSubmit={handleCreateWorkspace}
            className="rounded-[20px] border border-white/10 bg-white/[0.04] p-4"
          >
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Create workspace</div>
            <div className="mt-3 grid gap-3">
              <label className="grid gap-2 text-sm text-slate-300">
                <span>Workspace name</span>
                <input
                  value={workspaceName}
                  onChange={(event) => setWorkspaceName(event.target.value)}
                  className="rounded-[14px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none"
                  placeholder="Northwind Workspace"
                />
              </label>
              <label className="grid gap-2 text-sm text-slate-300">
                <span>Workspace slug (optional)</span>
                <input
                  value={workspaceSlug}
                  onChange={(event) => setWorkspaceSlug(event.target.value)}
                  className="rounded-[14px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none"
                  placeholder="northwind-workspace"
                />
              </label>
            </div>
            <button
              type="submit"
              disabled={creatingWorkspace}
              className="mt-4 rounded-[14px] border border-emerald-400/25 bg-emerald-500/15 px-4 py-2.5 text-sm font-semibold text-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {creatingWorkspace ? "Creating workspace..." : "Create workspace"}
            </button>
          </form>

          <form
            onSubmit={handleProvisionMember}
            className="rounded-[20px] border border-white/10 bg-white/[0.04] p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Provision customer</div>
                <div className="mt-1 text-sm text-slate-400">
                  {selectedWorkspace
                    ? `Adding a customer to ${selectedWorkspace.workspace?.name || "the selected workspace"}`
                    : "Create or select a workspace first, then assign the first customer account."}
                </div>
              </div>
              {selectedWorkspace ? (
                <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-200">
                  {selectedWorkspace.workspace?.name}
                </div>
              ) : null}
            </div>

            <div className="mt-4 grid gap-3">
              <label className="grid gap-2 text-sm text-slate-300">
                <span>Customer name</span>
                <input
                  value={customerName}
                  onChange={(event) => setCustomerName(event.target.value)}
                  className="rounded-[14px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none"
                  placeholder="Nadia Rahman"
                />
              </label>
              <label className="grid gap-2 text-sm text-slate-300">
                <span>Customer email</span>
                <input
                  type="email"
                  value={customerEmail}
                  onChange={(event) => setCustomerEmail(event.target.value)}
                  className="rounded-[14px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none"
                  placeholder="owner@northwind.com"
                />
              </label>
              <label className="grid gap-2 text-sm text-slate-300">
                <span>Initial password</span>
                <input
                  type="password"
                  value={customerPassword}
                  onChange={(event) => setCustomerPassword(event.target.value)}
                  className="rounded-[14px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none"
                  placeholder="Temporary password"
                />
              </label>
            </div>

            <div className="mt-4">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">First workspace role</div>
              <div className="flex flex-wrap gap-2">
                {[
                  ["owner", "Owner"],
                  ["manager", "Manager"],
                  ["member", "Member"]
                ].map(([id, label]) => {
                  const active = workspaceRole === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setWorkspaceRole(id)}
                      className="rounded-full border px-3 py-1.5 text-xs font-semibold"
                      style={{
                        borderColor: active ? "rgba(96,165,250,0.36)" : "rgba(255,255,255,0.1)",
                        background: active ? "rgba(96,165,250,0.14)" : "rgba(255,255,255,0.05)",
                        color: active ? "#60a5fa" : "#cbd5e1"
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-4">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Purchased modules</div>
              <div className="flex flex-wrap gap-2">
                {[
                  ["finance", "Finance"],
                  ["warehouse", "Warehouse"]
                ].map(([id, label]) => {
                  const active = modules.includes(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => toggleModule(id)}
                      className="rounded-full border px-3 py-1.5 text-xs font-semibold"
                      style={{
                        borderColor: active ? "rgba(16,185,129,0.36)" : "rgba(255,255,255,0.1)",
                        background: active ? "rgba(16,185,129,0.14)" : "rgba(255,255,255,0.05)",
                        color: active ? "#10b981" : "#cbd5e1"
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {modules.includes("finance") ? (
              <div className="mt-4">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Finance roles</div>
                <div className="flex flex-wrap gap-2">
                  {[
                    ["viewer", "Viewer"],
                    ["approver", "Approver"],
                    ["finance_staff", "Finance Staff"],
                    ["accountant", "Accountant"]
                  ].map(([id, label]) => {
                    const active = financeRoles.includes(id);
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => toggleFinanceRole(id)}
                        className="rounded-full border px-3 py-1.5 text-xs font-semibold"
                        style={{
                          borderColor: active ? "rgba(250,204,21,0.36)" : "rgba(255,255,255,0.1)",
                          background: active ? "rgba(250,204,21,0.14)" : "rgba(255,255,255,0.05)",
                          color: active ? "#facc15" : "#cbd5e1"
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <button
              type="submit"
              disabled={!selectedWorkspaceId || provisioningMember}
              className="mt-4 rounded-[14px] border border-sky-400/25 bg-sky-500/15 px-4 py-2.5 text-sm font-semibold text-sky-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {provisioningMember ? "Provisioning customer..." : "Create or assign customer"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

