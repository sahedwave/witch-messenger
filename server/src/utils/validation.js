export function isValidEmail(value = "") {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function validatePassword(password = "") {
  if (password.length < 8) {
    return "Password must be at least 8 characters.";
  }

  if (!/[a-z]/i.test(password) || !/\d/.test(password)) {
    return "Password must include at least one letter and one number.";
  }

  return null;
}

export function validateName(name = "") {
  if (name.length < 2 || name.length > 40) {
    return "Name must be between 2 and 40 characters.";
  }

  return null;
}

export function validateAttachmentData(data = {}, options = {}) {
  if (!data) {
    return null;
  }

  const { dataUrl, mimeType, name, size } = data;
  const isSnap = Boolean(options.isSnap);
  const allowedMimeTypes = [
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
    "application/pdf",
    "text/plain"
  ];
  const allowedSnapMimeTypes = [...allowedMimeTypes, "video/webm", "video/mp4", "video/quicktime"];
  const maxSize = isSnap ? 8 * 1024 * 1024 : 1024 * 1024;

  if (!dataUrl || !mimeType || !name) {
    return "Attachment data is incomplete.";
  }

  if (!(isSnap ? allowedSnapMimeTypes : allowedMimeTypes).includes(mimeType)) {
    return isSnap
      ? "Snaps support PNG, JPG, WEBP, MP4, MOV, and WEBM."
      : "Only PNG, JPG, WEBP, PDF, and TXT attachments are supported.";
  }

  if (!/^data:[a-z0-9/+.-]+;base64,/i.test(dataUrl)) {
    return "Attachment encoding is invalid.";
  }

  if (name.length > 120) {
    return "Attachment file names must be 120 characters or fewer.";
  }

  if (size > maxSize) {
    return isSnap ? "Snaps must be 8 MB or smaller." : "Attachments must be 1 MB or smaller.";
  }

  return null;
}
