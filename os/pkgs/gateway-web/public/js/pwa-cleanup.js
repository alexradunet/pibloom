export function cleanupOldPwaState(log = () => {}) {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.getRegistrations()
      .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
      .then((results) => {
        if (results.some(Boolean)) log("old service workers unregistered");
      })
      .catch((error) => log("service worker cleanup failed", error.message));
  }

  if (!("caches" in window)) return;
  caches.keys()
    .then((names) => Promise.all(names
      .filter((name) => name.startsWith("ownloom-gateway-web-"))
      .map((name) => caches.delete(name))))
    .then((results) => {
      if (results.some(Boolean)) log("old pwa caches cleared");
    })
    .catch((error) => log("pwa cache cleanup failed", error.message));
}
