import { useEffect, useMemo, useState } from "react";

import { addDays, addDaysToKey, dateKeyToDate, sortCalendarEvents, toDateKey } from "../calendar-utils";

const VIEW_MODES = ["month", "week", "day"];
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WORKDAY_START_HOUR = 8;
const WORKDAY_END_HOUR = 18;
const REMINDER_OPTIONS = [
  { value: 0, label: "No reminder" },
  { value: 10, label: "10 min before" },
  { value: 30, label: "30 min before" },
  { value: 60, label: "1 hour before" },
  { value: 1440, label: "1 day before" }
];
const RECURRENCE_OPTIONS = [
  { value: "none", label: "Does not repeat" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" }
];
const EVENT_TYPES = [
  { value: "meeting", label: "Meeting" },
  { value: "task", label: "Task" },
  { value: "reminder", label: "Reminder" },
  { value: "focus", label: "Focus" },
  { value: "personal", label: "Personal" }
];
const STATUS_OPTIONS = [
  { value: "planned", label: "Planned" },
  { value: "done", label: "Done" },
  { value: "cancelled", label: "Cancelled" }
];
const VISIBILITY_OPTIONS = [
  { value: "workspace", label: "Workspace" },
  { value: "private", label: "Private" }
];

function startOfWeek(dateKey) {
  const date = dateKeyToDate(dateKey);
  date.setDate(date.getDate() - date.getDay());
  return toDateKey(date);
}

function endOfWeek(dateKey) {
  return addDaysToKey(startOfWeek(dateKey), 6);
}

function buildWeekDateKeys(dateKey) {
  const firstDay = startOfWeek(dateKey);
  return Array.from({ length: 7 }, (_, index) => addDaysToKey(firstDay, index));
}

function createDefaultDraft(dateKey, activeContact) {
  return {
    id: null,
    title: "",
    date: dateKey,
    time: "09:00",
    endTime: "10:00",
    note: "",
    location: "",
    attendees: activeContact?.displayName || activeContact?.name || "",
    attendeeId: activeContact?.id || null,
    attendeeName: activeContact?.displayName || activeContact?.name || "",
    contactId: activeContact?.id || null,
    contactName: activeContact?.displayName || activeContact?.name || "",
    type: activeContact ? "meeting" : "reminder",
    status: "planned",
    visibility: "workspace",
    reminderMinutes: 30,
    recurrence: "none",
    recurrenceUntil: "",
    linkedMessageId: null,
    linkedMessageText: ""
  };
}

function getMonthLabel(value) {
  return new Intl.DateTimeFormat([], { month: "long", year: "numeric" }).format(value);
}

function formatDisplayDate(value) {
  const [year = "", month = "", day = ""] = String(value || "").split("-");
  return day && month && year ? `${day}/${month}/${year}` : value;
}

function getDayLabel(value) {
  const weekday = new Intl.DateTimeFormat([], { weekday: "long" }).format(new Date(`${value}T12:00:00`));
  return `${weekday} · ${formatDisplayDate(value)}`;
}

function getRelativeLabel(value) {
  const deltaMinutes = Math.round((new Date(value).getTime() - Date.now()) / 60000);
  const formatter = new Intl.RelativeTimeFormat([], { numeric: "auto" });

  if (Math.abs(deltaMinutes) < 60) {
    return formatter.format(deltaMinutes, "minute");
  }

  if (Math.abs(deltaMinutes) < 1440) {
    return formatter.format(Math.round(deltaMinutes / 60), "hour");
  }

  return formatter.format(Math.round(deltaMinutes / 1440), "day");
}

function formatClockTime(timeValue) {
  const [hourText = "0", minuteText = "00"] = (timeValue || "00:00").split(":");
  let hour = Number(hourText);
  const suffix = hour >= 12 ? "PM" : "AM";
  hour = hour % 12 || 12;
  return `${hour}:${minuteText} ${suffix}`;
}

function formatTimeRange(startTime, endTime) {
  return `${formatClockTime(startTime)} - ${formatClockTime(endTime)}`;
}

function buildMonthCells(monthDate, eventDateSet, selectedDate) {
  const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const gridStart = new Date(monthStart);
  gridStart.setDate(monthStart.getDate() - monthStart.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const date = addDays(gridStart, index);
    const dateKey = toDateKey(date);

    return {
      dateKey,
      day: date.getDate(),
      isCurrentMonth: date.getMonth() === monthDate.getMonth(),
      isToday: dateKey === toDateKey(new Date()),
      isSelected: dateKey === selectedDate,
      hasEvents: eventDateSet.has(dateKey)
    };
  });
}

function occursOnDate(event, dateKey) {
  if (dateKey < event.date) {
    return false;
  }

  if (event.recurrenceUntil && dateKey > event.recurrenceUntil) {
    return false;
  }

  if (event.recurrence === "none") {
    return event.date === dateKey;
  }

  const startDate = dateKeyToDate(event.date);
  const currentDate = dateKeyToDate(dateKey);
  const diffDays = Math.floor((currentDate - startDate) / 86400000);

  if (event.recurrence === "daily") {
    return diffDays >= 0;
  }

  if (event.recurrence === "weekly") {
    return diffDays >= 0 && diffDays % 7 === 0;
  }

  if (event.recurrence === "monthly") {
    return currentDate.getDate() === startDate.getDate();
  }

  return false;
}

function buildOccurrences(events, rangeStart, rangeEnd) {
  const occurrences = [];
  let current = rangeStart;

  while (current <= rangeEnd) {
    events.forEach((event) => {
      if (!occursOnDate(event, current)) {
        return;
      }

      occurrences.push({
        occurrenceId: `${event.id}:${current}`,
        date: current,
        time: event.time,
        endTime: event.endTime,
        title: event.title,
        note: event.note,
        location: event.location,
        attendees: event.attendees,
        attendeeId: event.attendeeId,
        attendeeName: event.attendeeName,
        contactId: event.contactId,
        contactName: event.contactName,
        linkedMessageId: event.linkedMessageId,
        linkedMessageText: event.linkedMessageText,
        type: event.type,
        status: event.status,
        visibility: event.visibility,
        reminderMinutes: event.reminderMinutes,
        recurrence: event.recurrence,
        recurrenceUntil: event.recurrenceUntil,
        sourceEvent: event
      });
    });

    current = addDaysToKey(current, 1);
  }

  return occurrences.sort((first, second) => {
    const firstStamp = `${first.date}T${first.time}`;
    const secondStamp = `${second.date}T${second.time}`;
    return new Date(firstStamp) - new Date(secondStamp);
  });
}

function buildReminderDate(occurrence) {
  const eventDate = new Date(`${occurrence.date}T${occurrence.time || "00:00"}`);
  eventDate.setMinutes(eventDate.getMinutes() - Number(occurrence.reminderMinutes || 0));
  return eventDate;
}

function matchesFilters(occurrence, searchTerm, typeFilter, statusFilter, visibilityFilter) {
  const query = searchTerm.trim().toLowerCase();
  if (query) {
    const haystack = [
      occurrence.title,
      occurrence.note,
      occurrence.location,
      occurrence.attendees,
      occurrence.attendeeName,
      occurrence.linkedMessageText
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    if (!haystack.includes(query)) {
      return false;
    }
  }

  if (typeFilter !== "all" && occurrence.type !== typeFilter) {
    return false;
  }

  if (statusFilter !== "all" && occurrence.status !== statusFilter) {
    return false;
  }

  if (visibilityFilter !== "all" && occurrence.visibility !== visibilityFilter) {
    return false;
  }

  return true;
}

function buildBusySummary(occurrences) {
  const merged = [];
  const workStart = WORKDAY_START_HOUR * 60;
  const workEnd = WORKDAY_END_HOUR * 60;

  occurrences
    .filter((event) => event.status !== "cancelled")
    .map((event) => {
      const [startHour, startMinute] = event.time.split(":").map(Number);
      const [endHour, endMinute] = event.endTime.split(":").map(Number);
      return {
        start: Math.max(workStart, startHour * 60 + startMinute),
        end: Math.min(workEnd, endHour * 60 + endMinute)
      };
    })
    .filter((event) => event.end > event.start)
    .sort((first, second) => first.start - second.start)
    .forEach((event) => {
      const previous = merged[merged.length - 1];
      if (!previous || event.start > previous.end) {
        merged.push({ ...event });
        return;
      }

      previous.end = Math.max(previous.end, event.end);
    });

  const busyMinutes = merged.reduce((total, event) => total + (event.end - event.start), 0);
  const freeMinutes = Math.max(0, (workEnd - workStart) - busyMinutes);

  return {
    busyHours: (busyMinutes / 60).toFixed(1),
    freeHours: (freeMinutes / 60).toFixed(1),
    blocks: merged.map((event) => {
      const startHour = `${Math.floor(event.start / 60)}`.padStart(2, "0");
      const startMinute = `${event.start % 60}`.padStart(2, "0");
      const endHour = `${Math.floor(event.end / 60)}`.padStart(2, "0");
      const endMinute = `${event.end % 60}`.padStart(2, "0");
      return `${startHour}:${startMinute} - ${endHour}:${endMinute}`;
    }).map((block) => {
      const [startTime, endTime] = block.split(" - ");
      return `${formatClockTime(startTime)} - ${formatClockTime(endTime)}`;
    })
  };
}

function buildRangeForView(viewMode, selectedDate, visibleMonth) {
  if (viewMode === "day") {
    return { start: selectedDate, end: selectedDate };
  }

  if (viewMode === "week") {
    return { start: startOfWeek(selectedDate), end: endOfWeek(selectedDate) };
  }

  const firstDay = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1);
  const rangeStart = addDays(firstDay, -firstDay.getDay());
  const rangeEnd = addDays(rangeStart, 41);
  return { start: toDateKey(rangeStart), end: toDateKey(rangeEnd) };
}

function groupOccurrencesByDate(occurrences) {
  return occurrences.reduce((groups, occurrence) => {
    if (!groups[occurrence.date]) {
      groups[occurrence.date] = [];
    }
    groups[occurrence.date].push(occurrence);
    return groups;
  }, {});
}

function overlaps(slotStartMinutes, slotEndMinutes, occurrence) {
  const [startHour, startMinute] = occurrence.time.split(":").map(Number);
  const [endHour, endMinute] = occurrence.endTime.split(":").map(Number);
  const start = startHour * 60 + startMinute;
  const end = endHour * 60 + endMinute;
  return slotStartMinutes < end && slotEndMinutes > start;
}

function buildSuggestedSlots(events, activeContact, todayKey) {
  if (!activeContact) {
    return [];
  }

  const candidates = [];

  for (let offset = 0; offset < 7 && candidates.length < 4; offset += 1) {
    const dateKey = addDaysToKey(todayKey, offset);
    const dayEvents = buildOccurrences(events, dateKey, dateKey).filter(
      (event) => event.status !== "cancelled"
    );

    [9, 11, 14, 16].forEach((hour) => {
      if (candidates.length >= 4) {
        return;
      }

      const slotStart = hour * 60;
      const slotEnd = slotStart + 60;
      const blocked = dayEvents.some((event) => overlaps(slotStart, slotEnd, event));

      if (!blocked) {
        candidates.push({
          date: dateKey,
          time: `${`${hour}`.padStart(2, "0")}:00`,
          endTime: `${`${hour + 1}`.padStart(2, "0")}:00`
        });
      }
    });
  }

  return candidates;
}

export function CalendarFlyout({
  activeContact,
  events = [],
  focusEventId = null,
  messages = [],
  onEventsChange = () => {},
  onFocusHandled = () => {}
}) {
  const today = useMemo(() => new Date(), []);
  const todayKey = useMemo(() => toDateKey(today), [today]);
  const [visibleMonth, setVisibleMonth] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1)
  );
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [viewMode, setViewMode] = useState("month");
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [visibilityFilter, setVisibilityFilter] = useState("all");
  const [editingEventId, setEditingEventId] = useState(null);
  const [draft, setDraft] = useState(() => createDefaultDraft(todayKey, activeContact));

  useEffect(() => {
    if (editingEventId) {
      return;
    }

    setDraft((current) => ({
      ...current,
      date: selectedDate,
      attendees: current.attendees || activeContact?.displayName || activeContact?.name || "",
      attendeeId: current.attendeeId || activeContact?.id || null,
      attendeeName: current.attendeeName || activeContact?.displayName || activeContact?.name || "",
      contactId: current.contactId || activeContact?.id || null,
      contactName: current.contactName || activeContact?.displayName || activeContact?.name || "",
      type: activeContact ? "meeting" : current.type
    }));
  }, [activeContact, editingEventId, selectedDate]);

  const monthRange = useMemo(
    () => buildRangeForView("month", selectedDate, visibleMonth),
    [selectedDate, visibleMonth]
  );
  const monthOccurrences = useMemo(
    () => buildOccurrences(events, monthRange.start, monthRange.end),
    [events, monthRange.end, monthRange.start]
  );
  const monthDateSet = useMemo(
    () => new Set(monthOccurrences.map((event) => event.date)),
    [monthOccurrences]
  );
  const monthCells = useMemo(
    () => buildMonthCells(visibleMonth, monthDateSet, selectedDate),
    [monthDateSet, selectedDate, visibleMonth]
  );
  const activeRange = useMemo(
    () => buildRangeForView(viewMode, selectedDate, visibleMonth),
    [viewMode, selectedDate, visibleMonth]
  );
  const visibleOccurrences = useMemo(
    () =>
      buildOccurrences(events, activeRange.start, activeRange.end).filter((occurrence) =>
        matchesFilters(occurrence, searchTerm, typeFilter, statusFilter, visibilityFilter)
      ),
    [activeRange.end, activeRange.start, events, searchTerm, statusFilter, typeFilter, visibilityFilter]
  );
  const groupedVisibleOccurrences = useMemo(
    () => groupOccurrencesByDate(visibleOccurrences),
    [visibleOccurrences]
  );
  const selectedOccurrences = useMemo(
    () => visibleOccurrences.filter((event) => event.date === selectedDate),
    [selectedDate, visibleOccurrences]
  );
  const busySummary = useMemo(
    () => buildBusySummary(selectedOccurrences),
    [selectedOccurrences]
  );
  const reminders = useMemo(() => {
    const now = new Date();
    const lookAhead = new Date(now.getTime() + 36 * 60 * 60 * 1000);
    return buildOccurrences(events, todayKey, toDateKey(lookAhead))
      .filter((event) => event.reminderMinutes > 0 && event.status === "planned")
      .map((event) => ({
        ...event,
        reminderAt: buildReminderDate(event)
      }))
      .filter((event) => event.reminderAt >= now && event.reminderAt <= lookAhead)
      .sort((first, second) => first.reminderAt - second.reminderAt)
      .slice(0, 4);
  }, [events, todayKey]);
  const upcomingEvents = useMemo(
    () =>
      buildOccurrences(events, todayKey, addDaysToKey(todayKey, 21))
        .filter((event) => event.status !== "cancelled")
        .slice(0, 5),
    [events, todayKey]
  );
  const weekDateKeys = useMemo(() => buildWeekDateKeys(selectedDate), [selectedDate]);
  const linkedConversationItems = useMemo(
    () =>
      activeContact
        ? sortCalendarEvents(events.filter((event) => event.contactId === activeContact.id)).slice(0, 4)
        : [],
    [activeContact, events]
  );
  const recentMessages = useMemo(
    () => [...messages].reverse().filter((message) => message.text || message.attachment).slice(0, 3),
    [messages]
  );
  const suggestedSlots = useMemo(
    () => buildSuggestedSlots(events, activeContact, todayKey),
    [activeContact, events, todayKey]
  );

  function resetDraft(nextDate = selectedDate) {
    setEditingEventId(null);
    setDraft(createDefaultDraft(nextDate, activeContact));
  }

  function handleChangeRange(offset) {
    if (viewMode === "month") {
      const nextMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + offset, 1);
      setVisibleMonth(nextMonth);
      setSelectedDate(toDateKey(nextMonth));
      return;
    }

    const amount = viewMode === "week" ? offset * 7 : offset;
    const nextDate = addDaysToKey(selectedDate, amount);
    setSelectedDate(nextDate);
    setVisibleMonth(new Date(dateKeyToDate(nextDate).getFullYear(), dateKeyToDate(nextDate).getMonth(), 1));
  }

  function handleSelectDate(dateKey) {
    setSelectedDate(dateKey);
    setVisibleMonth(new Date(dateKeyToDate(dateKey).getFullYear(), dateKeyToDate(dateKey).getMonth(), 1));
    if (!editingEventId) {
      setDraft((current) => ({ ...current, date: dateKey }));
    }
  }

  function handleDraftChange(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function handleCreateLinkedMeeting() {
    const nextDraft = createDefaultDraft(selectedDate, activeContact);
    nextDraft.title = activeContact
      ? `Meeting with ${activeContact.displayName || activeContact.name}`
      : "Workspace meeting";
    nextDraft.type = "meeting";
    nextDraft.location = "Messenger workspace";
    setEditingEventId(null);
    setDraft(nextDraft);
  }

  function handleApplySuggestedSlot(slot) {
    setDraft((current) => ({
      ...current,
      date: slot.date,
      time: slot.time,
      endTime: slot.endTime,
      type: "meeting",
      attendees: activeContact?.displayName || activeContact?.name || current.attendees,
      attendeeId: activeContact?.id || current.attendeeId,
      attendeeName: activeContact?.displayName || activeContact?.name || current.attendeeName,
      contactId: activeContact?.id || current.contactId,
      contactName: activeContact?.displayName || activeContact?.name || current.contactName
    }));
    setSelectedDate(slot.date);
  }

  function handleSaveEvent(event) {
    event.preventDefault();

    const title = draft.title.trim();
    if (!title) {
      return;
    }

    const nextEvent = {
      id: editingEventId || `event-${Date.now()}`,
      title,
      date: draft.date,
      time: draft.time,
      endTime: draft.endTime,
      note: draft.note.trim(),
      location: draft.location.trim(),
      attendees: draft.attendees.trim(),
      attendeeId: draft.attendeeId || activeContact?.id || null,
      attendeeName: draft.attendeeName.trim() || activeContact?.displayName || activeContact?.name || "",
      contactId: draft.contactId || activeContact?.id || null,
      contactName: draft.contactName || activeContact?.displayName || activeContact?.name || "",
      linkedMessageId: draft.linkedMessageId || null,
      linkedMessageText: draft.linkedMessageText || "",
      type: draft.type,
      status: draft.status,
      visibility: draft.visibility,
      reminderMinutes: Number(draft.reminderMinutes),
      recurrence: draft.recurrence,
      recurrenceUntil: draft.recurrence === "none" ? "" : draft.recurrenceUntil,
      createdAt:
        events.find((entry) => entry.id === editingEventId)?.createdAt || new Date().toISOString()
    };

    onEventsChange((current) => {
      if (!editingEventId) {
        return sortCalendarEvents([...current, nextEvent]);
      }

      return sortCalendarEvents(current.map((entry) => (entry.id === editingEventId ? nextEvent : entry)));
    });
    resetDraft(draft.date);
  }

  function handleEditOccurrence(occurrence) {
    const event = occurrence.sourceEvent;
    setEditingEventId(event.id);
    setDraft({
      id: event.id,
      title: event.title,
      date: occurrence.date,
      time: event.time,
      endTime: event.endTime,
      note: event.note,
      location: event.location,
      attendees: event.attendees,
      attendeeId: event.attendeeId,
      attendeeName: event.attendeeName,
      contactId: event.contactId || null,
      contactName: event.contactName || "",
      linkedMessageId: event.linkedMessageId || null,
      linkedMessageText: event.linkedMessageText || "",
      type: event.type,
      status: event.status,
      visibility: event.visibility,
      reminderMinutes: Number(event.reminderMinutes),
      recurrence: event.recurrence,
      recurrenceUntil: event.recurrenceUntil
    });
    setSelectedDate(occurrence.date);
  }

  function handleRemoveOccurrence(occurrence) {
    onEventsChange((current) => current.filter((entry) => entry.id !== occurrence.sourceEvent.id));
    if (editingEventId === occurrence.sourceEvent.id) {
      resetDraft(selectedDate);
    }
  }

  useEffect(() => {
    if (!focusEventId) {
      return;
    }

    const event = events.find((entry) => entry.id === focusEventId);
    if (!event) {
      onFocusHandled();
      return;
    }

    const occurrence = {
      occurrenceId: `${event.id}:${event.date}`,
      date: event.date,
      time: event.time,
      endTime: event.endTime,
      title: event.title,
      note: event.note,
      location: event.location,
      attendees: event.attendees,
      attendeeId: event.attendeeId,
      attendeeName: event.attendeeName,
      contactId: event.contactId,
      contactName: event.contactName,
      linkedMessageId: event.linkedMessageId,
      linkedMessageText: event.linkedMessageText,
      type: event.type,
      status: event.status,
      visibility: event.visibility,
      reminderMinutes: event.reminderMinutes,
      recurrence: event.recurrence,
      recurrenceUntil: event.recurrenceUntil,
      sourceEvent: event
    };

    setViewMode("day");
    setVisibleMonth(new Date(dateKeyToDate(event.date).getFullYear(), dateKeyToDate(event.date).getMonth(), 1));
    handleEditOccurrence(occurrence);
    onFocusHandled();
  }, [events, focusEventId, onFocusHandled]);

  return (
    <section className="chat-action-card secondary rail-flyout calendar-flyout">
      <div className="calendar-flyout-head">
        <div>
          <strong>Calendar</strong>
          <p>Meetings, reminders, tasks, and follow-up planning in one place.</p>
        </div>
        <div className="calendar-flyout-nav">
          <button className="ghost-button compact-header-toggle" type="button" onClick={() => handleChangeRange(-1)}>
            Prev
          </button>
          <button
            className="ghost-button compact-header-toggle"
            type="button"
            onClick={() => {
              setSelectedDate(todayKey);
              setVisibleMonth(new Date(today.getFullYear(), today.getMonth(), 1));
            }}
          >
            Today
          </button>
          <button className="ghost-button compact-header-toggle" type="button" onClick={() => handleChangeRange(1)}>
            Next
          </button>
        </div>
      </div>

      <div className="calendar-toolbar">
        <div className="calendar-view-toggle" role="tablist" aria-label="Calendar view mode">
          {VIEW_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              className={`calendar-view-button ${viewMode === mode ? "is-active" : ""}`}
              onClick={() => setViewMode(mode)}
            >
              {mode}
            </button>
          ))}
        </div>
        <button className="ghost-button compact-header-toggle" type="button" onClick={handleCreateLinkedMeeting}>
          {activeContact ? "Meeting from chat" : "New meeting"}
        </button>
      </div>

      {activeContact ? (
        <section className="calendar-linked-chat">
          <div className="calendar-section-head">
            <strong>Conversation calendar</strong>
            <span>{linkedConversationItems.length} linked</span>
          </div>
          <div className="calendar-upcoming-list">
            {linkedConversationItems.length ? (
              linkedConversationItems.map((entry) => (
                <div key={entry.id} className="calendar-upcoming-item">
                  <div className="calendar-upcoming-copy">
                    <strong>{entry.title}</strong>
                    <span>
                      {formatDisplayDate(entry.date)} at {formatClockTime(entry.time)}
                      {entry.linkedMessageText ? " · linked message" : ""}
                    </span>
                  </div>
                  <button
                    className="ghost-button subtle-button compact"
                    type="button"
                    onClick={() =>
                      onEventsChange((current) => current.filter((event) => event.id !== entry.id))
                    }
                  >
                    Remove
                  </button>
                </div>
              ))
            ) : (
              <p className="calendar-upcoming-empty">No calendar items linked to this conversation yet.</p>
            )}
          </div>
        </section>
      ) : null}

      {activeContact ? (
        <section className="calendar-suggestions">
          <div className="calendar-section-head">
            <strong>Suggested meeting slots</strong>
            <span>Based on current schedule</span>
          </div>
          <div className="calendar-busy-list">
            {suggestedSlots.length ? (
              suggestedSlots.map((slot) => (
                <button
                  key={`${slot.date}-${slot.time}`}
                  className="calendar-busy-chip calendar-slot-chip"
                  type="button"
                  onClick={() => handleApplySuggestedSlot(slot)}
                >
                  {formatDisplayDate(slot.date)} {formatClockTime(slot.time)}
                </button>
              ))
            ) : (
              <span className="calendar-busy-chip is-empty">No free slots found this week.</span>
            )}
          </div>
        </section>
      ) : null}

      {recentMessages.length ? (
        <section className="calendar-message-source">
          <div className="calendar-section-head">
            <strong>Recent messages to plan from</strong>
            <span>{recentMessages.length} options</span>
          </div>
          <div className="calendar-upcoming-list">
            {recentMessages.map((message) => (
              <div key={message.id} className="calendar-upcoming-item">
                <strong>{message.text || message.attachment?.name || "Attachment"}</strong>
                <span>{message.createdAt ? getRelativeLabel(message.createdAt) : "Recent"}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <div className="calendar-search-row">
        <input
          className="calendar-search-input"
          type="search"
          placeholder="Search events, notes, attendees"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
        />
        <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
          <option value="all">All types</option>
          {EVENT_TYPES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="all">All states</option>
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select value={visibilityFilter} onChange={(event) => setVisibilityFilter(event.target.value)}>
          <option value="all">All visibility</option>
          {VISIBILITY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="calendar-month-label">
        {viewMode === "month" ? getMonthLabel(visibleMonth) : getDayLabel(selectedDate)}
      </div>

      {viewMode === "month" ? (
        <>
          <div className="calendar-weekdays" aria-hidden="true">
            {WEEKDAY_LABELS.map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
          <div className="calendar-grid" role="grid" aria-label={getMonthLabel(visibleMonth)}>
            {monthCells.map((cell) => (
              <button
                key={cell.dateKey}
                type="button"
                className={`calendar-day ${cell.isCurrentMonth ? "" : "is-outside"} ${cell.isToday ? "is-today" : ""} ${cell.isSelected ? "is-selected" : ""}`}
                onClick={() => handleSelectDate(cell.dateKey)}
              >
                <span>{cell.day}</span>
                {cell.hasEvents ? <small /> : null}
              </button>
            ))}
          </div>
        </>
      ) : null}

      {viewMode === "week" ? (
        <section className="calendar-week-board">
          {weekDateKeys.map((dateKey) => (
            <button
              key={dateKey}
              type="button"
              className={`calendar-week-card ${dateKey === selectedDate ? "is-selected" : ""}`}
              onClick={() => handleSelectDate(dateKey)}
            >
              <strong>{WEEKDAY_LABELS[dateKeyToDate(dateKey).getDay()]}</strong>
              <span>{formatDisplayDate(dateKey)}</span>
              <small>{(groupedVisibleOccurrences[dateKey] || []).length} items</small>
            </button>
          ))}
        </section>
      ) : null}

      {viewMode === "day" ? (
        <section className="calendar-day-strip">
          <div>
            <strong>{getDayLabel(selectedDate)}</strong>
            <span>{selectedOccurrences.length} scheduled</span>
          </div>
          <div className="calendar-busy-badges">
            <span>{busySummary.busyHours}h busy</span>
            <span>{busySummary.freeHours}h free</span>
          </div>
        </section>
      ) : null}

      <section className="calendar-agenda">
        <div className="calendar-section-head">
          <strong>{getDayLabel(selectedDate)}</strong>
          <span>{selectedOccurrences.length} visible</span>
        </div>
        {selectedOccurrences.length ? (
          <div className="calendar-event-list">
            {selectedOccurrences.map((entry) => (
              <article key={entry.occurrenceId} className={`calendar-event-card is-${entry.type}`}>
                <div className="calendar-event-time">{formatTimeRange(entry.time, entry.endTime)}</div>
                <div className="calendar-event-copy">
                  <strong>{entry.title}</strong>
                  <span>
                    {entry.type} · {entry.status}
                    {entry.recurrence !== "none" ? ` · repeats ${entry.recurrence}` : ""}
                  </span>
                  {entry.attendees ? <span>With {entry.attendees}</span> : null}
                  {entry.location ? <span>At {entry.location}</span> : null}
                  {entry.linkedMessageText ? <span>From message: {entry.linkedMessageText}</span> : null}
                  {entry.note ? <p>{entry.note}</p> : null}
                </div>
                <div className="calendar-event-actions">
                  <button className="ghost-button subtle-button compact" type="button" onClick={() => handleEditOccurrence(entry)}>
                    Edit
                  </button>
                  <button className="ghost-button subtle-button compact" type="button" onClick={() => handleRemoveOccurrence(entry)}>
                    Remove
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="calendar-empty-state">
            <strong>No matching events on this day</strong>
            <p>Use the form to schedule work, reminders, or a chat-linked meeting.</p>
          </div>
        )}
      </section>

      <section className="calendar-availability">
        <div className="calendar-section-head">
          <strong>Availability</strong>
          <span>{busySummary.blocks.length} busy blocks</span>
        </div>
        <div className="calendar-availability-grid">
          <div>
            <strong>{busySummary.busyHours}h</strong>
            <span>Busy time</span>
          </div>
          <div>
            <strong>{busySummary.freeHours}h</strong>
            <span>Free time</span>
          </div>
          <div>
            <strong>{formatClockTime(`${WORKDAY_START_HOUR}:00`)} - {formatClockTime(`${WORKDAY_END_HOUR}:00`)}</strong>
            <span>Workday window</span>
          </div>
        </div>
        <div className="calendar-busy-list">
          {busySummary.blocks.length ? (
            busySummary.blocks.map((block) => (
              <span key={block} className="calendar-busy-chip">
                {block}
              </span>
            ))
          ) : (
            <span className="calendar-busy-chip is-empty">No busy blocks</span>
          )}
        </div>
      </section>

      <form className="calendar-form" onSubmit={handleSaveEvent}>
        <div className="calendar-section-head">
          <strong>{editingEventId ? "Edit event" : "Create event"}</strong>
          {editingEventId ? (
            <button className="ghost-button subtle-button compact" type="button" onClick={() => resetDraft(selectedDate)}>
              Cancel edit
            </button>
          ) : null}
        </div>
        <label>
          <span>Title</span>
          <input
            type="text"
            value={draft.title}
            onChange={(event) => handleDraftChange("title", event.target.value)}
            placeholder={activeContact ? `Meeting with ${activeContact.displayName || activeContact.name}` : "Add event title"}
          />
        </label>
        <div className="calendar-form-row">
          <label>
            <span>Date</span>
            <input type="date" value={draft.date} onChange={(event) => handleDraftChange("date", event.target.value)} />
          </label>
          <label>
            <span>Type</span>
            <select value={draft.type} onChange={(event) => handleDraftChange("type", event.target.value)}>
              {EVENT_TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="calendar-form-row">
          <label>
            <span>Start</span>
            <input type="time" value={draft.time} onChange={(event) => handleDraftChange("time", event.target.value)} />
          </label>
          <label>
            <span>End</span>
            <input type="time" value={draft.endTime} onChange={(event) => handleDraftChange("endTime", event.target.value)} />
          </label>
        </div>
        <div className="calendar-form-row">
          <label>
            <span>Reminder</span>
            <select
              value={draft.reminderMinutes}
              onChange={(event) => handleDraftChange("reminderMinutes", Number(event.target.value))}
            >
              {REMINDER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Repeat</span>
            <select value={draft.recurrence} onChange={(event) => handleDraftChange("recurrence", event.target.value)}>
              {RECURRENCE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {draft.recurrence !== "none" ? (
          <label>
            <span>Repeat until</span>
            <input
              type="date"
              value={draft.recurrenceUntil}
              onChange={(event) => handleDraftChange("recurrenceUntil", event.target.value)}
            />
          </label>
        ) : null}
        <div className="calendar-form-row">
          <label>
            <span>Status</span>
            <select value={draft.status} onChange={(event) => handleDraftChange("status", event.target.value)}>
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Visibility</span>
            <select value={draft.visibility} onChange={(event) => handleDraftChange("visibility", event.target.value)}>
              {VISIBILITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          <span>Attendees</span>
          <input
            type="text"
            value={draft.attendees}
            onChange={(event) => handleDraftChange("attendees", event.target.value)}
            placeholder="Name or group"
          />
        </label>
        <label>
          <span>Location</span>
          <input
            type="text"
            value={draft.location}
            onChange={(event) => handleDraftChange("location", event.target.value)}
            placeholder="Room, link, or workspace area"
          />
        </label>
        <label>
          <span>Note</span>
          <textarea
            value={draft.note}
            onChange={(event) => handleDraftChange("note", event.target.value)}
            placeholder="Agenda, reminder, or follow-up note"
            rows={3}
          />
        </label>
        <div className="calendar-form-actions">
          <button className="ghost-button compact-header-toggle calendar-save-button" type="submit">
            {editingEventId ? "Update event" : "Save event"}
          </button>
          <span className="calendar-form-hint">
            {draft.reminderMinutes > 0 ? `Reminder set ${draft.reminderMinutes} min before.` : "No reminder set."}
          </span>
        </div>
      </form>

      <section className="calendar-reminders">
        <div className="calendar-section-head">
          <strong>Reminder queue</strong>
          <span>{reminders.length} due soon</span>
        </div>
        <div className="calendar-upcoming-list">
          {reminders.length ? (
            reminders.map((entry) => (
              <div key={entry.occurrenceId} className="calendar-upcoming-item">
                <strong>{entry.title}</strong>
                <span>
                  Remind {getRelativeLabel(entry.reminderAt)} · {formatDisplayDate(entry.date)} {formatClockTime(entry.time)}
                  {entry.contactName ? ` · ${entry.contactName}` : ""}
                </span>
              </div>
            ))
          ) : (
            <p className="calendar-upcoming-empty">No reminders in the next 36 hours.</p>
          )}
        </div>
      </section>

      <section className="calendar-upcoming">
        <div className="calendar-section-head">
          <strong>Upcoming</strong>
          <span>{upcomingEvents.length} scheduled</span>
        </div>
        <div className="calendar-upcoming-list">
          {upcomingEvents.length ? (
            upcomingEvents.map((entry) => (
              <div key={entry.occurrenceId} className="calendar-upcoming-item">
                <strong>{entry.title}</strong>
                <span>
                  {formatDisplayDate(entry.date)} at {formatClockTime(entry.time)}
                  {entry.attendees ? ` · ${entry.attendees}` : ""}
                </span>
              </div>
            ))
          ) : (
            <p className="calendar-upcoming-empty">No upcoming events yet.</p>
          )}
        </div>
      </section>
    </section>
  );
}
