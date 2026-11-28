const $ = (id) => document.getElementById(id);
const dialog = $("settings");
const pill = $("pill");
const pillText = $("pill-text");
const detail = $("detail");
const power = $("power");
const powerLabel = $("power-label");
const meter = $("meter");
const levelText = $("level-text");

const GLOW = { WHITE: "#f5f5f0", BLUE: "#2f7bff", GREEN: "#22c55e", RED: "#ef4444", PURPLE: "#a855f7" };
const NAMES = { WHITE: "White", BLUE: "Blue", GREEN: "Green", RED: "Red", PURPLE: "Purple", OFF: "Off", UP: "Brighter", DN: "Dimmer" };

// Small per-device memory of what the app last set (localStorage can fail; ignore if so).
function remember(key, value) { try { localStorage.setItem(key, value); } catch {} }
function recall(key) { try { return localStorage.getItem(key); } catch { return null; } }

function getConfig() {
  return {
    url: recall("myLightsUrl") || window.location.origin,
    token: recall("myLightsToken") || ""
  };
}

function setPill(state, text, note = "") {
  pill.className = "pill " + state;
  pillText.textContent = text;
  detail.textContent = note;
}

// Meter
for (let i = 0; i < 10; i++) {
  const seg = document.createElement("i");
  seg.style.backgroundPosition = (i * 11.1) + "% 0";
  meter.appendChild(seg);
}
function showLevel(level) {
  const n = Number(level);
  if (!n) { levelText.textContent = "—"; return; }
  levelText.textContent = n + "%";
  [...meter.children].forEach((seg, i) => seg.classList.toggle("on", i < n / 10));
}

// Power button and selected color
function showLight(color, isOn) {
  document.querySelectorAll(".swatch").forEach(s => s.classList.toggle("selected", isOn && s.dataset.command === color));
  power.classList.toggle("off", !isOn);
  power.setAttribute("aria-label", isOn ? "Turn light off" : "Turn light on (white)");
  powerLabel.textContent = isOn ? "On" : "Off";
  document.documentElement.style.setProperty("--glow", GLOW[color] || GLOW.WHITE);
}
function restoreLight() {
  showLight(recall("myLightsColor") || "WHITE", recall("myLightsOn") !== "0");
}

async function refreshStatus() {
  try {
    const response = await fetch(getConfig().url + "/api/health", { cache: "no-store" });
    const status = await response.json();
    if (status.level) showLevel(status.level);
    if (!getConfig().token) {
      setPill("bad", "Token needed", "Open Connection settings and enter your app token.");
    } else if (status.alexaConnected) {
      setPill("ok", "Connected");
    } else {
      setPill("bad", "Not linked", "Link the My Lights skill in the Alexa app.");
    }
  } catch {
    setPill("bad", "Offline", "Can't reach the My Lights server. Check your connection.");
  }
}

async function send(command, button) {
  const c = getConfig();
  if (!c.token) {
    setPill("bad", "Token needed", "Open Connection settings and enter your app token.");
    button.classList.add("shake");
    setTimeout(() => button.classList.remove("shake"), 450);
    return;
  }
  setPill("busy", "Sending " + NAMES[command] + "…");
  try {
    const response = await fetch(c.url + "/api/command", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + c.token },
      body: JSON.stringify({ command })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Server returned " + response.status);

    if (command === "OFF") {
      remember("myLightsOn", "0");
    } else {
      remember("myLightsOn", "1");
      if (GLOW[command]) remember("myLightsColor", command);
    }
    if (command === "WHITE") showLevel(100);
    if (result.level) showLevel(result.level);
    restoreLight();

    const target = button.querySelector(".chip") || button;
    target.classList.remove("flash"); void target.offsetWidth; target.classList.add("flash");
    setPill("ok", result.level ? "Brightness " + result.level + "%" : NAMES[command] + " sent");
    setTimeout(() => { if (pill.classList.contains("ok")) setPill("ok", "Connected"); }, 2500);
  } catch (error) {
    setPill("bad", "Didn't send", error.message);
    button.classList.add("shake");
    setTimeout(() => button.classList.remove("shake"), 450);
  }
}

document.querySelectorAll("[data-command]").forEach(button => {
  button.addEventListener("click", () => send(button.dataset.command, button));
});
power.addEventListener("click", () => send(power.classList.contains("off") ? "WHITE" : "OFF", power));

// Settings dialog
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
    setPill("bad", "HTTPS required", "Use a secure https:// backend address.");
    return;
  }
  remember("myLightsUrl", url);
  remember("myLightsToken", token);
  dialog.close();
  refreshStatus();
});
$("clear-settings").addEventListener("click", () => {
  try { localStorage.removeItem("myLightsUrl"); localStorage.removeItem("myLightsToken"); } catch {}
  $("api-url").value = window.location.origin;
  $("api-token").value = "";
  refreshStatus();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
restoreLight();
refreshStatus();
document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshStatus(); });
