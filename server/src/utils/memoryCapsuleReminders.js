import { MemoryCapsule } from "../models/MemoryCapsule.js";
import { sendPushNotification } from "./pushNotifications.js";

const REMINDER_WINDOW_MS = 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 60 * 1000;

function recipientsForCapsule(capsule) {
  if (capsule.privacyMode === "gift") {
    return [capsule.participant._id.toString()];
  }

  return [capsule.initiator._id.toString(), capsule.participant._id.toString()];
}

async function processReminderWindowCapsules(io) {
  const now = new Date();
  const windowEnd = new Date(Date.now() + REMINDER_WINDOW_MS);
  const capsules = await MemoryCapsule.find({
    deletedAt: null,
    openedAt: null,
    reminderNotifiedAt: null,
    unlockAt: { $gt: now, $lte: windowEnd }
  })
    .populate("initiator", "name")
    .populate("participant", "name");

  await Promise.all(
    capsules.map(async (capsule) => {
      const title = capsule.title || "Memory capsule";
      const payload = {
        title: "Memory capsule opening soon",
        body: `${title} is opening within the next hour.`,
        tag: `capsule-reminder-${capsule._id.toString()}`,
        url: "/",
        data: {
          capsuleId: capsule._id.toString()
        }
      };

      await Promise.all(recipientsForCapsule(capsule).map((userId) => sendPushNotification(userId, payload)));
      capsule.reminderNotifiedAt = new Date();
      await capsule.save();

      io.to(capsule.initiator._id.toString()).emit("memory-capsule:changed", {
        action: "reminder",
        capsuleId: capsule._id.toString(),
        contactId: capsule.participant._id.toString(),
        title,
        state: "sealed"
      });
      io.to(capsule.participant._id.toString()).emit("memory-capsule:changed", {
        action: "reminder",
        capsuleId: capsule._id.toString(),
        contactId: capsule.initiator._id.toString(),
        title,
        state: "sealed"
      });
    })
  );
}

async function processReadyCapsules(io) {
  const now = new Date();
  const capsules = await MemoryCapsule.find({
    deletedAt: null,
    openedAt: null,
    readyNotifiedAt: null,
    unlockAt: { $lte: now }
  })
    .populate("initiator", "name")
    .populate("participant", "name");

  await Promise.all(
    capsules.map(async (capsule) => {
      const title = capsule.title || "Memory capsule";
      const payload = {
        title: "Memory capsule is ready",
        body:
          capsule.openMode === "together"
            ? `${title} can be opened now. Both of you need to join.`
            : `${title} can be opened now.`,
        tag: `capsule-ready-${capsule._id.toString()}`,
        url: "/",
        data: {
          capsuleId: capsule._id.toString()
        }
      };

      await Promise.all(recipientsForCapsule(capsule).map((userId) => sendPushNotification(userId, payload)));
      capsule.readyNotifiedAt = new Date();
      await capsule.save();

      io.to(capsule.initiator._id.toString()).emit("memory-capsule:changed", {
        action: "ready",
        capsuleId: capsule._id.toString(),
        contactId: capsule.participant._id.toString(),
        title,
        state: "ready"
      });
      io.to(capsule.participant._id.toString()).emit("memory-capsule:changed", {
        action: "ready",
        capsuleId: capsule._id.toString(),
        contactId: capsule.initiator._id.toString(),
        title,
        state: "ready"
      });
    })
  );
}

export function startMemoryCapsuleReminderLoop(io) {
  let stopped = false;

  async function tick() {
    if (stopped) {
      return;
    }

    try {
      await processReminderWindowCapsules(io);
      await processReadyCapsules(io);
    } catch (error) {
      console.error("Memory capsule reminder loop failed", error);
    }
  }

  void tick();
  const timerId = setInterval(() => {
    void tick();
  }, CHECK_INTERVAL_MS);

  return () => {
    stopped = true;
    clearInterval(timerId);
  };
}
