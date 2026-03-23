window.addEventListener("error", (event) => {
  console.error("Client error", event.error || event.message);
});

window.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled promise rejection", event.reason);
});
