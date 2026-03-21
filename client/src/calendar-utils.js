export const CALENDAR_STORAGE_KEY = "messenger-mvp-calendar-events";

export function toDateKey(value) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function dateKeyToDate(dateKey) {
  return new Date(`${dateKey}T12:00:00`);
}

export function addDays(value, amount) {
  const next = new Date(value);
  next.setDate(next.getDate() + amount);
  return next;
}

export function addDaysToKey(dateKey, amount) {
  return toDateKey(addDays(dateKeyToDate(dateKey), amount));
}

export function sortCalendarEvents(events) {
  return [...events].sort((first, second) => {
    const firstStamp = `${first.date}T${first.time || "00:00"}`;
    const secondStamp = `${second.date}T${second.time || "00:00"}`;
    return new Date(firstStamp) - new Date(secondStamp);
  });
}

export function readCalendarEvents() {
  try {
    const raw = window.localStorage.getItem(CALENDAR_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

export function writeCalendarEvents(events) {
  window.localStorage.setItem(CALENDAR_STORAGE_KEY, JSON.stringify(events));
}

function nextHourTime() {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  now.setHours(now.getHours() + 1);
  return `${`${now.getHours()}`.padStart(2, "0")}:00`;
}

function plusHourTime(time, hours) {
  const [baseHour, baseMinute] = time.split(":").map(Number);
  const date = new Date();
  date.setHours(baseHour, baseMinute, 0, 0);
  date.setHours(date.getHours() + hours);
  return `${`${date.getHours()}`.padStart(2, "0")}:${`${date.getMinutes()}`.padStart(2, "0")}`;
}

export function createPlannerItemFromMessage({ message, contact, kind = "meeting", date = "" }) {
  const baseDate =
    date || (kind === "task" ? toDateKey(new Date()) : addDaysToKey(toDateKey(new Date()), 1));
  const startTime = kind === "task" ? "17:00" : nextHourTime();

  return {
    id: `event-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
    title:
      message.text?.trim() ||
      (kind === "task"
        ? `Follow up with ${contact?.displayName || contact?.name || "this chat"}`
        : `Meeting with ${contact?.displayName || contact?.name || "this chat"}`),
    date: baseDate,
    time: startTime,
    endTime: kind === "task" ? plusHourTime(startTime, 0) : plusHourTime(startTime, 1),
    note: message.text || "",
    location: kind === "meeting" ? "Messenger workspace" : "",
    attendees: contact?.displayName || contact?.name || "",
    attendeeId: contact?.id || null,
    attendeeName: contact?.displayName || contact?.name || "",
    type: kind,
    status: "planned",
    visibility: "workspace",
    reminderMinutes: kind === "task" ? 60 : 30,
    recurrence: "none",
    recurrenceUntil: "",
    contactId: contact?.id || null,
    contactName: contact?.displayName || contact?.name || "",
    linkedMessageId: message.id,
    linkedMessageText: message.text || message.attachment?.name || "",
    createdAt: new Date().toISOString()
  };
}
