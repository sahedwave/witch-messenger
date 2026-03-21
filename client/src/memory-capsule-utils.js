export const MEMORY_CAPSULE_STORAGE_KEY = "messenger-mvp-memory-capsules";

export function readMemoryCapsules() {
  try {
    const raw = window.localStorage.getItem(MEMORY_CAPSULE_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

export function writeMemoryCapsules(items) {
  window.localStorage.setItem(MEMORY_CAPSULE_STORAGE_KEY, JSON.stringify(items));
}

export function formatDisplayDate(value) {
  const [year = "", month = "", day = ""] = String(value || "").split("-");
  return day && month && year ? `${day}/${month}/${year}` : value;
}

export function formatClockTime(timeValue) {
  const [hourText = "0", minuteText = "00"] = String(timeValue || "00:00").split(":");
  let hour = Number(hourText);
  const suffix = hour >= 12 ? "PM" : "AM";
  hour = hour % 12 || 12;
  return `${hour}:${minuteText} ${suffix}`;
}

export function buildMemoryCapsuleDraft(activeContact) {
  const unlock = new Date();
  unlock.setDate(unlock.getDate() + 7);

  return {
    id: null,
    contactId: activeContact?.id || null,
    contactName: activeContact?.displayName || activeContact?.name || "",
    title: "",
    note: "",
    unlockDate: unlock.toISOString().slice(0, 10),
    unlockTime: "09:00",
    tone: "warm",
    status: "locked",
    openedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

export function getUnlockAt(capsule) {
  return new Date(`${capsule.unlockDate}T${capsule.unlockTime || "00:00"}`).toISOString();
}

export function getMemoryCapsuleState(capsule, now = Date.now()) {
  if (capsule.status === "opened" || capsule.openedAt) {
    return "opened";
  }

  const unlockAt = new Date(getUnlockAt(capsule)).getTime();
  return unlockAt <= now ? "ready" : "locked";
}

export function sortMemoryCapsules(items) {
  return [...items].sort((first, second) => new Date(second.updatedAt || second.createdAt) - new Date(first.updatedAt || first.createdAt));
}
