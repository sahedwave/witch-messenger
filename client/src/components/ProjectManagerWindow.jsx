import { useEffect, useMemo, useState } from "react";

import { api } from "../api";
import { readStoredInboxGroups, removeInboxGroup, writeStoredInboxGroups } from "../inbox-group-utils";
import { canUseProjectChat, getExternalTeamMemberCount } from "../project-chat-utils";

export const PROJECT_MANAGER_STORAGE_KEY = "witch-project-manager-state";
const WORKSPACE_SELECTION_STORAGE_KEY_PREFIX = "messenger-mvp-active-workspace:";
const WORKSPACE_TASK_EVENT_KEY = "messenger-mvp-workspace-task-event";

const emptyMilestone = () => ({
  id: crypto.randomUUID(),
  title: "",
  weight: 0,
  done: false
});

const defaultProjects = [
  {
    id: "project-1",
    name: "Website Redesign",
    client: "Northwind Labs",
    type: "Client project",
    status: "active",
    dueDate: "2026-04-25",
    summary: "Refresh the public website, tighten onboarding, and ship a stronger marketing landing page.",
    milestones: [
      { id: "m-1", title: "Discovery approved", weight: 20, done: true },
      { id: "m-2", title: "Landing page prototype", weight: 30, done: true },
      { id: "m-3", title: "Content revision", weight: 25, done: false },
      { id: "m-4", title: "Final QA pass", weight: 25, done: false }
    ],
    team: [
      { id: "team-1", name: "Ishika", contactId: null },
      { id: "team-2", name: "Likhon", contactId: null },
      { id: "team-3", name: "Abdullah", contactId: null }
    ],
    chatRoom: null
  },
  {
    id: "project-2",
    name: "Mobile Study App",
    client: "Internal",
    type: "Internal build",
    status: "planning",
    dueDate: "2026-05-12",
    summary: "Define the student roadmap, onboarding, task system, and calendar integration for mobile.",
    milestones: [
      { id: "m-5", title: "Scope draft", weight: 30, done: true },
      { id: "m-6", title: "Feature map", weight: 30, done: false },
      { id: "m-7", title: "Prototype review", weight: 40, done: false }
    ],
    team: [
      { id: "team-4", name: "Mira", contactId: null },
      { id: "team-5", name: "Wade", contactId: null },
      { id: "team-6", name: "Leslie", contactId: null }
    ],
    chatRoom: null
  }
];

function calculateProgressFromMilestones(milestones = []) {
  const totalWeight = milestones.reduce((sum, milestone) => sum + (Number(milestone.weight) || 0), 0);
  if (!totalWeight) {
    return 0;
  }

  const completedWeight = milestones.reduce(
    (sum, milestone) => sum + (milestone.done ? Number(milestone.weight) || 0 : 0),
    0
  );

  return Math.round((completedWeight / totalWeight) * 100);
}

function normalizeMilestones(milestones = []) {
  if (!Array.isArray(milestones) || milestones.length === 0) {
    return [emptyMilestone()];
  }

  return milestones.map((milestone, index) => ({
    id: milestone.id || crypto.randomUUID(),
    title: milestone.title || `Milestone ${index + 1}`,
    weight: Number(milestone.weight ?? 0),
    done: Boolean(milestone.done)
  }));
}

function broadcastWorkspaceExecutionEvent(workspaceId = "", taskId = "", projectId = "") {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  try {
    window.localStorage.setItem(
      WORKSPACE_TASK_EVENT_KEY,
      JSON.stringify({
        workspaceId,
        taskId,
        projectId,
        timestamp: Date.now()
      })
    );
  } catch {
    // Ignore storage-sync failures in popup contexts.
  }
}

function normalizeTeam(team = []) {
  if (!Array.isArray(team)) {
    return [];
  }

  return team
    .map((member, index) => {
      if (typeof member === "string") {
        return {
          id: `team-${index}-${member}`,
          name: member,
          contactId: null
        };
      }

      return {
        id: member.id || crypto.randomUUID(),
        name: member.name || "Unnamed member",
        contactId: member.contactId || null
      };
    })
    .filter((member) => member.name.trim());
}

function migrateLegacyDefaultTeam(project) {
  if (project.id !== "project-1") {
    return project;
  }

  const legacyNames = ["Ava", "Noah", "Liam"];
  const nextNames = ["Ishika", "Likhon", "Abdullah"];
  const currentNames = (project.team || []).map((member) => member.name);

  if (
    currentNames.length === legacyNames.length &&
    currentNames.every((name, index) => name === legacyNames[index])
  ) {
    return {
      ...project,
      team: (project.team || []).map((member, index) => ({
        ...member,
        name: nextNames[index]
      }))
    };
  }

  return project;
}

function normalizeProject(project) {
  const migratedProject = migrateLegacyDefaultTeam(project);
  const milestones = normalizeMilestones(migratedProject.milestones);
  return {
    id: migratedProject.id || crypto.randomUUID(),
    name: migratedProject.name || "Untitled project",
    client: migratedProject.client || "Internal",
    type: migratedProject.type || "General",
    status: migratedProject.status || "planning",
    dueDate: migratedProject.dueDate || "",
    summary: migratedProject.summary || "",
    milestones,
    progress: Number.isFinite(Number(migratedProject.progress))
      ? Number(migratedProject.progress)
      : calculateProgressFromMilestones(milestones),
    team: normalizeTeam(migratedProject.team),
    linkedTasks: Array.isArray(migratedProject.linkedTasks) ? migratedProject.linkedTasks : [],
    linkedTaskIds: Array.isArray(migratedProject.linkedTaskIds)
      ? migratedProject.linkedTaskIds
      : Array.isArray(migratedProject.linkedTasks)
        ? migratedProject.linkedTasks.map((task) => task.id).filter(Boolean)
        : [],
    chatRoom: migratedProject.chatRoom || null
  };
}

function createDefaultState() {
  const projects = defaultProjects.map(normalizeProject);
  return {
    projects,
    activeProjectId: projects[0]?.id || null
  };
}

function readStoredState() {
  try {
    const raw = window.localStorage.getItem(PROJECT_MANAGER_STORAGE_KEY);
    if (!raw) {
      return createDefaultState();
    }

    const parsed = JSON.parse(raw);
    const projects = Array.isArray(parsed.projects) && parsed.projects.length
      ? parsed.projects.map(normalizeProject)
      : createDefaultState().projects;
    const activeProjectId = projects.some((project) => project.id === parsed.activeProjectId)
      ? parsed.activeProjectId
      : projects[0]?.id || null;

    return { projects, activeProjectId };
  } catch {
    return createDefaultState();
  }
}

function statusLabel(status) {
  if (status === "active") {
    return "Active";
  }
  if (status === "planning") {
    return "Planning";
  }
  if (status === "on_hold" || status === "hold") {
    return "On hold";
  }
  if (status === "completed") {
    return "Completed";
  }
  if (status === "cancelled") {
    return "Cancelled";
  }
  return "Planning";
}

function statusBadgeStyle(status) {
  if (status === "completed") {
    return {
      background: "rgba(16,185,129,0.12)",
      color: "#047857",
      border: "1px solid rgba(16,185,129,0.22)"
    };
  }
  if (status === "active") {
    return {
      background: "rgba(59,130,246,0.12)",
      color: "#1d4ed8",
      border: "1px solid rgba(59,130,246,0.22)"
    };
  }
  if (status === "on_hold" || status === "hold") {
    return {
      background: "rgba(245,158,11,0.12)",
      color: "#b45309",
      border: "1px solid rgba(245,158,11,0.22)"
    };
  }
  if (status === "cancelled") {
    return {
      background: "rgba(239,68,68,0.1)",
      color: "#b91c1c",
      border: "1px solid rgba(239,68,68,0.2)"
    };
  }
  return {
    background: "rgba(148,163,184,0.12)",
    color: "#475569",
    border: "1px solid rgba(148,163,184,0.2)"
  };
}

function formatDueDate(date) {
  if (!date) {
    return "No deadline";
  }

  return new Intl.DateTimeFormat([], {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(new Date(date));
}

function chatRetentionMs(mode) {
  if (mode === "1d") {
    return 24 * 60 * 60 * 1000;
  }
  if (mode === "7d") {
    return 7 * 24 * 60 * 60 * 1000;
  }
  if (mode === "30d") {
    return 30 * 24 * 60 * 60 * 1000;
  }
  return null;
}

function createProjectChat(project, currentUserName, disappearingMode = "off") {
  return {
    id: crypto.randomUUID(),
    name: project.name,
    disappearingMode,
    inboxGroupId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: [
      {
        id: crypto.randomUUID(),
        text: `Project group created for ${project.name}.`,
        createdAt: new Date().toISOString(),
        editedAt: null,
        deletedAt: null,
        seenAt: null,
        sender: {
          id: `project-owner-${currentUserName.toLowerCase().replace(/\s+/g, "-")}`,
          name: currentUserName
        },
        recipient: {
          id: project.id,
          name: project.name
        },
        reactions: []
      }
    ]
  };
}

function readStoredWorkspaceSelection(userId) {
  if (!userId || typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage.getItem(`${WORKSPACE_SELECTION_STORAGE_KEY_PREFIX}${userId}`) || null;
  } catch {
    return null;
  }
}

function formatProjectInputDate(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString().slice(0, 10);
}

function formatProjectDate(value) {
  return formatProjectInputDate(value);
}

function isProjectDateTodayOrPast(value) {
  if (!value) {
    return false;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return false;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  return date.getTime() <= today.getTime();
}

function taskIsDone(task) {
  const status = String(task?.status || "").trim().toLowerCase();
  return status === "done" || status === "completed";
}

function summarizeProjectTasks(tasks = []) {
  const normalizedTasks = Array.isArray(tasks) ? tasks : [];
  const totalTasks = normalizedTasks.length;
  const completedTasks = normalizedTasks.filter((task) => taskIsDone(task)).length;
  const overdueTasks = normalizedTasks.filter((task) => {
    if (taskIsDone(task) || !task?.dueDate) {
      return false;
    }

    return isProjectDateTodayOrPast(task.dueDate) && formatProjectDate(task.dueDate) !== formatProjectDate(new Date());
  }).length;
  const nextDueDate = normalizedTasks
    .filter((task) => !taskIsDone(task) && task?.dueDate)
    .map((task) => new Date(task.dueDate))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((left, right) => left.getTime() - right.getTime())[0] || null;
  const assignees = [...new Map(
    normalizedTasks
      .flatMap((task) => Array.isArray(task.assignedTo) ? task.assignedTo : [])
      .map((entry) => {
        const id = entry?.id || entry?.userId || entry?.email || entry?.name || null;
        return id
          ? [String(id), { id: String(id), name: entry?.name || "Workspace member", email: entry?.email || "" }]
          : null;
      })
      .filter(Boolean)
  ).values()];

  return {
    totalTasks,
    completedTasks,
    overdueTasks,
    progress: totalTasks ? Math.round((completedTasks / totalTasks) * 100) : 0,
    nextDueDate: nextDueDate ? formatProjectInputDate(nextDueDate) : "",
    assignees
  };
}

function mergeProjectTaskSummary(project) {
  const taskSummary = summarizeProjectTasks(project.linkedTasks || []);
  return {
    ...project,
    totalTasks: Number.isFinite(Number(project.totalTasks)) ? Number(project.totalTasks) : taskSummary.totalTasks,
    completedTasks: Number.isFinite(Number(project.completedTasks)) ? Number(project.completedTasks) : taskSummary.completedTasks,
    overdueTasks: Number.isFinite(Number(project.overdueTasks)) ? Number(project.overdueTasks) : taskSummary.overdueTasks,
    progress: Number.isFinite(Number(project.progress))
      ? Number(project.progress)
      : taskSummary.progress,
    nextDueDate: project.nextDueDate ? formatProjectInputDate(project.nextDueDate) : taskSummary.nextDueDate,
    assignees: Array.isArray(project.assignees) && project.assignees.length ? project.assignees : taskSummary.assignees
  };
}

function mapProjectRecordToUiProject(project, existingProject = null) {
  return normalizeProject(mergeProjectTaskSummary({
    id: project.id,
    name: project.name,
    client: project.client,
    type: project.type,
    status: project.status,
    dueDate: formatProjectInputDate(project.dueDate),
    completedAt: project.completedAt || null,
    summary: project.summary,
    milestones: project.milestones || [],
    team: (project.team || []).map((member) => ({
      id: member.id || crypto.randomUUID(),
      name: member.name,
      contactId: member.userId || null
    })),
    linkedTasks: Array.isArray(project.linkedTasks) ? project.linkedTasks : [],
    linkedTaskIds: Array.isArray(project.linkedTasks) ? project.linkedTasks.map((task) => task.id).filter(Boolean) : [],
    progress: Number(project.progress || 0),
    totalTasks: project.totalTasks,
    completedTasks: project.completedTasks,
    overdueTasks: project.overdueTasks,
    nextDueDate: project.nextDueDate,
    assignees: project.assignees || [],
    chatRoom: existingProject?.chatRoom || null
  }));
}

function buildProjectStateFromRecords(records = [], currentState = createDefaultState()) {
  const existingById = new Map((currentState.projects || []).map((project) => [project.id, project]));
  const projects = records.map((project) => mapProjectRecordToUiProject(project, existingById.get(project.id)));
  const activeProjectId = projects.some((project) => project.id === currentState.activeProjectId)
    ? currentState.activeProjectId
    : projects[0]?.id || null;

  return {
    projects,
    activeProjectId
  };
}

function applyProjectRecordToState(current, projectRecord) {
  const existingProject = (current.projects || []).find((project) => project.id === projectRecord.id) || null;
  const mappedProject = mapProjectRecordToUiProject(projectRecord, existingProject);
  const nextProjects = [mappedProject, ...(current.projects || []).filter((project) => project.id !== mappedProject.id)];

  return {
    projects: nextProjects,
    activeProjectId: mappedProject.id
  };
}

export function ProjectManagerWindow({ currentUser, authToken }) {
  const launchParams = new URLSearchParams(window.location.search);
  const shouldStartComposer = launchParams.get("composer") === "new";
  const seededProjectName = launchParams.get("projectName") || "";
  const requestedProjectId = launchParams.get("projectId") || "";
  const [state, setState] = useState(readStoredState);
  const [projectsLoading, setProjectsLoading] = useState(Boolean(authToken));
  const [projectsSaving, setProjectsSaving] = useState(false);
  const [projectSyncError, setProjectSyncError] = useState("");
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(null);
  const [activeWorkspaceName, setActiveWorkspaceName] = useState("");
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState(null);
  const [availableProfiles, setAvailableProfiles] = useState([]);
  const [availableTasks, setAvailableTasks] = useState([]);
  const [projectTasksLoading, setProjectTasksLoading] = useState(false);
  const [projectTaskDraft, setProjectTaskDraft] = useState({
    title: "",
    dueDate: "",
    priority: "medium",
    assignedTo: []
  });
  const [draft, setDraft] = useState({
    name: "",
    client: "",
    type: "",
    status: "planning",
    dueDate: "",
    summary: "",
    teamInput: "",
    team: [],
    milestones: [emptyMilestone()],
    linkedTaskIds: []
  });

  const projects = state.projects;
  const activeProject = projects.find((project) => project.id === state.activeProjectId) || projects[0] || null;
  const activeMilestones = activeProject?.milestones || [];
  const completedMilestones = activeMilestones.filter((milestone) => milestone.done).length;
  const ownerName = currentUser?.name?.trim() || "User";
  const workspaceBacked = Boolean(authToken && activeWorkspaceId);
  const activeCount = projects.filter((project) => project.status === "active").length;
  const completedCount = projects.filter((project) => project.status === "completed").length;
  const planningCount = projects.filter((project) => project.status === "planning").length;
  const linkedMembers = useMemo(
    () => (activeProject?.team || []).filter((member) => member.contactId),
    [activeProject]
  );
  const externalMemberCount = useMemo(
    () => getExternalTeamMemberCount(activeProject?.team || []),
    [activeProject]
  );
  const matchingProfiles = useMemo(() => {
    const query = draft.teamInput.trim().toLowerCase();
    if (!query) {
      return [];
    }

    return availableProfiles
      .filter(
        (profile) =>
          profile.name?.toLowerCase().includes(query) ||
          profile.email?.toLowerCase().includes(query)
      )
      .slice(0, 6);
  }, [availableProfiles, draft.teamInput]);

  const linkedTaskCount = activeProject?.totalTasks || activeProject?.linkedTasks?.length || 0;
  const completedLinkedTaskCount = activeProject?.completedTasks || (activeProject?.linkedTasks || []).filter((task) => taskIsDone(task)).length;

  useEffect(() => {
    window.localStorage.setItem(PROJECT_MANAGER_STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  useEffect(() => {
    let ignore = false;

    async function loadWorkspaceProjects() {
      if (!authToken || !currentUser?.id) {
        setProjectsLoading(false);
        setProjectSyncError("");
        setActiveWorkspaceId(null);
        setActiveWorkspaceName("");
        setAvailableProfiles([]);
        setAvailableTasks([]);
        return;
      }

      setProjectsLoading(true);
      setProjectSyncError("");

      try {
        const workspacePayload = await api.getWorkspaces(authToken);
        const workspaces = Array.isArray(workspacePayload?.workspaces) ? workspacePayload.workspaces : [];
        const storedWorkspaceId = readStoredWorkspaceSelection(currentUser.id);
        const nextWorkspaceId =
          (storedWorkspaceId && workspaces.some((entry) => entry.workspace?.id === storedWorkspaceId) && storedWorkspaceId) ||
          workspaces[0]?.workspace?.id ||
          null;

        if (!nextWorkspaceId) {
          if (!ignore) {
            setActiveWorkspaceId(null);
            setActiveWorkspaceName("");
            setAvailableProfiles([]);
            setAvailableTasks([]);
          }
          return;
        }

        const payload = await api.getWorkspaceProjects(authToken, nextWorkspaceId);
        if (ignore) {
          return;
        }

        setActiveWorkspaceId(nextWorkspaceId);
        setActiveWorkspaceName(
          payload?.workspace?.name ||
            workspaces.find((entry) => entry.workspace?.id === nextWorkspaceId)?.workspace?.name ||
            "Workspace"
        );
        setAvailableProfiles(
          (payload?.members || [])
            .filter((member) => member.id !== currentUser?.id)
            .map((member) => ({
              id: member.id,
              name: member.name,
              email: member.email
            }))
        );
        setAvailableTasks(Array.isArray(payload?.availableTasks) ? payload.availableTasks : []);
        setState((current) => buildProjectStateFromRecords(payload?.projects || [], current));
      } catch (error) {
        if (ignore) {
          return;
        }

        setProjectSyncError(error.message || "Unable to load workspace projects right now.");
        setActiveWorkspaceId(null);
        setActiveWorkspaceName("");
        setAvailableProfiles([]);
        setAvailableTasks([]);
      } finally {
        if (!ignore) {
          setProjectsLoading(false);
        }
      }
    }

    void loadWorkspaceProjects();

    return () => {
      ignore = true;
    };
  }, [authToken, currentUser?.id]);

  useEffect(() => {
    if (!shouldStartComposer) {
      return;
    }

    setEditingProjectId(null);
    setDraft({
      name: seededProjectName,
      client: "",
      type: "",
      status: "planning",
      dueDate: "",
      summary: "",
      teamInput: "",
      team: [],
      milestones: [emptyMilestone()],
      linkedTaskIds: []
    });
    setIsComposerOpen(true);

    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.delete("composer");
    nextUrl.searchParams.delete("projectName");
    window.history.replaceState({}, "", nextUrl.toString());
  }, [seededProjectName, shouldStartComposer]);

  useEffect(() => {
    if (!requestedProjectId || !projects.length) {
      return;
    }

    if (projects.some((project) => project.id === requestedProjectId)) {
      setState((current) => ({
        ...current,
        activeProjectId: requestedProjectId
      }));
    }
  }, [projects, requestedProjectId]);

  useEffect(() => {
    let ignore = false;

    async function loadActiveProjectTasks() {
      if (!workspaceBacked || !authToken || !activeWorkspaceId || !activeProject?.id) {
        return;
      }

      setProjectTasksLoading(true);
      try {
        const payload = await api.getWorkspaceProjectTasks(authToken, activeProject.id, activeWorkspaceId);
        if (ignore) {
          return;
        }

        const nextLinkedTasks = Array.isArray(payload?.tasks) ? payload.tasks : [];
        setState((current) => ({
          ...current,
          projects: current.projects.map((project) =>
            project.id === activeProject.id
              ? mergeProjectTaskSummary({
                  ...project,
                  linkedTasks: nextLinkedTasks,
                  linkedTaskIds: nextLinkedTasks.map((task) => task.id).filter(Boolean)
                })
              : project
          )
        }));
      } catch (error) {
        if (!ignore) {
          setProjectSyncError(error.message || "Unable to load project tasks.");
        }
      } finally {
        if (!ignore) {
          setProjectTasksLoading(false);
        }
      }
    }

    void loadActiveProjectTasks();

    return () => {
      ignore = true;
    };
  }, [activeProject?.id, activeWorkspaceId, authToken, workspaceBacked]);

  function resetDraft() {
    setDraft({
      name: "",
      client: "",
      type: "",
      status: "planning",
      dueDate: "",
      summary: "",
      teamInput: "",
      team: [],
      milestones: [emptyMilestone()],
      linkedTaskIds: []
    });
  }

  function openComposer(project = null) {
    if (project) {
      setEditingProjectId(project.id);
      setDraft({
        name: project.name || "",
        client: project.client || "",
        type: project.type || "",
        status: project.status || "planning",
        dueDate: project.dueDate || "",
        summary: project.summary || "",
        teamInput: "",
        team: normalizeTeam(project.team),
        milestones: normalizeMilestones(project.milestones),
        linkedTaskIds: Array.isArray(project.linkedTaskIds) ? project.linkedTaskIds : []
      });
    } else {
      setEditingProjectId(null);
      resetDraft();
    }

    setIsComposerOpen(true);
  }

  function closeComposer() {
    setEditingProjectId(null);
    resetDraft();
    setIsComposerOpen(false);
  }

  function addManualTeamMember() {
    const name = draft.teamInput.trim();
    if (!name) {
      return;
    }

    setDraft((current) => ({
      ...current,
      teamInput: "",
      team: [...current.team, { id: crypto.randomUUID(), name, contactId: null }]
    }));
  }

  function addProfileMember(profile) {
    setDraft((current) => {
      if (current.team.some((member) => member.contactId === profile.id || member.name === profile.name)) {
        return current;
      }

      return {
        ...current,
        teamInput: "",
        team: [...current.team, { id: crypto.randomUUID(), name: profile.name, contactId: profile.id }]
      };
    });
  }

  function removeTeamMember(memberId) {
    setDraft((current) => ({
      ...current,
      team: current.team.filter((member) => member.id !== memberId)
    }));
  }

  function toggleLinkedTask(taskId) {
    setDraft((current) => ({
      ...current,
      linkedTaskIds: current.linkedTaskIds.includes(taskId)
        ? current.linkedTaskIds.filter((entry) => entry !== taskId)
        : [...current.linkedTaskIds, taskId]
    }));
  }

  function updateDraftMilestone(milestoneId, patch) {
    setDraft((current) => ({
      ...current,
      milestones: current.milestones.map((milestone) =>
        milestone.id === milestoneId ? { ...milestone, ...patch } : milestone
      )
    }));
  }

  function addDraftMilestone() {
    setDraft((current) => ({
      ...current,
      milestones: [...current.milestones, emptyMilestone()]
    }));
  }

  function removeDraftMilestone(milestoneId) {
    setDraft((current) => ({
      ...current,
      milestones: current.milestones.filter((milestone) => milestone.id !== milestoneId)
    }));
  }

  function buildProjectPayload() {
    const milestones = normalizeMilestones(
      draft.milestones.filter((milestone) => milestone.title.trim()).map((milestone) => ({
        ...milestone,
        title: milestone.title.trim(),
        weight: Number(milestone.weight) || 0
      }))
    );

    return {
      name: draft.name.trim(),
      client: draft.client.trim() || "Internal",
      type: draft.type.trim() || "General",
      status: draft.status,
      dueDate: draft.dueDate || null,
      summary: draft.summary.trim(),
      milestones,
      team: draft.team.map((member) => ({
        userId: member.contactId || null,
        name: member.name,
        email: ""
      })),
      linkedTaskIds: draft.linkedTaskIds
    };
  }

  async function updateProjectStatus(nextStatus) {
    if (!activeProject || projectsSaving || !nextStatus || nextStatus === activeProject.status) {
      return;
    }

    if (workspaceBacked) {
      setProjectsSaving(true);
      setProjectSyncError("");
      try {
        const updatedProject = await api.updateWorkspaceProjectStatus(authToken, activeProject.id, nextStatus, activeWorkspaceId);
        setState((current) => applyProjectRecordToState(current, updatedProject));
        broadcastWorkspaceExecutionEvent(activeWorkspaceId, "", updatedProject.id || activeProject.id);
      } catch (error) {
        setProjectSyncError(error.message || "Unable to update the workspace project status.");
      } finally {
        setProjectsSaving(false);
      }
      return;
    }

    setState((current) => ({
      ...current,
      projects: current.projects.map((project) =>
        project.id === activeProject.id
          ? {
              ...project,
              status: nextStatus,
              completedAt: nextStatus === "completed" ? new Date().toISOString() : null
            }
          : project
      )
    }));
  }

  function openProjectTaskComposer(project) {
    const taskUrl = new URL(window.location.href);
    taskUrl.searchParams.set("view", "tasks");
    taskUrl.searchParams.set("composer", "new");
    taskUrl.searchParams.set("projectId", project.id);
    taskUrl.searchParams.set("projectName", project.name);
    const popup = window.open(
      taskUrl.toString(),
      "witch-task-window",
      "popup=yes,width=1180,height=860,left=90,top=60,resizable=yes,scrollbars=yes"
    );

    popup?.focus();
  }

  async function createProjectTask() {
    const title = projectTaskDraft.title.trim();
    if (!workspaceBacked || !authToken || !activeWorkspaceId || !activeProject?.id || !title || projectsSaving) {
      return;
    }

    setProjectsSaving(true);
    setProjectSyncError("");
    try {
      const createdTask = await api.createWorkspaceTask(
        authToken,
        {
          title,
          dueDate: projectTaskDraft.dueDate || null,
          priority: projectTaskDraft.priority,
          status: "todo",
          assignedTo: projectTaskDraft.assignedTo || [],
          mode: "professional",
          projectId: activeProject.id
        },
        activeWorkspaceId
      );

      setAvailableTasks((current) => [{ ...createdTask, projectId: activeProject.id }, ...current.filter((task) => task.id !== createdTask.id)]);
      setState((current) => ({
        ...current,
        projects: current.projects.map((project) =>
          project.id === activeProject.id
            ? mergeProjectTaskSummary({
                ...project,
                linkedTasks: [createdTask, ...(project.linkedTasks || [])],
                linkedTaskIds: [createdTask.id, ...(project.linkedTaskIds || []).filter((entry) => entry !== createdTask.id)]
              })
            : project
        )
      }));
      setProjectTaskDraft({
        title: "",
        dueDate: "",
        priority: "medium",
        assignedTo: []
      });
      broadcastWorkspaceExecutionEvent(activeWorkspaceId, createdTask.id || "", activeProject.id);
    } catch (error) {
      setProjectSyncError(error.message || "Unable to create the linked project task.");
    } finally {
      setProjectsSaving(false);
    }
  }

  async function saveProject() {
    const name = draft.name.trim();
    if (!name || projectsSaving) {
      return;
    }

    const payload = buildProjectPayload();
    const previousProject = editingProjectId ? projects.find((project) => project.id === editingProjectId) : null;
    let nextChatRoom = previousProject?.chatRoom || null;

    if (
      previousProject?.status !== "completed" &&
      draft.status === "completed" &&
      previousProject?.chatRoom
    ) {
      const deleteChat = window.confirm(
        "This project is now completed. Do you want to delete the temporary project chat?"
      );

      if (deleteChat) {
        if (previousProject.chatRoom.inboxGroupId) {
          const nextGroups = removeInboxGroup(readStoredInboxGroups(), previousProject.chatRoom.inboxGroupId);
          writeStoredInboxGroups(nextGroups);
        }
        nextChatRoom = null;
      } else {
        nextChatRoom = previousProject.chatRoom;
        const shouldExport = window.confirm(
          "Keep the project chat and export it now?"
        );

        if (shouldExport) {
          const blob = new Blob([JSON.stringify(previousProject.chatRoom, null, 2)], {
            type: "application/json"
          });
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = `${name.replace(/\s+/g, "-").toLowerCase()}-project-chat.json`;
          link.click();
          URL.revokeObjectURL(url);
        }
      }
    }

    if (workspaceBacked) {
      setProjectsSaving(true);
      setProjectSyncError("");

      try {
        const savedProject = editingProjectId
          ? await api.updateWorkspaceProject(authToken, editingProjectId, payload, activeWorkspaceId)
          : await api.createWorkspaceProject(authToken, payload, activeWorkspaceId);

        setState((current) => {
          const nextState = applyProjectRecordToState(current, savedProject);
          const nextProjects = nextState.projects.map((project) =>
            project.id === savedProject.id
              ? {
                  ...project,
                  chatRoom: nextChatRoom
                    ? {
                        ...nextChatRoom,
                        name
                      }
                    : project.chatRoom
                }
              : project
          );
          return {
            projects: nextProjects,
            activeProjectId: nextState.activeProjectId
          };
        });
        setAvailableTasks((current) =>
          current.map((task) =>
            payload.linkedTaskIds.includes(task.id)
              ? { ...task, projectId: savedProject.id }
              : task.projectId === savedProject.id
                ? { ...task, projectId: null }
                : task
          )
        );
        broadcastWorkspaceExecutionEvent(activeWorkspaceId, "", savedProject.id);
      } catch (error) {
        setProjectSyncError(error.message || "Unable to save the workspace project.");
        setProjectsSaving(false);
        return;
      }

      setProjectsSaving(false);
    } else {
      const nextProject = normalizeProject({
        id: editingProjectId || crypto.randomUUID(),
        name,
        client: draft.client.trim() || "Internal",
        type: draft.type.trim() || "General",
        status: draft.status,
        dueDate: draft.dueDate,
        summary: draft.summary.trim(),
        milestones: payload.milestones,
        team: draft.team,
        linkedTasks: availableTasks.filter((task) => draft.linkedTaskIds.includes(task.id)),
        linkedTaskIds: draft.linkedTaskIds,
        chatRoom:
          nextChatRoom
            ? {
                ...nextChatRoom,
                name
              }
            : null
      });

      setState((current) => {
        const exists = current.projects.some((project) => project.id === nextProject.id);
        return {
          projects: exists
            ? current.projects.map((project) => (project.id === nextProject.id ? nextProject : project))
            : [nextProject, ...current.projects],
          activeProjectId: nextProject.id
        };
      });
    }

    closeComposer();
  }

  async function deleteProject(projectId) {
    if (projectsSaving) {
      return;
    }

    if (workspaceBacked) {
      setProjectsSaving(true);
      setProjectSyncError("");
      try {
        await api.deleteWorkspaceProject(authToken, projectId, activeWorkspaceId);
        setAvailableTasks((current) =>
          current.map((task) => (task.projectId === projectId ? { ...task, projectId: null } : task))
        );
      } catch (error) {
        setProjectSyncError(error.message || "Unable to delete the workspace project.");
        setProjectsSaving(false);
        return;
      }
      setProjectsSaving(false);
    }

    setState((current) => {
      const nextProjects = current.projects.filter((project) => project.id !== projectId);
      return {
        projects: nextProjects,
        activeProjectId: nextProjects[0]?.id || null
      };
    });

    if (editingProjectId === projectId) {
      closeComposer();
    }
  }

  async function persistProjectMilestones(projectId, transform) {
    const currentProject = projects.find((project) => project.id === projectId);
    if (!currentProject || projectsSaving) {
      return;
    }

    const milestones = normalizeMilestones(transform(currentProject.milestones));

    if (workspaceBacked) {
      setProjectsSaving(true);
      setProjectSyncError("");
      try {
        const updatedProject = await api.updateWorkspaceProject(
          authToken,
          projectId,
          {
            milestones
          },
          activeWorkspaceId
        );
        setState((current) => applyProjectRecordToState(current, updatedProject));
      } catch (error) {
        setProjectSyncError(error.message || "Unable to update project milestones.");
      } finally {
        setProjectsSaving(false);
      }
      return;
    }

    setState((current) => ({
      ...current,
      projects: current.projects.map((project) => {
        if (project.id !== projectId) {
          return project;
        }

        return {
          ...project,
          milestones,
          progress: calculateProgressFromMilestones(milestones)
        };
      })
    }));
  }

  function toggleMilestone(projectId, milestoneId) {
    void persistProjectMilestones(projectId, (milestones) =>
      milestones.map((milestone) =>
        milestone.id === milestoneId ? { ...milestone, done: !milestone.done } : milestone
      )
    );
  }

  function editMilestone(projectId, milestoneId, patch) {
    void persistProjectMilestones(projectId, (milestones) =>
      milestones.map((milestone) =>
        milestone.id === milestoneId ? { ...milestone, ...patch } : milestone
      )
    );
  }

  function addMilestone(projectId) {
    void persistProjectMilestones(projectId, (milestones) => [...milestones, emptyMilestone()]);
  }

  function removeMilestone(projectId, milestoneId) {
    void persistProjectMilestones(projectId, (milestones) => milestones.filter((milestone) => milestone.id !== milestoneId));
  }

  function openProjectChat(project) {
    if (!canUseProjectChat(project.team)) {
      return;
    }

    const targetProject =
      project.chatRoom
        ? project
        : {
            ...project,
            chatRoom: createProjectChat(project, ownerName)
          };

    if (!project.chatRoom) {
      setState((current) => ({
        ...current,
        projects: current.projects.map((entry) =>
          entry.id === project.id ? targetProject : entry
        )
      }));
    }

    const chatUrl = new URL(window.location.href);
    chatUrl.searchParams.set("view", "project-chat");
    chatUrl.searchParams.set("projectId", targetProject.id);
    const popup = window.open(
      chatUrl.toString(),
      `witch-project-chat-${targetProject.id}`,
      "popup=yes,width=980,height=760,left=120,top=70,resizable=yes,scrollbars=yes"
    );

    popup?.focus();
  }

  return (
    <main className="project-window-shell">
      <section className="project-window-frame">
        <header className="project-window-head">
          <div className="project-window-title">
            <span className="project-window-badge">Project management</span>
            <h1>{ownerName}'s projects</h1>
            <p>Structure projects, map milestones, link real team profiles, and keep a temporary project chat until the work is complete.</p>
          </div>
          <div className="project-window-head-actions">
            <button type="button" className="ghost-button compact" onClick={() => openComposer()}>
              + New Project
            </button>
            <button type="button" className="ghost-button compact" onClick={() => window.close()}>
              Close
            </button>
          </div>
        </header>

        {projectsLoading ? (
          <section className="task-window-edit-banner">
            <strong>Loading projects</strong>
            <span>Pulling the latest workspace project list and linked tasks into this window.</span>
          </section>
        ) : workspaceBacked ? (
          <section className="task-window-edit-banner">
            <strong>Workspace sync active</strong>
            <span>Projects in this window are shared with {activeWorkspaceName || "your workspace"} and use linked workspace tasks for progress.</span>
          </section>
        ) : authToken ? (
          <section className="task-window-edit-banner">
            <strong>Local fallback</strong>
            <span>No active workspace project source was found for this window, so local project state is being shown for now.</span>
          </section>
        ) : null}

        {projectSyncError ? (
          <section className="task-window-checkin-banner">
            <div>
              <strong>Project sync issue</strong>
              <span>{projectSyncError}</span>
            </div>
          </section>
        ) : null}

        <section className="project-window-hero">
          <article className="project-window-stat-card">
            <strong>{activeCount}</strong>
            <span>Active projects</span>
          </article>
          <article className="project-window-stat-card">
            <strong>{planningCount}</strong>
            <span>Planning</span>
          </article>
          <article className="project-window-stat-card">
            <strong>{completedCount}</strong>
            <span>Completed</span>
          </article>
          <article className="project-window-stat-card is-progress">
            <strong>{activeProject?.progress || 0}%</strong>
            <span>{activeProject ? `${activeProject.name} progress` : "No active project"}</span>
          </article>
        </section>

        {isComposerOpen ? (
          <section className="project-window-composer">
            <div className="project-window-panel">
              <div className="project-window-panel-head">
                <strong>{editingProjectId ? "Edit project" : "Create project"}</strong>
                <span>Project setup</span>
              </div>
              <label className="project-window-field">
                <span>Project name</span>
                <input
                  type="text"
                  value={draft.name}
                  onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                />
              </label>
              <div className="project-window-row">
                <label className="project-window-field">
                  <span>Client</span>
                  <input
                    type="text"
                    value={draft.client}
                    onChange={(event) => setDraft((current) => ({ ...current, client: event.target.value }))}
                  />
                </label>
                <label className="project-window-field">
                  <span>Status</span>
                  <select
                    value={draft.status}
                    onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value }))}
                  >
                    <option value="planning">Planning</option>
                    <option value="active">Active</option>
                    <option value="completed">Completed</option>
                    <option value="hold">On hold</option>
                  </select>
                </label>
              </div>
              <div className="project-window-row">
                <label className="project-window-field">
                  <span>Project type</span>
                  <input
                    type="text"
                    placeholder="Client project / Internal build / Research"
                    value={draft.type}
                    onChange={(event) => setDraft((current) => ({ ...current, type: event.target.value }))}
                  />
                </label>
                <label className="project-window-field">
                  <span>Deadline</span>
                  <input
                    type="date"
                    value={draft.dueDate}
                    onChange={(event) => setDraft((current) => ({ ...current, dueDate: event.target.value }))}
                  />
                </label>
              </div>
              <label className="project-window-field">
                <span>Summary</span>
                <textarea
                  rows="4"
                  value={draft.summary}
                  onChange={(event) => setDraft((current) => ({ ...current, summary: event.target.value }))}
                />
              </label>

              <div className="project-window-subpanel">
                <div className="project-window-panel-head">
                  <strong>Team</strong>
                  <span>Email / Add names or link IN APP USER profiles.</span>
                </div>
                <div className="project-window-row">
                  <label className="project-window-field">
                    <span>Member name / email</span>
                    <input
                      type="text"
                      placeholder="Type a name / email and add"
                      value={draft.teamInput}
                      onChange={(event) => setDraft((current) => ({ ...current, teamInput: event.target.value }))}
                    />
                  </label>
                  <div className="project-window-inline-actions project-window-team-actions">
                    <button type="button" className="ghost-button compact" onClick={addManualTeamMember}>
                      Add member
                    </button>
                  </div>
                </div>
                <div className="project-window-team">
                  {draft.team.map((member) => (
                    <span key={member.id} className="project-window-member is-linked">
                      {member.name}
                      {member.contactId ? <small>Profile linked</small> : null}
                      <button type="button" className="ghost-button compact" onClick={() => removeTeamMember(member.id)}>
                        x
                      </button>
                    </span>
                  ))}
                </div>
                <div className="project-window-profile-picker">
                  {(matchingProfiles.length ? matchingProfiles : availableProfiles.slice(0, 8)).map((profile) => (
                    <button
                      key={profile.id}
                      type="button"
                      className={`ghost-button compact ${matchingProfiles.length ? "is-soft" : ""}`}
                      onClick={() => addProfileMember(profile)}
                    >
                      + {profile.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="project-window-subpanel">
                <div className="project-window-panel-head">
                  <strong>Milestones</strong>
                  <button type="button" className="ghost-button compact" onClick={addDraftMilestone}>
                    + Add milestone
                  </button>
                </div>
                <div className="project-window-milestone-editor">
                  {draft.milestones.map((milestone) => (
                    <div key={milestone.id} className="project-window-milestone-row is-draft">
                      <input
                        type="text"
                        placeholder="Milestone title"
                        value={milestone.title}
                        onChange={(event) => updateDraftMilestone(milestone.id, { title: event.target.value })}
                      />
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={milestone.weight}
                      onChange={(event) => updateDraftMilestone(milestone.id, { weight: Number(event.target.value) || 0 })}
                    />
                    <span>% of project</span>
                    <button type="button" className="ghost-button compact" onClick={() => removeDraftMilestone(milestone.id)}>
                      Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="project-window-subpanel">
                <div className="project-window-panel-head">
                  <strong>Linked tasks</strong>
                  <span>{draft.linkedTaskIds.length} selected</span>
                </div>
                <div className="project-window-team-list">
                  {(availableTasks.length ? availableTasks : []).map((task) => (
                    <label key={task.id} className="project-window-team-card">
                      <div>
                        <strong>{task.title}</strong>
                        <span>
                          {task.priority} priority · {task.status}
                          {task.projectId && task.projectId !== editingProjectId ? " · already linked elsewhere" : ""}
                        </span>
                      </div>
                      <input
                        type="checkbox"
                        checked={draft.linkedTaskIds.includes(task.id)}
                        disabled={Boolean(task.projectId && task.projectId !== editingProjectId)}
                        onChange={() => toggleLinkedTask(task.id)}
                      />
                    </label>
                  ))}
                  {!availableTasks.length ? (
                    <article className="project-window-team-card">
                      <strong>No workspace tasks yet</strong>
                      <span>Create tasks first to link execution work back into projects.</span>
                    </article>
                  ) : null}
                </div>
              </div>

              <div className="project-window-inline-actions">
                <button type="button" className="ghost-button compact" onClick={saveProject} disabled={projectsLoading || projectsSaving}>
                  {projectsSaving ? "Saving..." : "Save project"}
                </button>
                <button type="button" className="ghost-button compact" onClick={closeComposer}>
                  Cancel
                </button>
              </div>
            </div>
          </section>
        ) : null}

        <section className="project-window-grid">
          <div className="project-window-panel">
            <div className="project-window-panel-head">
              <strong>Projects</strong>
              <span>{projects.length} total</span>
            </div>
            <div className="project-window-list">
              {!projects.length ? (
                <div className="project-window-empty">
                  <strong>No projects yet</strong>
                  <p>Create the first workspace-backed project to start linking execution work here.</p>
                </div>
              ) : null}
              {projects.map((project) => (
                <article
                  key={project.id}
                  className={`project-window-card ${state.activeProjectId === project.id ? "is-active" : ""}`}
                  onClick={() => setState((current) => ({ ...current, activeProjectId: project.id }))}
                >
                  <div className="project-window-card-top">
                    <div>
                      <strong>{project.name}</strong>
                      <span>{project.client}</span>
                    </div>
                    <span className={`project-window-status is-${project.status}`}>{statusLabel(project.status)}</span>
                  </div>
                  <p>{project.summary}</p>
                  <div className="project-window-card-meta">
                    <span>{project.type}</span>
                    <span style={project.nextDueDate && isProjectDateTodayOrPast(project.nextDueDate) ? { color: "#b45309", fontWeight: 700 } : undefined}>
                      Next due {formatDueDate(project.nextDueDate || project.dueDate)}
                    </span>
                    <span>{project.completedTasks || 0}/{project.totalTasks || 0} tasks done</span>
                  </div>
                  <div
                    className="mt-3 h-2 overflow-hidden rounded-full"
                    style={{ background: "rgba(148,163,184,0.16)" }}
                  >
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.max(0, Math.min(project.progress || 0, 100))}%`,
                        background:
                          (project.progress || 0) >= 100
                            ? "#10b981"
                            : (project.progress || 0) > 0
                              ? "#f59e0b"
                              : "#94a3b8"
                      }}
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-semibold">
                    <span className="rounded-full px-2 py-1" style={{ background: "rgba(15,23,42,0.06)", color: "#475569" }}>
                      {project.progress || 0}% complete
                    </span>
                    {project.overdueTasks ? (
                      <span className="rounded-full px-2 py-1" style={{ background: "rgba(239,68,68,0.1)", color: "#b91c1c" }}>
                        {project.overdueTasks} overdue
                      </span>
                    ) : null}
                  </div>
                  <div className="project-window-inline-actions">
                    <button
                      type="button"
                      className="ghost-button compact"
                      disabled={projectsSaving}
                      onClick={(event) => {
                        event.stopPropagation();
                        openComposer(project);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="ghost-button compact"
                      disabled={projectsSaving}
                      onClick={(event) => {
                        event.stopPropagation();
                        deleteProject(project.id);
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <div className="project-window-panel project-window-detail">
            {activeProject ? (
              <>
                <div className="project-window-panel-head">
                  <div className="project-window-detail-heading">
                    <strong>{activeProject.name}</strong>
                    <span>{activeProject.client}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`project-window-status is-${activeProject.status}`}
                      style={statusBadgeStyle(activeProject.status)}
                    >
                      {statusLabel(activeProject.status)}
                    </span>
                    <select
                      value={activeProject.status || "planning"}
                      onChange={(event) => void updateProjectStatus(event.target.value)}
                      disabled={projectsSaving}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700"
                    >
                      <option value="planning">Planning</option>
                      <option value="active">Active</option>
                      <option value="on_hold">On hold</option>
                      <option value="completed">Completed</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                  </div>
                </div>

                <section className="project-window-detail-hero">
                  <div
                    className="project-window-progress-ring"
                    style={{
                      background: `radial-gradient(circle at center, #fff 42%, transparent 43%), conic-gradient(#7c67ee 0deg, #d96dd2 ${Math.max(
                        0,
                        Math.min(activeProject.progress, 100)
                      ) * 3.6}deg, rgba(16, 35, 63, 0.08) 0deg)`
                    }}
                  >
                    <strong>{activeProject.progress}%</strong>
                    <span>Progress</span>
                  </div>
                  <div className="project-window-detail-copy">
                    <p>{activeProject.summary}</p>
                    <div className="project-window-detail-meta">
                      <span>Type: {activeProject.type}</span>
                      <span>Deadline: {formatDueDate(activeProject.dueDate)}</span>
                      <span style={activeProject.nextDueDate && isProjectDateTodayOrPast(activeProject.nextDueDate) ? { color: "#b45309", fontWeight: 700 } : undefined}>
                        Next due: {formatDueDate(activeProject.nextDueDate || activeProject.dueDate)}
                      </span>
                      <span>{completedMilestones}/{activeMilestones.length} milestones done</span>
                      <span>{completedLinkedTaskCount}/{linkedTaskCount} linked tasks done</span>
                      {activeProject.overdueTasks ? <span style={{ color: "#b91c1c", fontWeight: 700 }}>{activeProject.overdueTasks} overdue task{activeProject.overdueTasks === 1 ? "" : "s"}</span> : null}
                    </div>
                  </div>
                </section>

                <section className="project-window-subgrid">
                  <div className="project-window-subpanel">
                    <div className="project-window-panel-head">
                      <strong>Milestones</strong>
                      <button type="button" className="ghost-button compact" onClick={() => addMilestone(activeProject.id)}>
                        + Add milestone
                      </button>
                    </div>
                    <div className="project-window-milestone-editor">
                      {activeMilestones.map((milestone) => (
                        <div key={milestone.id} className="project-window-milestone-row is-simple">
                          <input
                            type="checkbox"
                            checked={milestone.done}
                            onChange={() => toggleMilestone(activeProject.id, milestone.id)}
                          />
                          <input
                            type="text"
                            value={milestone.title}
                            onChange={(event) => editMilestone(activeProject.id, milestone.id, { title: event.target.value })}
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="project-window-subpanel">
                    <div className="project-window-panel-head">
                      <strong>Team</strong>
                      <span>{linkedMembers.length} linked app profile{linkedMembers.length === 1 ? "" : "s"}</span>
                    </div>
                    <div className="project-window-team-list">
                      {activeProject.team.map((member) => (
                        <article key={member.id} className="project-window-team-card">
                          <strong>{member.name}</strong>
                          <span>{member.contactId ? "IN APP USER linked" : "Not an IN APP USER yet"}</span>
                        </article>
                      ))}
                    </div>
                  </div>

                  <div className="project-window-subpanel">
                    <div className="project-window-panel-head">
                      <strong>Linked tasks</strong>
                      <div className="flex items-center gap-2">
                        <span>{linkedTaskCount} attached</span>
                        <button type="button" className="ghost-button compact" onClick={() => openProjectTaskComposer(activeProject)}>
                          + New task
                        </button>
                      </div>
                    </div>
                    {workspaceBacked ? (
                      <div className="mb-3 rounded-[18px] border border-slate-200 bg-slate-50 px-3 py-3">
                        <div className="grid gap-3 md:grid-cols-[minmax(0,1.3fr)_140px_140px]">
                          <input
                            type="text"
                            placeholder="Quick add a linked task"
                            value={projectTaskDraft.title}
                            onChange={(event) => setProjectTaskDraft((current) => ({ ...current, title: event.target.value }))}
                            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none"
                          />
                          <input
                            type="date"
                            value={projectTaskDraft.dueDate}
                            onChange={(event) => setProjectTaskDraft((current) => ({ ...current, dueDate: event.target.value }))}
                            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none"
                          />
                          <select
                            value={projectTaskDraft.priority}
                            onChange={(event) => setProjectTaskDraft((current) => ({ ...current, priority: event.target.value }))}
                            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none"
                          >
                            <option value="urgent">Urgent</option>
                            <option value="high">High</option>
                            <option value="medium">Medium</option>
                            <option value="low">Low</option>
                          </select>
                        </div>
                        <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                          <select
                            multiple
                            size={Math.min(Math.max(availableProfiles.length || 0, 3), 5)}
                            value={projectTaskDraft.assignedTo}
                            onChange={(event) =>
                              setProjectTaskDraft((current) => ({
                                ...current,
                                assignedTo: Array.from(event.target.selectedOptions).map((option) => option.value).filter(Boolean)
                              }))
                            }
                            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none"
                          >
                            {availableProfiles.map((profile) => (
                              <option key={profile.id} value={profile.id}>
                                {profile.name}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="ghost-button compact"
                            onClick={() => void createProjectTask()}
                            disabled={projectsSaving || !projectTaskDraft.title.trim()}
                          >
                            {projectsSaving ? "Saving..." : "Save linked task"}
                          </button>
                        </div>
                      </div>
                    ) : null}
                    <div className="project-window-team-list">
                      {projectTasksLoading ? (
                        <article className="project-window-team-card">
                          <strong>Loading linked tasks</strong>
                          <span>Refreshing project progress from workspace tasks.</span>
                        </article>
                      ) : null}
                      {(activeProject.linkedTasks || []).map((task) => (
                        <article key={task.id} className="project-window-team-card">
                          <strong>{task.title}</strong>
                          <span>
                            {task.priority} priority · {task.status}
                            {task.dueDate ? ` · due ${formatDueDate(task.dueDate)}` : ""}
                          </span>
                        </article>
                      ))}
                      {!activeProject.linkedTasks?.length ? (
                        <article className="project-window-team-card">
                          <strong>No linked tasks yet</strong>
                          <span>Attach workspace tasks to let project progress reflect real execution.</span>
                        </article>
                      ) : null}
                    </div>
                  </div>
                </section>
                <div className="project-window-chat-launch">
                  <button
                    type="button"
                    className="ghost-button compact"
                    disabled={!canUseProjectChat(activeProject.team)}
                    onClick={() => openProjectChat(activeProject)}
                    title={
                      canUseProjectChat(activeProject.team)
                        ? "Open project chat"
                        : "Project chat needs at least all but one members linked to app profiles."
                    }
                  >
                    Chat
                  </button>
                  {!canUseProjectChat(activeProject.team) ? (
                    <span className="project-window-chat-note">
                      Link more team members as IN APP USERs. Chat stays locked while {externalMemberCount} members are not IN APP USERs yet.
                    </span>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="project-window-empty">
                <strong>No projects yet</strong>
                <p>Create the first project to start tracking milestones and progress.</p>
              </div>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
