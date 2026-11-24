const $ = (id) => document.getElementById(id);
const dialog = $("settings");
const title = $("status-title");
const detail = $("status-detail");

function getConfig() {
  return {
    url: localStorage.getItem("myLightsUrl") || window.location.origin,
    token: localStorage.getItem("myLightsToken") || ""
  };
}
function setStatus(main, sub) {
  title.textContent = main;
  detail.textContent = sub;
}
async function refreshAlexaStatus() {
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    const status = await response.json();
    if (status.alexaConnected) {
      setStatus("Alexa linked", "Your three My Lights routine triggers are ready.");
    } else {
      setStatus("Waiting for Alexa link", "Finish linking the My Lights smart home skill in Alexa to activate the buttons.");
    }
  } catch {
    setStatus("Cloud connection unavailable", "Reload this page to try again.");
  }
}
$("open-settings").addEventListener("click", () => {
  const c = getConfig();
  $("api-url").value = c.url;
  $("api-token").value = c.token;
  dialog.showModal();
});
$("save-settings").addEventListener("click", () => {
  const url = $("api-url").value.trim().replace(/\/+$/, "");
  const token = $("api-token").value.trim();
  if (!url.startsWith("https://")) {
    setStatus("HTTPS required", "Use a secure https:// backend address.");
    return;
  }
  localStorage.setItem("myLightsUrl", url);
  localStorage.setItem("myLightsToken", token);
  dialog.close();
  setStatus(token ? "App access token saved" : "App access token missing",
    "The app uses the same secure access token configured in Cloudflare.");
});
$("clear-settings").addEventListener("click", () => {
  localStorage.removeItem("myLightsUrl");
  localStorage.removeItem("myLightsToken");
  $("api-url").value = window.location.origin;
  $("api-token").value = "";
  setStatus("App access cleared", "Enter your Cloudflare app token in Connection settings.");
});
document.querySelectorAll("[data-command]").forEach(button => {
  button.addEventListener("click", async () => {
    const command = button.dataset.command;
    const c = getConfig();
    if (!c.token) {
      setStatus("App access token needed", "Open Connection settings and enter the APP_TOKEN saved in Cloudflare.");
      return;
    }
    setStatus("Sending " + command + "…", "Sending a momentary trigger to Alexa.");
    try {
      const response = await fetch(c.url + "/api/command", {
        method: "POST",
        headers: {"Content-Type":"application/json","Authorization":"Bearer " + c.token},
        body: JSON.stringify({command})
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Server returned " + response.status);
      setStatus(command + " trigger sent", result.message || "Alexa accepted the routine trigger.");
      window.setTimeout(refreshAlexaStatus, 1200);
    } catch (error) {
      setStatus("Could not send command", error.message);
    }
  });
});
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
window.addEventListener("load", refreshAlexaStatus);
