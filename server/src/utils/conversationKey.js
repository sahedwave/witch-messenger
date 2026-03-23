export function buildConversationKey(userA, userB) {
  return [userA.toString(), userB.toString()].sort().join(":");
}

