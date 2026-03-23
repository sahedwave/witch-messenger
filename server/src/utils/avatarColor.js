const palette = [
  "#0084ff",
  "#1f7a8c",
  "#ff6b6b",
  "#7b2cbf",
  "#2a9d8f",
  "#e76f51",
  "#264653",
  "#f4a261"
];

export function pickAvatarColor(seed = "") {
  const hash = [...seed].reduce((total, character) => total + character.charCodeAt(0), 0);
  return palette[hash % palette.length];
}

