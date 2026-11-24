const $ = (id) => document.getElementById(id);
const dialog = $("settings");
const title = $("status-title");
const detail = $("status-detail");

function getConfig() {
  return {
    url: localStorage.getItem("myLightsUrl") || "",
    token: localStorage.getItem("myLightsToken") || ""
  };
}
function setStatus(main, sub) {
  title.textContent = main;
  detail.textContent = sub;
}
$("open-settings").addEventListener("click", () => {
  const c = getConfig();
  $("api-url").value = c.url;
  $("api-token").value = c.token;
  dialog.showModal();
});
$("save-settings").addEventListener("click", () => {
  const url = $("api-url").value.trim().replace(/\\/+$/, "");
  const token = $("api-token").value.trim();
  if (url && !url.startsWith("https://")) {
    setStatus("HTTPS required", "Use a secure https:// backend address.");
    return;
  }
  localStorage.setItem("myLightsUrl", url);
  localStorage.setItem("myLightsToken", token);
  dialog.close();
  setStatus(url && token ? "Connection details saved" : "Not connected yet",
    "The Alexa service still needs to be built and connected.");
});
$("clear-settings").addEventListener("click", () => {
  localStorage.removeItem("myLightsUrl");
  localStorage.removeItem("myLightsToken");
  $("api-url").value = "";
  $("api-token").value = "";
  setStatus("Not connected yet", "Connection settings cleared.");
});
document.querySelectorAll("[data-command]").forEach(button => {
  button.addEventListener("click", async () => {
    const command = button.dataset.command;
    const c = getConfig();
    if (!c.url || !c.token) {
      setStatus(`${command} selected — not connected`, "The app interface is ready, but Alexa integration has not been configured.");
      return;
    }
    setStatus(`Sending ${command}…`, "Contacting your cloud service.");
    try {
      const response = await fetch(`${c.url}/api/command`, {
        method: "POST",
        headers: {"Content-Type":"application/json","Authorization":`Bearer ${c.token}`},
        body: JSON.stringify({command})
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `Server returned ${response.status}`);
      setStatus(`${command} request accepted`, result.message || "The cloud service accepted the request.");
    } catch (error) {
      setStatus("Could not send command", error.message);
    }
  });
});
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
