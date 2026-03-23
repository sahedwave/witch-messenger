import webpush from "web-push";

import { User } from "../models/User.js";

const DEFAULT_VAPID_PUBLIC_KEY = "BIhI4UgG2EhvuWP7wxrMw5jSNzBoJqfTp51S-DeWe4CicXy-A3Beplfktq38wuTYZUMZw8s8YhMR3m7evwUhsFc";
const DEFAULT_VAPID_PRIVATE_KEY = "7KelYDMLxIiyUerogxpFqCqISHc2GfQgn8nHXE6osV0";

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || DEFAULT_VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || DEFAULT_VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:noreply@witch.local";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

export function getPushPublicKey() {
  return VAPID_PUBLIC_KEY;
}

export function normalizePushSubscription(subscription = {}) {
  return {
    endpoint: subscription.endpoint,
    expirationTime: subscription.expirationTime || null,
    keys: {
      p256dh: subscription.keys?.p256dh || "",
      auth: subscription.keys?.auth || ""
    }
  };
}

export function isValidPushSubscription(subscription = {}) {
  return Boolean(
    subscription.endpoint &&
      subscription.keys?.p256dh &&
      subscription.keys?.auth
  );
}

export async function addPushSubscriptionToUser(user, subscription, metadata = {}) {
  const normalized = normalizePushSubscription(subscription);

  if (!isValidPushSubscription(normalized)) {
    throw new Error("Push subscription is invalid.");
  }

  const existing = (user.pushSubscriptions || []).find(
    (entry) => entry.endpoint === normalized.endpoint
  );

  if (existing) {
    existing.expirationTime = normalized.expirationTime;
    existing.keys = normalized.keys;
    existing.userAgent = metadata.userAgent || existing.userAgent || "";
    existing.lastUsedAt = new Date();
  } else {
    user.pushSubscriptions.push({
      ...normalized,
      userAgent: metadata.userAgent || "",
      createdAt: new Date(),
      lastUsedAt: new Date()
    });
  }

  await user.save();
}

export async function removePushSubscriptionFromUser(user, endpoint) {
  user.pushSubscriptions = (user.pushSubscriptions || []).filter(
    (entry) => entry.endpoint !== endpoint
  );
  await user.save();
}

export async function sendPushNotification(userId, payload) {
  const user = await User.findById(userId);

  if (!user || !(user.pushSubscriptions || []).length) {
    return;
  }

  const activeSubscriptions = [];

  await Promise.all(
    user.pushSubscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          normalizePushSubscription(subscription),
          JSON.stringify(payload)
        );
        subscription.lastUsedAt = new Date();
        activeSubscriptions.push(subscription);
      } catch (error) {
        const statusCode = error?.statusCode || 0;
        if (statusCode !== 404 && statusCode !== 410) {
          activeSubscriptions.push(subscription);
        }
      }
    })
  );

  user.pushSubscriptions = activeSubscriptions;
  await user.save();
}
