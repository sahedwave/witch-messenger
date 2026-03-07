export async function sendTransactionalEmail({ to, subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    return { delivered: false, reason: "email_not_configured" };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html,
      text
    })
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Email delivery failed.");
    throw new Error(errorText || "Email delivery failed.");
  }

  return { delivered: true };
}
