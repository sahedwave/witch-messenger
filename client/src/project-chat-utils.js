export function getExternalTeamMemberCount(team = []) {
  if (!Array.isArray(team)) {
    return 0;
  }

  return team.filter((member) => !member.contactId).length;
}

export function canUseProjectChat(team = []) {
  return getExternalTeamMemberCount(team) < 2;
}
