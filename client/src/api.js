const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5001/api";

async function request(path, options = {}) {
  const { token, body, headers, ...rest } = options;
  const response = await fetch(`${API_URL}${path}`, {
    ...rest,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.message || "Request failed.");
  }

  return payload;
}

export const api = {
  login(credentials) {
    return request("/auth/login", {
      method: "POST",
      body: credentials
    });
  },
  verifyTwoFactor(payload) {
    return request("/auth/verify-2fa", {
      method: "POST",
      body: payload
    });
  },
  register(credentials) {
    return request("/auth/register", {
      method: "POST",
      body: credentials
    });
  },
  getMe(token) {
    return request("/auth/me", { token });
  },
  forgotPassword(email) {
    return request("/auth/forgot-password", {
      method: "POST",
      body: { email }
    });
  },
  resetPassword(payload) {
    return request("/auth/reset-password", {
      method: "POST",
      body: payload
    });
  },
  logout(token) {
    return request("/auth/logout", {
      method: "POST",
      token
    });
  },
  logoutAll(token) {
    return request("/auth/logout-all", {
      method: "POST",
      token
    });
  },
  requestTwoFactorSetup(token) {
    return request("/auth/2fa/request-setup", {
      method: "POST",
      token
    });
  },
  enableTwoFactor(token, code) {
    return request("/auth/2fa/enable", {
      method: "POST",
      token,
      body: { code }
    });
  },
  disableTwoFactor(token) {
    return request("/auth/2fa/disable", {
      method: "POST",
      token
    });
  },
  getUsers(token) {
    return request("/users", { token });
  },
  updateProfile(token, body) {
    return request("/users/me/profile", {
      method: "PATCH",
      token,
      body
    });
  },
  updatePreferences(token, contactId, body) {
    return request(`/users/${contactId}/preferences`, {
      method: "PATCH",
      token,
      body
    });
  },
  getMessages(token, contactId, options = {}) {
    const params = new URLSearchParams();

    if (options.before) {
      params.set("before", options.before);
    }

    if (options.q) {
      params.set("q", options.q);
    }

    if (options.starred) {
      params.set("starred", "true");
    }

    if (options.limit) {
      params.set("limit", String(options.limit));
    }

    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request(`/messages/${contactId}${suffix}`, { token });
  },
  sendMessage(token, contactId, payload) {
    return request(`/messages/${contactId}`, {
      method: "POST",
      token,
      body: payload
    });
  },
  exportMessages(token, contactId) {
    return request(`/messages/${contactId}/export`, { token });
  },
  editMessage(token, messageId, text) {
    return request(`/messages/${messageId}`, {
      method: "PATCH",
      token,
      body: { text }
    });
  },
  deleteMessage(token, messageId) {
    return request(`/messages/${messageId}`, {
      method: "DELETE",
      token
    });
  },
  toggleReaction(token, messageId, emoji) {
    return request(`/messages/${messageId}/reactions`, {
      method: "POST",
      token,
      body: { emoji }
    });
  },
  toggleStar(token, messageId) {
    return request(`/messages/${messageId}/star`, {
      method: "POST",
      token
    });
  },
  togglePinnedMessage(token, messageId) {
    return request(`/messages/${messageId}/pin`, {
      method: "POST",
      token
    });
  },
  markConversationSeen(token, contactId) {
    return request(`/messages/${contactId}/seen`, {
      method: "POST",
      token
    });
  },
  uploadAvatar(token, imageData) {
    return request("/users/avatar", {
      method: "POST",
      token,
      body: { imageData }
    });
  }
};
