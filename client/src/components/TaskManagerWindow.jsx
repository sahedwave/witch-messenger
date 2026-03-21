import { useEffect, useMemo, useState } from "react";

import { api } from "../api";

const TASK_MANAGER_STORAGE_KEY = "witch-task-manager-state";
const TASK_MANAGER_CHECKIN_HOUR = 21;
const WORKSPACE_SELECTION_STORAGE_KEY_PREFIX = "messenger-mvp-active-workspace:";
const WORKSPACE_TASK_EVENT_KEY = "messenger-mvp-workspace-task-event";

const modePresets = [
  {
    id: "student",
    label: "Student",
    icon: "🎓",
    tone: "is-student",
    summary: "Assignments, revision, exams, and study sessions.",
    categories: ["Assignments", "Revision", "Projects"]
  },
  {
    id: "professional",
    label: "Professional",
    icon: "💼",
    tone: "is-professional",
    summary: "Deadlines, clients, approvals, and work follow-ups.",
    categories: ["Deadlines", "Clients", "Meetings"]
  }
];

const statusOptions = [
  { id: "todo", label: "To do" },
  { id: "doing", label: "Doing" },
  { id: "done", label: "Done" },
  { id: "later", label: "Later" }
];

const priorityOptions = [
  { id: "urgent", label: "Urgent" },
  { id: "high", label: "High" },
  { id: "medium", label: "Medium" },
  { id: "low", label: "Low" }
];

const taskViewOptions = [
  { id: "all", label: "All tasks" },
  { id: "my", label: "My Tasks" },
  { id: "overdue", label: "Overdue" },
  { id: "today", label: "Due Today" },
  { id: "unassigned", label: "Unassigned" }
];

const defaultTasksByMode = {
  student: [
    {
      id: "student-1",
      title: "Healthcare Dashboard UI",
      dueDate: "",
      priority: "High",
      status: "todo",
      note: "Design team review and wireframe cleanup before submission.",
      assignee: "Mira",
      subject: "Design team",
      scheduleTime: "09:20 AM - 10:45 AM",
      accent: "violet"
    },
    {
      id: "student-2",
      title: "Research Plan",
      dueDate: "",
      priority: "High",
      status: "doing",
      note: "Outline hypotheses and choose three supporting sources.",
      assignee: "Wade Warren",
      subject: "Methods",
      scheduleTime: "11:30 AM - 12:00 PM",
      accent: "pink"
    },
    {
      id: "student-3",
      title: "Design Review on Campus App",
      dueDate: "",
      priority: "Medium",
      status: "later",
      note: "Review component hierarchy and accessibility issues.",
      assignee: "Leslie Alexander",
      subject: "Studio",
      scheduleTime: "12:20 PM - 02:30 PM",
      accent: "blue"
    },
    {
      id: "student-4",
      title: "Discussion on Client Requirements",
      dueDate: "",
      priority: "Medium",
      status: "todo",
      note: "Summarize the key product needs before meeting the mentor.",
      assignee: "Noah",
      subject: "Workshop",
      scheduleTime: "11:30 AM - 12:00 PM",
      accent: "violet"
    },
    {
      id: "student-5",
      title: "Organizing Team Roles for Project Success",
      dueDate: "",
      priority: "Medium",
      status: "doing",
      note: "Split research, design, and testing responsibilities.",
      assignee: "Ava",
      subject: "Collaboration",
      scheduleTime: "12:00 PM - 12:30 PM",
      accent: "amber"
    },
    {
      id: "student-6",
      title: "Meeting Outcomes and Summary",
      dueDate: "",
      priority: "Low",
      status: "done",
      note: "Capture all action items and send recap to the group.",
      assignee: "Leo",
      subject: "Summary",
      scheduleTime: "12:30 PM - 01:00 PM",
      accent: "pink"
    }
  ],
  professional: [
    {
      id: "professional-1",
      title: "Help DSTudio get more customers",
      dueDate: "",
      priority: "High",
      status: "doing",
      note: "Review the landing page and align the campaign angle.",
      assignee: "Phoenix Winters",
      comments: 7,
      links: 2,
      scheduleTime: "01:00 PM - 02:30 PM",
      accent: "green"
    },
    {
      id: "professional-2",
      title: "Plan a trip",
      dueDate: "",
      priority: "Medium",
      status: "later",
      note: "Finalize bookings and confirm the final attendee list.",
      assignee: "Cohen Merritt",
      comments: 10,
      links: 3,
      scheduleTime: "04:00 PM - 05:30 PM",
      accent: "violet"
    },
    {
      id: "professional-3",
      title: "Return a package",
      dueDate: "",
      priority: "Low",
      status: "done",
      note: "Shipment was handed off and delivery was confirmed.",
      assignee: "Lukas Juarez",
      comments: 5,
      links: 8,
      scheduleTime: "05:00 PM - 05:30 PM",
      accent: "blue"
    },
    {
      id: "professional-4",
      title: "Landing page for website",
      dueDate: "",
      priority: "High",
      status: "todo",
      note: "Clarify the main purpose of the page and the conversion goal.",
      assignee: "Sofia Reed",
      comments: 4,
      links: 1,
      scheduleTime: "07:00 PM - 08:00 PM",
      accent: "amber"
    }
  ]
};

function formatIsoDate(date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfWeek(date) {
  const next = new Date(date);
  const day = next.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  next.setDate(next.getDate() + diff);
  next.setHours(0, 0, 0, 0);
  return next;
}

function addDays(date, amount) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function createWeekDays(referenceDate = new Date()) {
  const weekStart = startOfWeek(referenceDate);
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(weekStart, index);
    return {
      iso: formatIsoDate(date),
      shortLabel: new Intl.DateTimeFormat([], { weekday: "short" }).format(date).slice(0, 2),
      dayNumber: new Intl.DateTimeFormat([], { day: "numeric" }).format(date),
      isToday: formatIsoDate(date) === formatIsoDate(new Date())
    };
  });
}

function createTimelineDays(referenceDate = new Date()) {
  const start = new Date(referenceDate);
  const end = new Date(referenceDate);
  start.setFullYear(start.getFullYear() - 1);
  end.setFullYear(end.getFullYear() + 5);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  const days = [];
  const cursor = new Date(start);

  while (cursor <= end) {
    days.push({
      iso: formatIsoDate(cursor),
      shortLabel: new Intl.DateTimeFormat([], { weekday: "short" }).format(cursor).slice(0, 2),
      dayNumber: new Intl.DateTimeFormat([], { day: "numeric" }).format(cursor),
      monthLabel: new Intl.DateTimeFormat([], { month: "short" }).format(cursor),
      yearLabel: new Intl.DateTimeFormat([], { year: "numeric" }).format(cursor),
      isToday: formatIsoDate(cursor) === formatIsoDate(new Date())
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  return days;
}

function assignStudentCalendarDates(tasks) {
  const weekDays = createWeekDays(new Date());
  return tasks.map((task, index) =>
    task.dueDate
      ? task
      : {
          ...task,
          dueDate: weekDays[index % weekDays.length]?.iso || formatIsoDate(new Date())
        }
  );
}

function createDefaultState() {
  return {
    activeMode: "professional",
    dailyCheckins: {},
    tasksByMode: {
      student: assignStudentCalendarDates(defaultTasksByMode.student),
      professional: defaultTasksByMode.professional
    }
  };
}

function readStoredState() {
  try {
    const raw = window.localStorage.getItem(TASK_MANAGER_STORAGE_KEY);
    if (!raw) {
      return createDefaultState();
    }

    const parsed = JSON.parse(raw);
    const activeMode = parsed.activeMode === "student" || parsed.activeMode === "professional" ? parsed.activeMode : "professional";
    return {
      activeMode,
      dailyCheckins: parsed.dailyCheckins || {},
      tasksByMode: {
        student: assignStudentCalendarDates(parsed.tasksByMode?.student || defaultTasksByMode.student),
        professional: parsed.tasksByMode?.professional || defaultTasksByMode.professional
      }
    };
  } catch {
    return createDefaultState();
  }
}

function modeMeta(modeId) {
  return modePresets.find((mode) => mode.id === modeId) || modePresets[1];
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) {
    return "Good Morning";
  }
  if (hour < 18) {
    return "Good Afternoon";
  }
  return "Good Evening";
}

function formatReadableDate(date = new Date()) {
  return new Intl.DateTimeFormat([], {
    weekday: "long",
    day: "numeric",
    month: "long"
  }).format(date);
}

function professionalStatusLabel(status) {
  if (status === "doing") {
    return "In Progress";
  }
  if (status === "later") {
    return "Pending";
  }
  if (status === "done") {
    return "Completed";
  }
  return "To Do";
}

function normalizeTaskPriority(priority) {
  const normalized = String(priority || "").trim().toLowerCase();
  if (["urgent", "high", "medium", "low"].includes(normalized)) {
    return normalized;
  }
  if (normalized === "high") {
    return "high";
  }
  if (normalized === "medium") {
    return "medium";
  }
  if (normalized === "low") {
    return "low";
  }
  return "medium";
}

function priorityLabel(priority) {
  const normalized = normalizeTaskPriority(priority);
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function priorityRank(priority) {
  const normalized = normalizeTaskPriority(priority);
  if (normalized === "urgent") {
    return 4;
  }
  if (normalized === "high") {
    return 3;
  }
  if (normalized === "medium") {
    return 2;
  }
  return 1;
}

function priorityTone(priority) {
  const normalized = normalizeTaskPriority(priority);
  if (normalized === "urgent" || normalized === "high") {
    return "high";
  }
  if (normalized === "medium") {
    return "medium";
  }
  return "low";
}

function taskAccent(priority = "medium") {
  const normalized = normalizeTaskPriority(priority);
  if (normalized === "urgent") {
    return "pink";
  }
  if (normalized === "high") {
    return "violet";
  }
  if (normalized === "medium") {
    return "amber";
  }
  return "blue";
}

function formatTaskInputDate(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return formatIsoDate(date);
}

function formatTaskScheduleLabel(dueDate) {
  if (!dueDate) {
    return "No schedule set";
  }

  const date = new Date(dueDate);
  if (Number.isNaN(date.getTime())) {
    return "No schedule set";
  }

  return new Intl.DateTimeFormat([], {
    month: "short",
    day: "numeric"
  }).format(date);
}

function isTaskOverdue(task) {
  if (!task?.dueDate || task?.status === "done") {
    return false;
  }

  const date = new Date(task.dueDate);
  if (Number.isNaN(date.getTime())) {
    return false;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  return date.getTime() < today.getTime();
}

function isTaskDueToday(task) {
  if (!task?.dueDate || task?.status === "done") {
    return false;
  }

  return formatTaskInputDate(task.dueDate) === formatIsoDate(new Date());
}

function dueDateTone(task) {
  if (isTaskOverdue(task)) {
    return {
      bg: "rgba(254, 226, 226, 0.92)",
      color: "#b91c1c"
    };
  }

  if (isTaskDueToday(task)) {
    return {
      bg: "rgba(254, 243, 199, 0.92)",
      color: "#b45309"
    };
  }

  return {
    bg: "rgba(226, 232, 240, 0.9)",
    color: "#475569"
  };
}

function buildTaskAssignees(task = {}) {
  if (Array.isArray(task.assignedTo) && task.assignedTo.length) {
    return task.assignedTo
      .map((entry) => ({
        id: entry?.id || "",
        name: entry?.name || "Workspace member",
        email: entry?.email || ""
      }))
      .filter((entry) => entry.name);
  }

  if (task.assignee) {
    return [
      {
        id: task.assigneeUserId || "",
        name: task.assignee,
        email: ""
      }
    ];
  }

  return [];
}

function assigneeNames(task = {}) {
  const assignees = buildTaskAssignees(task);
  return assignees.length ? assignees.map((entry) => entry.name).join(", ") : "Unassigned";
}

function readRequestedTaskView() {
  if (typeof window === "undefined") {
    return "all";
  }

  const params = new URLSearchParams(window.location.search);
  const requested = String(params.get("taskView") || "").trim().toLowerCase();
  return taskViewOptions.some((entry) => entry.id === requested) ? requested : "all";
}

function readTaskLaunchContext() {
  if (typeof window === "undefined") {
    return {
      taskId: "",
      projectId: "",
      projectName: "",
      composer: false
    };
  }

  const params = new URLSearchParams(window.location.search);
  return {
    taskId: String(params.get("taskId") || "").trim(),
    projectId: String(params.get("projectId") || "").trim(),
    projectName: String(params.get("projectName") || "").trim(),
    composer: params.get("composer") === "new"
  };
}

function broadcastWorkspaceTaskEvent(taskId = "", workspaceId = "") {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      WORKSPACE_TASK_EVENT_KEY,
      JSON.stringify({
        taskId: taskId || "",
        workspaceId: workspaceId || "",
        at: new Date().toISOString()
      })
    );
  } catch {
    // Ignore popup storage failures.
  }
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

function mapTaskRecordToUiTask(task) {
  const mode = task.mode === "student" ? "student" : "professional";
  const dueDate = formatTaskInputDate(task.dueDate);
  const assignedTo = buildTaskAssignees(task);
  const assigneeName = assignedTo.length ? assignedTo.map((entry) => entry.name).join(", ") : task.assigneeName || "Unassigned";
  const priority = normalizeTaskPriority(task.priority);

  return {
    id: task.id,
    title: task.title || "Untitled task",
    dueDate,
    priority,
    status: task.status || "todo",
    note: task.note || "",
    assignee: assigneeName,
    assignedTo,
    assigneeUserId: task.assigneeUserId || assignedTo[0]?.id || "",
    assigneeUserIds: assignedTo.map((entry) => entry.id).filter(Boolean),
    subject: mode === "student" ? "Workspace task" : undefined,
    scheduleTime: formatTaskScheduleLabel(task.dueDate),
    accent: taskAccent(priority),
    comments: 0,
    links: 0,
    mode,
    completedAt: task.completedAt || null,
    createdAt: task.createdAt || null,
    updatedAt: task.updatedAt || null
  };
}

function sortUiTasks(tasks = []) {
  return [...tasks].sort((left, right) => {
    const leftDue = left.dueDate ? new Date(left.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
    const rightDue = right.dueDate ? new Date(right.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
    if (leftDue !== rightDue) {
      return leftDue - rightDue;
    }

    const priorityDelta = priorityRank(right.priority) - priorityRank(left.priority);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }

    return new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime();
  });
}

function buildTasksByModeFromRecords(tasks = []) {
  const nextState = {
    student: [],
    professional: []
  };

  tasks.forEach((task) => {
    const mappedTask = mapTaskRecordToUiTask(task);
    const mode = mappedTask.mode === "student" ? "student" : "professional";
    nextState[mode].push(mappedTask);
  });

  nextState.student = sortUiTasks(nextState.student);
  nextState.professional = sortUiTasks(nextState.professional);

  return nextState;
}

function applyTaskRecordToTaskState(current, task) {
  const mappedTask = mapTaskRecordToUiTask(task);
  const nextTasksByMode = {
    student: (current.tasksByMode.student || []).filter((entry) => entry.id !== mappedTask.id),
    professional: (current.tasksByMode.professional || []).filter((entry) => entry.id !== mappedTask.id)
  };

  nextTasksByMode[mappedTask.mode] = sortUiTasks([mappedTask, ...(nextTasksByMode[mappedTask.mode] || [])]);

  return {
    ...current,
    tasksByMode: nextTasksByMode
  };
}

function removeTaskFromTaskState(current, taskId) {
  return {
    ...current,
    tasksByMode: {
      student: (current.tasksByMode.student || []).filter((task) => task.id !== taskId),
      professional: (current.tasksByMode.professional || []).filter((task) => task.id !== taskId)
    }
  };
}

export function TaskManagerWindow({ currentUser, authToken = null }) {
  const launchContext = readTaskLaunchContext();
  const [taskState, setTaskState] = useState(readStoredState);
  const [showModePicker, setShowModePicker] = useState(false);
  const [showTaskComposer, setShowTaskComposer] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [tasksLoading, setTasksLoading] = useState(Boolean(authToken));
  const [tasksSaving, setTasksSaving] = useState(false);
  const [taskSyncError, setTaskSyncError] = useState("");
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(null);
  const [activeWorkspaceName, setActiveWorkspaceName] = useState("");
  const [workspaceMembers, setWorkspaceMembers] = useState([]);
  const [activeStatus, setActiveStatus] = useState("todo");
  const [activeTaskView, setActiveTaskView] = useState(() => readRequestedTaskView());
  const [selectedStudentDate, setSelectedStudentDate] = useState(() => formatIsoDate(new Date()));
  const [highlightedTaskId, setHighlightedTaskId] = useState(() => launchContext.taskId || "");
  const [taskDraft, setTaskDraft] = useState({
    title: "",
    dueDate: "",
    priority: "medium",
    status: "todo",
    note: "",
    assignedTo: []
  });

  const currentMode = modeMeta(taskState.activeMode);
  const currentUserName = currentUser?.name?.trim() || "User";
  const currentUserId = currentUser?.id || currentUser?._id || "";
  const todayIso = formatIsoDate(new Date());
  const currentTasks = taskState.tasksByMode[currentMode.id] || [];
  const tasksForToday = useMemo(
    () => currentTasks.filter((task) => (task.dueDate ? task.dueDate === todayIso : true)),
    [currentTasks, todayIso]
  );
  const completedTodayCount = tasksForToday.filter((task) => task.status === "done").length;
  const remainingTodayCount = Math.max(tasksForToday.length - completedTodayCount, 0);
  const completedTodayPercent = tasksForToday.length ? Math.round((completedTodayCount / tasksForToday.length) * 100) : 0;
  const shouldAskDailyCheckin = new Date().getHours() >= TASK_MANAGER_CHECKIN_HOUR && !taskState.dailyCheckins?.[`${currentMode.id}:${todayIso}`];
  const filteredCurrentTasks = useMemo(() => {
    switch (activeTaskView) {
      case "my":
        return currentTasks.filter((task) => buildTaskAssignees(task).some((entry) => entry.id === currentUserId));
      case "overdue":
        return currentTasks.filter((task) => isTaskOverdue(task));
      case "today":
        return currentTasks.filter((task) => isTaskDueToday(task));
      case "unassigned":
        return currentTasks.filter((task) => buildTaskAssignees(task).length === 0);
      default:
        return currentTasks;
    }
  }, [activeTaskView, currentTasks, currentUserId]);
  const visibleTasks = useMemo(
    () => filteredCurrentTasks.filter((task) => task.status === activeStatus),
    [filteredCurrentTasks, activeStatus]
  );
  const professionalTasks = currentMode.id === "professional" ? filteredCurrentTasks : [];
  const studentTasks = currentMode.id === "student" ? filteredCurrentTasks : [];
  const studentTodoCount = studentTasks.filter((task) => task.status !== "done").length;
  const studentNextTask =
    studentTasks.find((task) => task.status === "todo") ||
    studentTasks.find((task) => task.status === "doing") ||
    studentTasks[0];
  const studentMembers = [...new Set(studentTasks.flatMap((task) => buildTaskAssignees(task).map((entry) => entry.name)).filter(Boolean))].slice(0, 6);
  const studentTimelineDays = useMemo(() => createTimelineDays(new Date()), []);
  const studentTasksWithDates = useMemo(
    () =>
      studentTasks.map((task, index) => ({
        ...task,
        calendarDate: task.dueDate || selectedStudentDate || formatIsoDate(addDays(new Date(), index))
      })),
    [selectedStudentDate, studentTasks]
  );
  const studentSchedule = useMemo(
    () => studentTasksWithDates.filter((task) => task.calendarDate === selectedStudentDate),
    [selectedStudentDate, studentTasksWithDates]
  );
  const selectedDayCompletedCount = studentSchedule.filter((task) => task.status === "done").length;
  const selectedDayCompletionPercent = studentSchedule.length
    ? Math.round((selectedDayCompletedCount / studentSchedule.length) * 100)
    : 0;
  const studentDayPriorityMap = useMemo(() => {
    const map = new Map();
    studentTasksWithDates.forEach((task) => {
      const currentRank = map.get(task.calendarDate)?.rank || 0;
      const nextRank = priorityRank(task.priority);
      if (nextRank >= currentRank) {
        map.set(task.calendarDate, { rank: nextRank, tone: priorityTone(task.priority) });
      }
    });
    return map;
  }, [studentTasksWithDates]);
  const studentPlan = studentTasks.slice(3, 6);
  const completedCount = professionalTasks.filter((task) => task.status === "done").length;
  const inProgressCount = professionalTasks.filter((task) => task.status === "doing").length;
  const totalSavedHours = professionalTasks.length * 3;
  const greeting = getGreeting();
  const todayLabel = formatReadableDate();
  const professionalNotes = currentMode.id === "professional" ? visibleTasks.slice(0, 3) : [];
  const professionalSchedule = professionalTasks.slice(0, 3);
  const workspaceBacked = Boolean(authToken && activeWorkspaceId);
  const canAssignTasks = workspaceMembers.length > 0;
  const linkedProjectContext = useMemo(
    () =>
      launchContext.projectId
        ? {
            id: launchContext.projectId,
            name: launchContext.projectName || "Linked project"
          }
        : null,
    [launchContext.projectId, launchContext.projectName]
  );

  useEffect(() => {
    window.localStorage.setItem(TASK_MANAGER_STORAGE_KEY, JSON.stringify(taskState));
  }, [taskState]);

  useEffect(() => {
    let isCancelled = false;

    async function loadWorkspaceTasks() {
      if (!authToken || !currentUser?.id) {
        setTasksLoading(false);
        setTaskSyncError("");
        setActiveWorkspaceId(null);
        setActiveWorkspaceName("");
        setWorkspaceMembers([]);
        return;
      }

      setTasksLoading(true);
      setTaskSyncError("");

      try {
        const workspacePayload = await api.getWorkspaces(authToken);
        const workspaces = Array.isArray(workspacePayload?.workspaces) ? workspacePayload.workspaces : [];
        const storedWorkspaceId = readStoredWorkspaceSelection(currentUser.id);
        const nextWorkspaceId =
          (storedWorkspaceId && workspaces.some((entry) => entry.workspace?.id === storedWorkspaceId) && storedWorkspaceId) ||
          workspaces[0]?.workspace?.id ||
          null;

        if (!nextWorkspaceId) {
          if (!isCancelled) {
            setActiveWorkspaceId(null);
            setActiveWorkspaceName("");
            setWorkspaceMembers([]);
          }
          return;
        }

        const payload = await api.getWorkspaceTasks(authToken, { mode: "all" }, nextWorkspaceId);
        if (isCancelled) {
          return;
        }

        setActiveWorkspaceId(nextWorkspaceId);
        setActiveWorkspaceName(payload?.workspace?.name || workspaces.find((entry) => entry.workspace?.id === nextWorkspaceId)?.workspace?.name || "Workspace");
        setWorkspaceMembers(Array.isArray(payload?.members) ? payload.members : []);
        setTaskState((current) => ({
          ...current,
          tasksByMode: buildTasksByModeFromRecords(payload?.tasks || [])
        }));
      } catch (error) {
        if (isCancelled) {
          return;
        }

        setTaskSyncError(error.message || "Unable to load workspace tasks right now.");
        setActiveWorkspaceId(null);
        setActiveWorkspaceName("");
        setWorkspaceMembers([]);
      } finally {
        if (!isCancelled) {
          setTasksLoading(false);
        }
      }
    }

    void loadWorkspaceTasks();

    return () => {
      isCancelled = true;
    };
  }, [authToken, currentUser?.id]);

  useEffect(() => {
    if (!launchContext.composer) {
      return;
    }

    setEditingTaskId(null);
    setShowTaskComposer(true);
  }, [launchContext.composer]);

  useEffect(() => {
    if (!highlightedTaskId) {
      return;
    }

    const allTasks = [...(taskState.tasksByMode.student || []), ...(taskState.tasksByMode.professional || [])];
    const focusedTask = allTasks.find((task) => task.id === highlightedTaskId);
    if (!focusedTask) {
      return;
    }

    setActiveTaskView("all");
    setActiveStatus(focusedTask.status || "todo");
    if (focusedTask.dueDate) {
      setSelectedStudentDate(focusedTask.dueDate);
    }
  }, [highlightedTaskId, taskState.tasksByMode.professional, taskState.tasksByMode.student]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const activeDay = document.querySelector(".task-window-day-dot.is-active");
      activeDay?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [selectedStudentDate]);

  function selectMode(modeId) {
    setTaskState((current) => ({
      ...current,
      activeMode: modeId
    }));
    setShowModePicker(false);
  }

  function saveDailyCheckin(outcome) {
    const key = `${currentMode.id}:${todayIso}`;
    setTaskState((current) => ({
      ...current,
      dailyCheckins: {
        ...(current.dailyCheckins || {}),
        [key]: {
          outcome,
          completedPercent: completedTodayPercent,
          remainingCount: remainingTodayCount,
          recordedAt: new Date().toISOString()
        }
      }
    }));
  }

  function buildTaskPayload() {
    return {
      title: taskDraft.title.trim(),
      dueDate: taskDraft.dueDate || null,
      priority: taskDraft.priority,
      status: taskDraft.status,
      note: taskDraft.note.trim(),
      assignedTo: taskDraft.assignedTo || [],
      mode: currentMode.id,
      ...(linkedProjectContext?.id && !editingTaskId ? { projectId: linkedProjectContext.id } : {})
    };
  }

  async function addTask() {
    const title = taskDraft.title.trim();
    if (!title || tasksSaving) {
      return;
    }

    if (workspaceBacked) {
      setTasksSaving(true);
      setTaskSyncError("");

      try {
        const createdTask = await api.createWorkspaceTask(
          authToken,
          {
            ...buildTaskPayload(),
            dueDate: currentMode.id === "student" ? taskDraft.dueDate || selectedStudentDate : taskDraft.dueDate || null
          },
          activeWorkspaceId
        );
        setTaskState((current) => applyTaskRecordToTaskState(current, createdTask));
        setHighlightedTaskId(createdTask.id || "");
        broadcastWorkspaceTaskEvent(createdTask.id || "", activeWorkspaceId || "");
      } catch (error) {
        setTaskSyncError(error.message || "Unable to save the workspace task.");
        setTasksSaving(false);
        return;
      }

      setTasksSaving(false);
    } else {
      const modeSpecificTask =
        taskState.activeMode === "student"
          ? {
              assignee: "Study group",
              subject: "Student task",
              scheduleTime: "09:00 AM - 10:00 AM",
              accent: "violet",
              dueDate: taskDraft.dueDate || selectedStudentDate
            }
          : {
              assignee: "Unassigned",
              comments: 0,
              links: 0,
              scheduleTime: taskDraft.dueDate ? "Due today" : "No schedule set",
              accent: "blue"
            };

      setTaskState((current) => ({
        ...current,
        tasksByMode: {
          ...current.tasksByMode,
          [current.activeMode]: [
            {
              id: crypto.randomUUID(),
              title,
              dueDate: taskState.activeMode === "student" ? modeSpecificTask.dueDate : taskDraft.dueDate,
              priority: taskDraft.priority,
              status: taskDraft.status,
              note: taskDraft.note.trim(),
              assignee: (taskDraft.assignedTo || []).length
                ? workspaceMembers
                    .filter((member) => taskDraft.assignedTo.includes(member.id))
                    .map((member) => member.name)
                    .join(", ")
                : modeSpecificTask.assignee,
              assignedTo: workspaceMembers
                .filter((member) => (taskDraft.assignedTo || []).includes(member.id))
                .map((member) => ({ id: member.id, name: member.name, email: member.email || "" })),
              assigneeUserId: taskDraft.assignedTo?.[0] || "",
              assigneeUserIds: [...(taskDraft.assignedTo || [])],
              ...modeSpecificTask
            },
            ...(current.tasksByMode[current.activeMode] || [])
          ]
        }
      }));
    }

    setTaskDraft({
      title: "",
      dueDate: "",
      priority: "medium",
      status: "todo",
      note: "",
      assignedTo: []
    });
    setShowTaskComposer(false);
  }

  function updateTask(taskId, patch) {
    setTaskState((current) => ({
      ...current,
      tasksByMode: {
        ...current.tasksByMode,
        [current.activeMode]: (current.tasksByMode[current.activeMode] || []).map((task) =>
          task.id === taskId ? { ...task, ...patch } : task
        )
      }
    }));
  }

  function startEditingTask(task) {
    setEditingTaskId(task.id);
    setTaskDraft({
      title: task.title || "",
      dueDate: task.dueDate || "",
      priority: normalizeTaskPriority(task.priority || "medium"),
      status: task.status || "todo",
      note: task.note || "",
      assignedTo: Array.isArray(task.assigneeUserIds)
        ? [...task.assigneeUserIds]
        : task.assigneeUserId
          ? [task.assigneeUserId]
          : []
    });
    setShowTaskComposer(true);
  }

  async function saveEditedTask() {
    const title = taskDraft.title.trim();
    if (!title || !editingTaskId || tasksSaving) {
      return;
    }

    if (workspaceBacked) {
      setTasksSaving(true);
      setTaskSyncError("");

      try {
        const updatedTask = await api.updateWorkspaceTask(
          authToken,
          editingTaskId,
          {
            ...buildTaskPayload(),
            dueDate: currentMode.id === "student" ? taskDraft.dueDate || selectedStudentDate : taskDraft.dueDate || null
          },
          activeWorkspaceId
        );
        setTaskState((current) => applyTaskRecordToTaskState(current, updatedTask));
        setHighlightedTaskId(updatedTask.id || editingTaskId);
        broadcastWorkspaceTaskEvent(updatedTask.id || editingTaskId, activeWorkspaceId || "");
      } catch (error) {
        setTaskSyncError(error.message || "Unable to update the workspace task.");
        setTasksSaving(false);
        return;
      }

      setTasksSaving(false);
    } else {
      updateTask(editingTaskId, {
        title,
        dueDate: currentMode.id === "student" ? taskDraft.dueDate || selectedStudentDate : taskDraft.dueDate,
        priority: taskDraft.priority,
        status: taskDraft.status,
        note: taskDraft.note.trim(),
        assignee: (taskDraft.assignedTo || []).length
          ? workspaceMembers
              .filter((member) => taskDraft.assignedTo.includes(member.id))
              .map((member) => member.name)
              .join(", ")
          : "Unassigned",
        assignedTo: workspaceMembers
          .filter((member) => (taskDraft.assignedTo || []).includes(member.id))
          .map((member) => ({ id: member.id, name: member.name, email: member.email || "" })),
        assigneeUserId: taskDraft.assignedTo?.[0] || "",
        assigneeUserIds: [...(taskDraft.assignedTo || [])]
      });
    }

    setEditingTaskId(null);
    setTaskDraft({
      title: "",
      dueDate: "",
      priority: "medium",
      status: "todo",
      note: "",
      assignedTo: []
    });
    setShowTaskComposer(false);
  }

  function cancelEditingTask() {
    setEditingTaskId(null);
    setTaskDraft({
      title: "",
      dueDate: "",
      priority: "medium",
      status: "todo",
      note: "",
      assignedTo: []
    });
    setShowTaskComposer(false);
  }

  async function deleteTask(taskId) {
    if (editingTaskId === taskId) {
      cancelEditingTask();
    }

    if (workspaceBacked) {
      if (tasksSaving) {
        return;
      }

      setTasksSaving(true);
      setTaskSyncError("");

      try {
        await api.deleteWorkspaceTask(authToken, taskId, activeWorkspaceId);
        setTaskState((current) => removeTaskFromTaskState(current, taskId));
        if (highlightedTaskId === taskId) {
          setHighlightedTaskId("");
        }
        broadcastWorkspaceTaskEvent(taskId, activeWorkspaceId || "");
      } catch (error) {
        setTaskSyncError(error.message || "Unable to delete the workspace task.");
        setTasksSaving(false);
        return;
      }

      setTasksSaving(false);
      return;
    }

    setTaskState((current) => ({
      ...current,
      tasksByMode: {
        ...current.tasksByMode,
        [current.activeMode]: (current.tasksByMode[current.activeMode] || []).filter((task) => task.id !== taskId)
      }
    }));
    if (highlightedTaskId === taskId) {
      setHighlightedTaskId("");
    }
  }

  return (
    <main className="task-window-shell">
      <section className="task-window-frame">
        <header className="task-window-head">
          <div className="task-window-title">
            <span className={`task-window-badge ${currentMode.tone}`}>{currentMode.label}</span>
            <h1>Task Manager</h1>
            <p>{currentMode.summary}</p>
          </div>
          <div className="task-window-head-actions">
            <button
              type="button"
              className={`ghost-button compact ${showModePicker ? "is-soft" : ""}`}
              onClick={() => setShowModePicker((current) => !current)}
              title="Change mode"
              aria-label="Change mode"
            >
              ⇄
            </button>
            <button className="ghost-button compact" type="button" onClick={() => window.close()}>
              Close
            </button>
          </div>
        </header>

        {tasksLoading ? (
          <section className="task-window-edit-banner">
            <strong>Loading tasks</strong>
            <span>Pulling the latest workspace task list into this window.</span>
          </section>
        ) : workspaceBacked ? (
          <section className="task-window-edit-banner">
            <strong>Workspace sync active</strong>
            <span>
              Tasks in this window are shared with {activeWorkspaceName || "your workspace"} and stay available for day-to-day team execution.
            </span>
          </section>
        ) : authToken ? (
          <section className="task-window-edit-banner">
            <strong>Local fallback</strong>
            <span>No active workspace task source was found for this window, so local task state is being shown for now.</span>
          </section>
        ) : null}

        {taskSyncError ? (
          <section className="task-window-checkin-banner">
            <div>
              <strong>Task sync issue</strong>
              <span>{taskSyncError}</span>
            </div>
          </section>
        ) : null}

        <section className="task-window-edit-banner">
          <strong>{taskViewOptions.find((entry) => entry.id === activeTaskView)?.label || "All tasks"}</strong>
          <span>Filter the shared task list by accountability and timing so we can focus on the work that matters first.</span>
          <div className="task-window-inline-actions">
            {taskViewOptions.map((view) => (
              <button
                key={view.id}
                type="button"
                className="ghost-button compact"
                onClick={() => setActiveTaskView(view.id)}
                style={
                  activeTaskView === view.id
                    ? { background: "rgba(56,189,248,0.14)", borderColor: "rgba(56,189,248,0.28)", color: "#0f172a" }
                    : undefined
                }
              >
                {view.label}
              </button>
            ))}
          </div>
        </section>

        {linkedProjectContext ? (
          <section className="task-window-edit-banner">
            <strong>Linked project</strong>
            <span>New tasks created in this window will be attached to {linkedProjectContext.name} automatically.</span>
          </section>
        ) : null}

        {showModePicker ? (
          <section className="task-window-mode-picker">
            {modePresets.map((mode) => (
              <button
                key={mode.id}
                type="button"
                className={`task-window-mode-card ${mode.tone} ${taskState.activeMode === mode.id ? "is-active" : ""}`}
                onClick={() => selectMode(mode.id)}
              >
                <span className="task-window-mode-icon" aria-hidden="true">
                  {mode.icon}
                </span>
                <strong>{mode.label}</strong>
                <span>{mode.summary}</span>
              </button>
            ))}
          </section>
        ) : null}

        {editingTaskId ? (
          <section className="task-window-edit-banner">
            <strong>Editing task</strong>
            <span>Save changes or cancel to return to the dashboard.</span>
          </section>
        ) : null}

        {shouldAskDailyCheckin ? (
          <section className="task-window-checkin-banner">
            <div>
              <strong>End of day check-in</strong>
              <span>
                Today: {completedTodayPercent}% completed, {remainingTodayCount} task{remainingTodayCount === 1 ? "" : "s"} remaining.
              </span>
            </div>
            <div className="task-window-inline-actions">
              <button type="button" className="ghost-button compact" onClick={() => saveDailyCheckin("completed")}>
                Finished well
              </button>
              <button type="button" className="ghost-button compact" onClick={() => saveDailyCheckin("partial")}>
                Partly done
              </button>
              <button type="button" className="ghost-button compact" onClick={() => saveDailyCheckin("missed")}>
                Not done
              </button>
            </div>
          </section>
        ) : null}

        {currentMode.id === "professional" ? (
          <>
            <section className="task-window-professional-hero">
              <div className="task-window-professional-copy">
                <span>{todayLabel}</span>
                <h2>{greeting}! {currentUserName},</h2>
                <div className="task-window-professional-stats">
                  <span>{totalSavedHours}hrs Time Saved</span>
                  <span>{completedCount} Projects Completed</span>
                  <span>{inProgressCount} Projects In-progress</span>
                  <span>{completedTodayPercent}% completed today</span>
                  <span>{remainingTodayCount} remaining today</span>
                </div>
              </div>
              <div className="task-window-professional-actions">
                <button type="button" className="ghost-button compact">Share</button>
                <button
                  type="button"
                  className="ghost-button compact"
                  onClick={() => setShowTaskComposer((current) => !current)}
                  disabled={tasksLoading || tasksSaving}
                >
                  {showTaskComposer && !editingTaskId ? "Hide Form" : "+ Add Task"}
                </button>
              </div>
            </section>

            {showTaskComposer ? (
              <section className="task-window-shared-compose">
                <div className="task-window-panel">
                  <div className="task-window-panel-head">
                    <strong>{editingTaskId ? "Edit task" : "Quick add"}</strong>
                    <span>Professional dashboard task</span>
                  </div>
                  <label className="task-window-field">
                    <span>Title</span>
                    <input
                      type="text"
                      placeholder={`Add a ${currentMode.label.toLowerCase()} task`}
                      value={taskDraft.title}
                      onChange={(event) => setTaskDraft((current) => ({ ...current, title: event.target.value }))}
                    />
                  </label>
                  <div className="task-window-row">
                    <label className="task-window-field">
                      <span>Due date</span>
                      <input
                        type="date"
                        value={taskDraft.dueDate}
                        onChange={(event) => setTaskDraft((current) => ({ ...current, dueDate: event.target.value }))}
                      />
                    </label>
                    <label className="task-window-field">
                      <span>Priority</span>
                      <select
                        value={taskDraft.priority}
                        onChange={(event) => setTaskDraft((current) => ({ ...current, priority: event.target.value }))}
                      >
                        {priorityOptions.map((priority) => (
                          <option key={priority.id} value={priority.id}>
                            {priority.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label className="task-window-field">
                    <span>Status</span>
                    <select
                      value={taskDraft.status}
                      onChange={(event) => setTaskDraft((current) => ({ ...current, status: event.target.value }))}
                    >
                      {statusOptions.map((status) => (
                        <option key={status.id} value={status.id}>
                          {status.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="task-window-field">
                    <span>Assignees</span>
                    <select
                      multiple
                      size={Math.min(Math.max(workspaceMembers.length || 0, 3), 6)}
                      value={taskDraft.assignedTo}
                      onChange={(event) =>
                        setTaskDraft((current) => ({
                          ...current,
                          assignedTo: Array.from(event.target.selectedOptions).map((option) => option.value).filter(Boolean)
                        }))
                      }
                    >
                      {workspaceMembers.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.name}
                        </option>
                      ))}
                    </select>
                    <small>{canAssignTasks ? "Hold Cmd/Ctrl to choose more than one teammate." : "No members loaded yet."}</small>
                  </label>
                  <label className="task-window-field">
                    <span>Note</span>
                    <textarea
                      rows="4"
                      value={taskDraft.note}
                      onChange={(event) => setTaskDraft((current) => ({ ...current, note: event.target.value }))}
                    />
                  </label>
                  <div className="task-window-inline-actions">
                    {editingTaskId ? (
                      <>
                        <button type="button" className="ghost-button compact" onClick={saveEditedTask}>
                          {tasksSaving ? "Saving..." : "Save Changes"}
                        </button>
                        <button type="button" className="ghost-button compact" onClick={cancelEditingTask}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button type="button" className="ghost-button compact" onClick={addTask} disabled={tasksLoading || tasksSaving}>
                        {tasksSaving ? "Saving..." : "Save Task"}
                      </button>
                    )}
                  </div>
                </div>
              </section>
            ) : null}

            <section className="task-window-professional-board">
              <div className="task-window-professional-table-card">
                <div className="task-window-panel-head">
                  <div className="task-window-professional-heading">
                    <strong>{activeTaskView === "my" ? "My Tasks" : "Team Tasks"}</strong>
                    <span>{taskViewOptions.find((entry) => entry.id === activeTaskView)?.label || "This Week"}</span>
                  </div>
                  <button type="button" className="ghost-button compact">See All</button>
                </div>
                <div className="task-window-professional-table">
                  <div className="task-window-professional-table-head">
                    <span>Task Name</span>
                    <span>Assign</span>
                    <span>Status</span>
                  </div>
                  {!professionalTasks.length ? (
                    <div className="task-window-note-row">
                      <div>
                        <strong>No tasks yet</strong>
                        <p>Create the first workspace task to start tracking daily execution here.</p>
                      </div>
                    </div>
                  ) : null}
                  {professionalTasks.map((task) => (
                    <article
                      key={task.id}
                      className="task-window-professional-row"
                      style={
                        highlightedTaskId === task.id
                          ? {
                              outline: "2px solid rgba(59,130,246,0.35)",
                              outlineOffset: 3,
                              borderRadius: 18
                            }
                          : undefined
                      }
                    >
                      <div className="task-window-professional-task">
                        <strong>{task.title}</strong>
                        <span>
                          <span
                            className="inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold"
                            style={{ background: dueDateTone(task).bg, color: dueDateTone(task).color }}
                          >
                            {task.dueDate ? (isTaskOverdue(task) ? "Overdue" : isTaskDueToday(task) ? "Due today" : formatTaskScheduleLabel(task.dueDate)) : "No due date"}
                          </span>
                          {" · "}
                          {priorityLabel(task.priority)} priority
                        </span>
                        <div className="task-window-mini-actions">
                          <button type="button" className="ghost-button compact" onClick={() => startEditingTask(task)}>Edit</button>
                          <button type="button" className="ghost-button compact" onClick={() => deleteTask(task.id)}>Remove</button>
                        </div>
                      </div>
                      <div className="task-window-professional-assignee">
                        <div className="flex items-center gap-1">
                          {buildTaskAssignees(task).slice(0, 3).map((assignee) => (
                            <span key={`${task.id}-${assignee.id || assignee.name}`} className="task-window-assignee-avatar" aria-hidden="true">
                              {(assignee.name || "A").slice(0, 1)}
                            </span>
                          ))}
                          {!buildTaskAssignees(task).length ? <span className="task-window-assignee-avatar" aria-hidden="true">U</span> : null}
                        </div>
                        <span>{assigneeNames(task)}</span>
                      </div>
                      <div className="task-window-professional-status">
                        <span className={`task-window-status-pill is-${task.status}`}>
                          {professionalStatusLabel(task.status)}
                        </span>
                      </div>
                    </article>
                  ))}
                </div>
              </div>

              <div className="task-window-professional-bottom">
                <div className="task-window-panel">
                  <div className="task-window-panel-head">
                    <strong>Schedule</strong>
                    <button type="button" className="ghost-button compact">...</button>
                  </div>
                  <div className="task-window-professional-days">
                    {["Mo 15", "Tu 16", "We 17", "Th 18", "Fr 19", "Sa 20", "Su 21"].map((day, index) => (
                      <span key={day} className={`task-window-day-dot ${index === 2 ? "is-active" : ""}`}>
                        {day}
                      </span>
                    ))}
                  </div>
                  <div className="task-window-professional-schedule">
                    {!professionalSchedule.length ? (
                      <div className="task-window-note-row">
                        <div>
                          <strong>No scheduled tasks</strong>
                          <p>Add a due date to give this schedule panel something to track.</p>
                        </div>
                      </div>
                    ) : null}
                    {professionalSchedule.map((task) => (
                      <article
                        key={task.id}
                        className="task-window-schedule-row"
                        style={
                          highlightedTaskId === task.id
                            ? {
                                outline: "2px solid rgba(59,130,246,0.35)",
                                outlineOffset: 2,
                                borderRadius: 16
                              }
                            : undefined
                        }
                      >
                        <span className={`task-window-schedule-bar is-${task.accent || "blue"}`} aria-hidden="true" />
                        <div className="task-window-schedule-copy">
                          <strong>{task.title}</strong>
                          <span>{task.scheduleTime || "No schedule set"} · {priorityLabel(task.priority)}</span>
                          <span
                            className="inline-flex w-fit rounded-full px-2 py-0.5 text-[11px] font-semibold"
                            style={{ background: dueDateTone(task).bg, color: dueDateTone(task).color }}
                          >
                            {task.dueDate ? (isTaskOverdue(task) ? "Overdue" : isTaskDueToday(task) ? "Due today" : formatTaskScheduleLabel(task.dueDate)) : "No due date"}
                          </span>
                          <div className="task-window-mini-actions">
                            <button type="button" className="ghost-button compact" onClick={() => startEditingTask(task)}>Edit</button>
                            <button type="button" className="ghost-button compact" onClick={() => deleteTask(task.id)}>Remove</button>
                          </div>
                        </div>
                        <span className="task-window-schedule-avatars">
                          {buildTaskAssignees(task).slice(0, 2).map((assignee) => (assignee.name || "A").slice(0, 1)).join("") || "U"}
                        </span>
                      </article>
                    ))}
                  </div>
                </div>

                <div className="task-window-panel">
                  <div className="task-window-panel-head">
                    <strong>Notes</strong>
                    <div className="task-window-status-row">
                      {statusOptions.map((status) => (
                        <button
                          key={status.id}
                          type="button"
                          className={`task-window-status-chip ${activeStatus === status.id ? "is-active" : ""}`}
                          onClick={() => setActiveStatus(status.id)}
                        >
                          {status.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="task-window-professional-notes">
                    {!professionalNotes.length ? (
                      <article className="task-window-note-row">
                        <div>
                          <strong>No notes in this lane</strong>
                          <p>Switch status filters or add a task to build out this execution view.</p>
                        </div>
                      </article>
                    ) : null}
                    {professionalNotes.map((task) => (
                      <article key={task.id} className="task-window-note-row">
                        <span className={`task-window-note-check is-${task.status}`} aria-hidden="true" />
                        <div>
                          <strong>{task.title}</strong>
                          <p>{task.note || "No note added yet."}</p>
                          <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-semibold">
                            <span className="rounded-full px-2 py-0.5" style={{ background: dueDateTone(task).bg, color: dueDateTone(task).color }}>
                              {task.dueDate ? (isTaskOverdue(task) ? "Overdue" : isTaskDueToday(task) ? "Due today" : formatTaskScheduleLabel(task.dueDate)) : "No due date"}
                            </span>
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{priorityLabel(task.priority)}</span>
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{assigneeNames(task)}</span>
                          </div>
                          <div className="task-window-mini-actions">
                            <button type="button" className="ghost-button compact" onClick={() => startEditingTask(task)}>Edit</button>
                            <button type="button" className="ghost-button compact" onClick={() => deleteTask(task.id)}>Remove</button>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          </>
        ) : currentMode.id === "student" ? (
          <>
            <section className="task-window-student-hero">
              <div className="task-window-student-intro">
                <div className="task-window-student-user">
                  <span className="task-window-student-avatar" aria-hidden="true">A</span>
                  <div>
                    <span>{greeting}!</span>
                    <strong>{currentUserName}</strong>
                  </div>
                </div>
                <div className="task-window-student-topbar">
                  <button type="button" className="ghost-button compact" title="Notifications">◔</button>
                </div>
              </div>
              <div className="task-window-student-copy">
                <h2>You have {studentTodoCount}</h2>
                <p>task for today</p>
                <div className="task-window-student-progress">
                  <span>{completedTodayPercent}% completed today</span>
                  <span>{remainingTodayCount} remaining</span>
                </div>
              </div>
              <div className="task-window-student-members">
                <div className="task-window-student-members-head">
                  <strong>{studentMembers.length} Assignees</strong>
                  <button
                    type="button"
                    className="task-window-student-plus"
                    onClick={() => setShowTaskComposer((current) => !current)}
                    aria-label="Toggle quick add"
                    disabled={tasksLoading || tasksSaving}
                  >
                    +
                  </button>
                </div>
                <div className="task-window-student-avatars">
                  {studentMembers.map((member) => (
                    <span key={member} className="task-window-student-member-avatar" title={member}>
                      {member.slice(0, 1)}
                    </span>
                  ))}
                </div>
              </div>
              <div className="task-window-student-next">
                <div className="task-window-student-next-head">
                  <strong>Next Task</strong>
                </div>
                {studentNextTask ? (
                  <article className={`task-window-student-feature is-${studentNextTask.accent || "violet"}`}>
                    <div className="task-window-student-feature-copy">
                      <strong>{studentNextTask.title}</strong>
                      <span>{studentNextTask.subject || "Study session"}</span>
                      <p>{studentNextTask.note}</p>
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-semibold text-white/80">
                        <span>{priorityLabel(studentNextTask.priority)} priority</span>
                        <span>{assigneeNames(studentNextTask)}</span>
                      </div>
                      <div className="task-window-mini-actions on-dark">
                        <button type="button" className="ghost-button compact" onClick={() => startEditingTask(studentNextTask)}>Edit</button>
                        <button type="button" className="ghost-button compact" onClick={() => deleteTask(studentNextTask.id)}>Remove</button>
                      </div>
                    </div>
                    <button type="button" className="task-window-student-arrow" onClick={() => setShowTaskComposer((current) => !current)}>
                      →
                    </button>
                  </article>
                ) : null}
              </div>
            </section>

            {showTaskComposer ? (
              <section className="task-window-student-compose">
                <div className="task-window-panel">
                  <div className="task-window-panel-head">
                    <strong>{editingTaskId ? "Edit task" : "Quick add"}</strong>
                    <span>Student dashboard task</span>
                  </div>
                  <label className="task-window-field">
                    <span>Title</span>
                    <input
                      type="text"
                      placeholder={`Add a ${currentMode.label.toLowerCase()} task`}
                      value={taskDraft.title}
                      onChange={(event) => setTaskDraft((current) => ({ ...current, title: event.target.value }))}
                    />
                  </label>
                  <div className="task-window-row">
                    <label className="task-window-field">
                      <span>Due date</span>
                      <input
                        type="date"
                        value={taskDraft.dueDate}
                        onChange={(event) => setTaskDraft((current) => ({ ...current, dueDate: event.target.value }))}
                      />
                    </label>
                    <label className="task-window-field">
                      <span>Priority</span>
                      <select
                        value={taskDraft.priority}
                        onChange={(event) => setTaskDraft((current) => ({ ...current, priority: event.target.value }))}
                      >
                        {priorityOptions.map((priority) => (
                          <option key={priority.id} value={priority.id}>
                            {priority.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label className="task-window-field">
                    <span>Status</span>
                    <select
                      value={taskDraft.status}
                      onChange={(event) => setTaskDraft((current) => ({ ...current, status: event.target.value }))}
                    >
                      {statusOptions.map((status) => (
                        <option key={status.id} value={status.id}>
                          {status.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="task-window-field">
                    <span>Assignees</span>
                    <select
                      multiple
                      size={Math.min(Math.max(workspaceMembers.length || 0, 3), 6)}
                      value={taskDraft.assignedTo}
                      onChange={(event) =>
                        setTaskDraft((current) => ({
                          ...current,
                          assignedTo: Array.from(event.target.selectedOptions).map((option) => option.value).filter(Boolean)
                        }))
                      }
                    >
                      {workspaceMembers.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.name}
                        </option>
                      ))}
                    </select>
                    <small>{canAssignTasks ? "Hold Cmd/Ctrl to choose more than one teammate." : "No members loaded yet."}</small>
                  </label>
                  <label className="task-window-field">
                    <span>Note</span>
                    <textarea
                      rows="4"
                      value={taskDraft.note}
                      onChange={(event) => setTaskDraft((current) => ({ ...current, note: event.target.value }))}
                    />
                  </label>
                  <div className="task-window-inline-actions">
                    {editingTaskId ? (
                      <>
                        <button type="button" className="ghost-button compact" onClick={saveEditedTask} disabled={tasksLoading || tasksSaving}>
                          {tasksSaving ? "Saving..." : "Save Changes"}
                        </button>
                        <button type="button" className="ghost-button compact" onClick={cancelEditingTask}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button type="button" className="ghost-button compact" onClick={addTask} disabled={tasksLoading || tasksSaving}>
                        {tasksSaving ? "Saving..." : "Save Task"}
                      </button>
                    )}
                  </div>
                </div>
              </section>
            ) : null}

            <section className="task-window-student-board">
              <div className="task-window-panel">
                <div className="task-window-panel-head">
                  <strong>Calendar</strong>
                  <div className="task-window-day-progress" aria-label={`Selected day completion ${selectedDayCompletionPercent}%`}>
                    <span>{selectedDayCompletionPercent}%</span>
                    <div className="task-window-day-progress-column" aria-hidden="true">
                      <i style={{ height: `${selectedDayCompletionPercent}%` }} />
                    </div>
                  </div>
                </div>
                <div className="task-window-professional-days">
                  {studentTimelineDays.map((day) => (
                    <button
                      key={day.iso}
                      type="button"
                      className={`task-window-day-dot ${day.iso === selectedStudentDate ? "is-active" : ""} ${day.isToday ? "is-today" : ""} ${
                        studentDayPriorityMap.get(day.iso)?.tone ? `is-${studentDayPriorityMap.get(day.iso).tone}` : ""
                      }`}
                      onClick={() => setSelectedStudentDate(day.iso)}
                      title={`${day.shortLabel} ${day.dayNumber} ${day.monthLabel} ${day.yearLabel}`}
                    >
                      <span className="task-window-day-dot-top">{day.shortLabel}</span>
                      <strong>{day.dayNumber}</strong>
                      <small>{day.monthLabel}</small>
                    </button>
                  ))}
                </div>
                <div className="task-window-priority-legend">
                  <span><i className="is-high" /> Urgent or high priority</span>
                  <span><i className="is-medium" /> Medium priority</span>
                  <span><i className="is-low" /> Low priority</span>
                </div>
                <div className="task-window-student-schedule">
                  {studentSchedule.length ? (
                    studentSchedule.map((task) => (
                      <article
                        key={task.id}
                        className={`task-window-student-event is-${task.accent || "blue"}`}
                        style={
                          highlightedTaskId === task.id
                            ? {
                                outline: "2px solid rgba(59,130,246,0.4)",
                                outlineOffset: 2
                              }
                            : undefined
                        }
                      >
                        <div className="task-window-student-card-head">
                          <strong>{task.title}</strong>
                          <div className="task-window-mini-actions on-dark">
                            <button type="button" className="ghost-button compact" onClick={() => startEditingTask(task)}>
                              Edit
                            </button>
                            <button type="button" className="ghost-button compact" onClick={() => deleteTask(task.id)}>
                              Remove
                            </button>
                          </div>
                        </div>
                        <span>{task.scheduleTime || "No time set"} · {priorityLabel(task.priority)}</span>
                        <small>Assigned to {assigneeNames(task)}</small>
                        <small
                          className="inline-flex w-fit rounded-full px-2 py-0.5 text-[11px] font-semibold"
                          style={{ background: dueDateTone(task).bg, color: dueDateTone(task).color }}
                        >
                          {task.dueDate ? (isTaskOverdue(task) ? "Overdue" : isTaskDueToday(task) ? "Due today" : formatTaskScheduleLabel(task.dueDate)) : "No due date"}
                        </small>
                        <small>
                          {new Intl.DateTimeFormat([], { weekday: "long", day: "numeric", month: "short" }).format(
                            new Date(task.calendarDate)
                          )}
                        </small>
                      </article>
                    ))
                  ) : (
                    <article className="task-window-student-empty">
                      <strong>No tasks for this day</strong>
                      <p>Pick another date or add a task with this day selected.</p>
                    </article>
                  )}
                </div>
              </div>

              <div className="task-window-panel">
                <div className="task-window-panel-head">
                  <strong>Plan</strong>
                  <span className="task-window-highlight-chip">Today</span>
                </div>
                <div className="task-window-student-plan">
                  {studentPlan.map((task) => (
                    <article
                      key={task.id}
                      className={`task-window-student-plan-card is-${task.accent || "violet"}`}
                      style={
                        highlightedTaskId === task.id
                          ? {
                              outline: "2px solid rgba(59,130,246,0.4)",
                              outlineOffset: 2
                            }
                          : undefined
                      }
                    >
                      <div>
                        <div className="task-window-student-card-head">
                          <strong>{task.title}</strong>
                          <div className="task-window-mini-actions on-dark">
                            <button type="button" className="ghost-button compact" onClick={() => startEditingTask(task)}>
                              Edit
                            </button>
                            <button type="button" className="ghost-button compact" onClick={() => deleteTask(task.id)}>
                              Remove
                            </button>
                          </div>
                        </div>
                        <p>{task.note}</p>
                      </div>
                      <span>{task.scheduleTime || "No time set"} · {priorityLabel(task.priority)}</span>
                    </article>
                  ))}
                </div>
              </div>
            </section>
          </>
        ) : (
          <>
            <section className="task-window-hero">
              <div className="task-window-hero-copy">
                <span>Current mode</span>
                <h2>{currentMode.label}</h2>
                <p>This window will keep opening in this mode until the user changes it manually with the `⇄` sign.</p>
              </div>
            </section>
          </>
        )}
      </section>
    </main>
  );
}
