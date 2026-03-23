import SnapWindowMockup from "./SnapWindowMockup";

function getRecipientName() {
  const params = new URLSearchParams(window.location.search);
  return params.get("recipient") || "";
}

function getSessionId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("session") || "";
}

export function GhostingRoute() {
  const recipientName = getRecipientName();
  const sessionId = getSessionId();

  async function handleSendSnap(payload) {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(
        {
          type: "ghosting:snap",
          sessionId,
          payload
        },
        window.location.origin
      );
    }

    return true;
  }

  return (
    <SnapWindowMockup
      isOpen
      recipientName={recipientName}
      onClose={() => {
        window.close();
      }}
      onSendSnap={handleSendSnap}
    />
  );
}
