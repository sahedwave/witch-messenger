import { useCallback } from "react";

import { api } from "../../../api";
import { normalizeCurrencyCode } from "../../../utils/currency.js";

export function useWorkspaceAdminAndPlatformLoaders({
  authToken,
  activeWorkspaceId,
  selectedPlatformWorkspaceId,
  realWorkspaceEnabled,
  canBootstrapManageFinanceMembers,
  canManageFinanceMembers,
  realFinanceEnabled,
  pushToast,
  normalizePlatformWorkspaceMember,
  applyRealWorkspaceConversations,
  setWorkspaceSettings,
  setWorkspaceSettingsLoading,
  setPlatformWorkspaces,
  setPlatformWorkspacesLoading,
  setSelectedPlatformWorkspaceId,
  setPlatformWorkspaceMembers,
  setPlatformWorkspaceMembersLoading,
  setPlatformCreatingWorkspace,
  setPlatformProvisioningMember,
  setPlatformSavingMemberId,
  setFinanceMembers,
  setFinanceMembersLoading,
  setWorkspaceState,
  setFinanceActivity
}) {
  const loadWorkspaceSettings = useCallback(async (tokenToUse = authToken, workspaceIdToUse = activeWorkspaceId, options = {}) => {
    if (!tokenToUse || !realWorkspaceEnabled) {
      setWorkspaceSettings(null);
      return null;
    }

    if (!workspaceIdToUse) {
      return null;
    }

    setWorkspaceSettingsLoading(true);
    try {
      const settings = await api.getWorkspaceSettings(tokenToUse, workspaceIdToUse);
      setWorkspaceSettings(settings);
      if (options.toastOnSuccess) {
        pushToast({
          title: "Workspace refreshed",
          body: "Workspace settings and member summary are now up to date."
        });
      }
      return settings;
    } catch (error) {
      if (options.toastOnSuccess) {
        pushToast({
          title: "Workspace refresh failed",
          body: error.message || "Unable to load workspace settings."
        });
      }
      return null;
    } finally {
      setWorkspaceSettingsLoading(false);
    }
  }, [activeWorkspaceId, authToken, realWorkspaceEnabled]);

  const loadPlatformWorkspaces = useCallback(async (tokenToUse = authToken) => {
    if (!tokenToUse || !realWorkspaceEnabled || !canBootstrapManageFinanceMembers) {
      setPlatformWorkspaces([]);
      setSelectedPlatformWorkspaceId(null);
      return [];
    }

    setPlatformWorkspacesLoading(true);
    try {
      const payload = await api.getPlatformWorkspaces(tokenToUse);
      const nextWorkspaces = Array.isArray(payload?.workspaces) ? payload.workspaces : [];
      setPlatformWorkspaces(nextWorkspaces);
      setSelectedPlatformWorkspaceId((current) => {
        const validIds = new Set(nextWorkspaces.map((entry) => entry.workspace?.id).filter(Boolean));
        if (current && validIds.has(current)) {
          return current;
        }

        if (activeWorkspaceId && validIds.has(activeWorkspaceId)) {
          return activeWorkspaceId;
        }

        return nextWorkspaces[0]?.workspace?.id || null;
      });
      return nextWorkspaces;
    } catch (error) {
      setPlatformWorkspaces([]);
      pushToast({
        title: "Platform workspaces unavailable",
        body: error.message || "Unable to load customer workspaces."
      });
      return [];
    } finally {
      setPlatformWorkspacesLoading(false);
    }
  }, [activeWorkspaceId, authToken, canBootstrapManageFinanceMembers, realWorkspaceEnabled]);

  const loadPlatformWorkspaceMembers = useCallback(async (tokenToUse = authToken, workspaceIdToUse = selectedPlatformWorkspaceId) => {
    if (!tokenToUse || !realWorkspaceEnabled || !canBootstrapManageFinanceMembers || !workspaceIdToUse) {
      setPlatformWorkspaceMembers([]);
      return [];
    }

    setPlatformWorkspaceMembersLoading(true);
    try {
      const payload = await api.getPlatformWorkspaceMembers(tokenToUse, workspaceIdToUse);
      const nextMembers = Array.isArray(payload?.members) ? payload.members.map(normalizePlatformWorkspaceMember) : [];
      setPlatformWorkspaceMembers(nextMembers);
      return nextMembers;
    } catch (error) {
      setPlatformWorkspaceMembers([]);
      pushToast({
        title: "Customer members unavailable",
        body: error.message || "Unable to load members for the selected workspace."
      });
      return [];
    } finally {
      setPlatformWorkspaceMembersLoading(false);
    }
  }, [authToken, canBootstrapManageFinanceMembers, realWorkspaceEnabled, selectedPlatformWorkspaceId]);

  const loadWorkspaceConversations = useCallback(async (tokenToUse = authToken, workspaceIdToUse = activeWorkspaceId) => {
    if (!tokenToUse || !realWorkspaceEnabled || !workspaceIdToUse) {
      return null;
    }

    try {
      const conversations = await api.getWorkspaceConversations(tokenToUse, workspaceIdToUse);
      setWorkspaceState((current) => applyRealWorkspaceConversations(current, conversations));
      return conversations;
    } catch (error) {
      pushToast({
        title: "Workspace conversations unavailable",
        body: error.message || "Unable to load workspace conversations."
      });
      return null;
    }
  }, [activeWorkspaceId, authToken, realWorkspaceEnabled]);

  const loadRealFinanceActivity = useCallback(async (tokenToUse = authToken, workspaceIdToUse = activeWorkspaceId) => {
    if (!tokenToUse || !realFinanceEnabled || !workspaceIdToUse) {
      setFinanceActivity([]);
      return;
    }

    try {
      const actions = await api.getFinanceActivity(tokenToUse, { limit: 24 }, workspaceIdToUse);
      setFinanceActivity(actions);
    } catch (error) {
      pushToast({
        title: "Finance activity unavailable",
        body: error.message || "Unable to load finance activity."
      });
    }
  }, [activeWorkspaceId, authToken, realFinanceEnabled]);

  const loadFinanceMembers = useCallback(async (tokenToUse = authToken, workspaceIdToUse = activeWorkspaceId) => {
    if (!tokenToUse || !realWorkspaceEnabled || !canManageFinanceMembers || !workspaceIdToUse) {
      setFinanceMembers([]);
      return;
    }

    setFinanceMembersLoading(true);
    try {
      const members = await api.getWorkspaceMembers(tokenToUse, workspaceIdToUse);
      setFinanceMembers(members);
    } catch (error) {
      pushToast({
        title: "Workspace members unavailable",
        body: error.message || "Unable to load workspace member access."
      });
    } finally {
      setFinanceMembersLoading(false);
    }
  }, [activeWorkspaceId, authToken, realWorkspaceEnabled, canManageFinanceMembers]);

  const handleCreatePlatformWorkspace = useCallback(async (payload) => {
    if (!authToken) {
      return null;
    }

    setPlatformCreatingWorkspace(true);
    try {
      const response = await api.createPlatformWorkspace(authToken, payload);
      await loadPlatformWorkspaces(authToken);
      pushToast({
        title: "Workspace created",
        body: `${response.workspace?.name || "Workspace"} is ready for customer provisioning.`
      });
      return response.workspace || null;
    } catch (error) {
      pushToast({
        title: "Workspace creation failed",
        body: error.message || "Unable to create the workspace."
      });
      return null;
    } finally {
      setPlatformCreatingWorkspace(false);
    }
  }, [authToken, loadPlatformWorkspaces]);

  const handleProvisionPlatformWorkspaceMember = useCallback(async (workspaceId, payload) => {
    if (!authToken || !workspaceId) {
      return null;
    }

    setPlatformProvisioningMember(true);
    try {
      const response = await api.provisionPlatformWorkspaceMember(authToken, workspaceId, payload);
      await Promise.all([
        loadPlatformWorkspaces(authToken),
        loadPlatformWorkspaceMembers(authToken, workspaceId)
      ]);
      pushToast({
        title: "Customer access granted",
        body: `${response.member?.user?.email || payload.email} can now use the assigned workspace access.`
      });
      return response.member || null;
    } catch (error) {
      pushToast({
        title: "Provisioning failed",
        body: error.message || "Unable to create or assign the customer account."
      });
      return null;
    } finally {
      setPlatformProvisioningMember(false);
    }
  }, [authToken, loadPlatformWorkspaceMembers, loadPlatformWorkspaces]);

  const handleUpdatePlatformMemberAccess = useCallback(async (member, updates = {}) => {
    if (!authToken || !selectedPlatformWorkspaceId || !member?.id) {
      return;
    }

    setPlatformSavingMemberId(member.id);
    try {
      if (Object.keys(updates).length === 1 && updates.workspaceEnabled !== undefined) {
        await api.updatePlatformWorkspaceMemberStatus(
          authToken,
          selectedPlatformWorkspaceId,
          member.id,
          updates.workspaceEnabled ? "active" : "suspended"
        );
      } else {
        const payload = {};

        if (updates.workspaceEnabled !== undefined) {
          payload.status = updates.workspaceEnabled ? "active" : "suspended";
        }

        if (updates.workspaceRole !== undefined) {
          payload.workspaceRole = updates.workspaceRole;
        }

        if (updates.workspaceModules !== undefined) {
          payload.modules = updates.workspaceModules;
        }

        await api.updatePlatformWorkspaceMember(authToken, selectedPlatformWorkspaceId, member.id, payload);
      }

      await Promise.all([
        loadPlatformWorkspaces(authToken),
        loadPlatformWorkspaceMembers(authToken, selectedPlatformWorkspaceId)
      ]);
    } catch (error) {
      pushToast({
        title: "Customer access update failed",
        body: error.message || "Unable to update the selected workspace member."
      });
    } finally {
      setPlatformSavingMemberId(null);
    }
  }, [authToken, loadPlatformWorkspaceMembers, loadPlatformWorkspaces, selectedPlatformWorkspaceId]);

  const handleTogglePlatformFinanceRole = useCallback(async (member, roleId) => {
    if (!authToken || !selectedPlatformWorkspaceId || !member?.id) {
      return;
    }

    const currentRoles = Array.isArray(member.workspaceRoles) ? member.workspaceRoles : [];
    const nextRoles = currentRoles.includes(roleId)
      ? currentRoles.filter((entry) => entry !== roleId)
      : [...currentRoles, roleId];

    setPlatformSavingMemberId(member.id);
    try {
      await api.updatePlatformWorkspaceMember(authToken, selectedPlatformWorkspaceId, member.id, {
        financeRoles: nextRoles
      });

      await Promise.all([
        loadPlatformWorkspaces(authToken),
        loadPlatformWorkspaceMembers(authToken, selectedPlatformWorkspaceId)
      ]);
    } catch (error) {
      pushToast({
        title: "Finance role update failed",
        body: error.message || "Unable to update finance roles for this customer."
      });
    } finally {
      setPlatformSavingMemberId(null);
    }
  }, [authToken, loadPlatformWorkspaceMembers, loadPlatformWorkspaces, selectedPlatformWorkspaceId]);

  return {
    loadWorkspaceSettings,
    loadPlatformWorkspaces,
    loadPlatformWorkspaceMembers,
    loadWorkspaceConversations,
    loadRealFinanceActivity,
    loadFinanceMembers,
    handleCreatePlatformWorkspace,
    handleProvisionPlatformWorkspaceMember,
    handleUpdatePlatformMemberAccess,
    handleTogglePlatformFinanceRole
  };
}

export function useWorkspaceAdminAndPlatformActions({
  authToken,
  activeWorkspaceId,
  realWorkspaceEnabled,
  workspaceAccountingEnabling,
  workspaceDefaultCurrencySaving,
  canManageFinanceMembers,
  canBootstrapManageFinanceMembers,
  pushToast,
  loadFinanceContext,
  loadRealFinanceState,
  loadRealWarehouseState,
  loadWorkspaceSettings,
  loadFinanceMembers,
  setWorkspaceAccountingEnabling,
  setWorkspaceDefaultCurrencySaving,
  setInvitingAccountant,
  setSavingFinanceMemberId,
  setFinanceMembers
}) {
  const enableWorkspaceAccounting = useCallback(async (tokenToUse = authToken, workspaceIdToUse = activeWorkspaceId) => {
    if (!tokenToUse || !realWorkspaceEnabled || !workspaceIdToUse || workspaceAccountingEnabling) {
      return null;
    }

    setWorkspaceAccountingEnabling(true);
    try {
      const payload = await api.enableWorkspaceAccounting(tokenToUse, workspaceIdToUse);
      await Promise.all([
        loadFinanceContext(tokenToUse, workspaceIdToUse),
        loadWorkspaceSettings(tokenToUse, workspaceIdToUse),
        loadRealFinanceState(tokenToUse, { accountingPeriod: financeAccountingPeriodRef.current, toastOnSuccess: false }, workspaceIdToUse)
      ]);
      pushToast({
        title: "Accounting enabled",
        body: "The accounting module is now active for this workspace and the default chart has been prepared."
      });
      return payload;
    } catch (error) {
      pushToast({
        title: "Enable accounting failed",
        body: error.message || "Unable to enable accounting for this workspace."
      });
      return null;
    } finally {
      setWorkspaceAccountingEnabling(false);
    }
  }, [
    activeWorkspaceId,
    authToken,
    loadFinanceContext,
    loadRealFinanceState,
    loadWorkspaceSettings,
    pushToast,
    realWorkspaceEnabled,
    workspaceAccountingEnabling
  ]);

  const updateWorkspaceDefaultCurrency = useCallback(async (currency, tokenToUse = authToken, workspaceIdToUse = activeWorkspaceId) => {
    if (!tokenToUse || !realWorkspaceEnabled || !workspaceIdToUse || workspaceDefaultCurrencySaving) {
      return null;
    }

    setWorkspaceDefaultCurrencySaving(true);
    try {
      const payload = await api.updateWorkspaceDefaultCurrency(tokenToUse, currency, workspaceIdToUse);
      await Promise.all([
        loadFinanceContext(tokenToUse, workspaceIdToUse),
        loadWorkspaceSettings(tokenToUse, workspaceIdToUse),
        loadRealFinanceState(tokenToUse, { accountingPeriod: financeAccountingPeriodRef.current, toastOnSuccess: false }, workspaceIdToUse),
        loadRealWarehouseState(tokenToUse, { toastOnSuccess: false }, workspaceIdToUse)
      ]);
      pushToast({
        title: "Default currency updated",
        body: `${payload?.workspace?.defaultCurrency || normalizeCurrencyCode(currency)} is now the workspace default currency.`
      });
      return payload;
    } catch (error) {
      pushToast({
        title: "Default currency update failed",
        body: error.message || "Unable to update the workspace default currency."
      });
      return null;
    } finally {
      setWorkspaceDefaultCurrencySaving(false);
    }
  }, [
    activeWorkspaceId,
    authToken,
    loadFinanceContext,
    loadRealFinanceState,
    loadRealWarehouseState,
    loadWorkspaceSettings,
    pushToast,
    realWorkspaceEnabled,
    workspaceDefaultCurrencySaving
  ]);

  const handleInviteAccountant = useCallback(async (payload) => {
    if (!authToken || !activeWorkspaceId || !realWorkspaceEnabled) {
      return null;
    }

    setInvitingAccountant(true);
    try {
      const member = await api.inviteWorkspaceAccountant(authToken, activeWorkspaceId, payload);
      await Promise.all([
        loadWorkspaceSettings(authToken, activeWorkspaceId),
        loadFinanceMembers(authToken)
      ]);
      pushToast({
        title: "Accountant invited",
        body: `${member?.email || payload.email} now has accountant access for this workspace.`
      });
      return member;
    } catch (error) {
      pushToast({
        title: "Unable to invite accountant",
        body: error.message || "Please try again."
      });
      return null;
    } finally {
      setInvitingAccountant(false);
    }
  }, [activeWorkspaceId, authToken, loadFinanceMembers, loadWorkspaceSettings, pushToast, realWorkspaceEnabled]);

  async function handleToggleFinanceMemberRole(member, roleId) {
    if (!authToken || !canManageFinanceMembers) {
      return;
    }

    const currentRoles = Array.isArray(member.workspaceRoles) ? member.workspaceRoles : [];
    const nextRoles = currentRoles.includes(roleId)
      ? currentRoles.filter((role) => role !== roleId)
      : [...currentRoles, roleId];

    setSavingFinanceMemberId(member.id);
    try {
      const updated = await api.updateFinanceMemberRoles(authToken, member.id, nextRoles, activeWorkspaceId);
      setFinanceMembers((current) => current.map((entry) => (entry.id === member.id ? updated : entry)));
      pushToast({
        title: "Finance access updated",
        body: `${updated.name} now has ${updated.workspaceRoles.length ? updated.workspaceRoles.join(", ").replaceAll("_", " ") : "no finance"} access.`
      });
    } catch (error) {
      pushToast({
        title: "Unable to update finance access",
        body: error.message || "Please try again."
      });
    } finally {
      setSavingFinanceMemberId(null);
    }
  }

  async function handleUpdateFinanceMemberAccess(member, updates) {
    if (!authToken || !canBootstrapManageFinanceMembers) {
      return;
    }

    setSavingFinanceMemberId(member.id);
    try {
      const updated = await api.updateWorkspaceMemberAccess(authToken, member.id, updates, activeWorkspaceId);
      setFinanceMembers((current) => current.map((entry) => (entry.id === member.id ? updated : entry)));
      pushToast({
        title: "Workspace access updated",
        body: `${updated.name} now has ${updated.workspaceEnabled ? "workspace access" : "workspace access disabled"}${updated.workspaceRole ? ` as ${updated.workspaceRole}` : ""}.`
      });
    } catch (error) {
      pushToast({
        title: "Unable to update workspace access",
        body: error.message || "Please try again."
      });
    } finally {
      setSavingFinanceMemberId(null);
    }
  }

  return {
    enableWorkspaceAccounting,
    updateWorkspaceDefaultCurrency,
    handleInviteAccountant,
    handleToggleFinanceMemberRole,
    handleUpdateFinanceMemberAccess
  };
}
