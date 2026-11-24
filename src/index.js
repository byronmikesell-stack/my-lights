import { handleAlexaBridgeRequest, triggerRoutine, alexaStatus } from "./alexa.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

function authorizedAppRequest(request, env) {
  if (!env.APP_TOKEN) return false;
  const authorization = request.headers.get("authorization") || "";
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  return constantTimeEqual(supplied, env.APP_TOKEN);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/alexa-bridge") {
      return await handleAlexaBridgeRequest(request, env);
    }

    if (url.pathname === "/api/health") {
      if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
      const status = await alexaStatus(env);
      return json({
        ok: true,
        service: "my-lights",
        platform: "cloudflare-workers",
        alexaConnected: status.linked,
        sensors: status.sensorCount
      });
    }

    if (url.pathname === "/api/command") {
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
      if (!env.APP_TOKEN) return json({ error: "The app access secret has not been configured." }, 503);
      if (!authorizedAppRequest(request, env)) return json({ error: "Unauthorized" }, 401);

      const contentType = request.headers.get("content-type") || "";
      if (!contentType.toLowerCase().includes("application/json")) {
        return json({ error: "Content-Type must be application/json." }, 415);
      }

      const raw = await request.text();
      if (new TextEncoder().encode(raw).length > 2048) {
        return json({ error: "Request body is too large." }, 413);
      }

      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return json({ error: "Invalid JSON." }, 400);
      }

      const command = body && body.command;
      if (!["WHITE", "BLUE", "OFF"].includes(command)) {
        return json({ error: "Command must be WHITE, BLUE, or OFF." }, 400);
      }
      if (!env.MY_LIGHTS_KV) {
        return json({ error: "Cloudflare KV storage MY_LIGHTS_KV has not been configured." }, 503);
      }

      try {
        const result = await triggerRoutine(env, ctx, command);
        return json(result);
      } catch (error) {
        const message = error && error.message ? error.message : "Alexa could not accept the routine trigger.";
        console.error("My Lights command failed:", message);
        const status = message.includes("not been linked") ? 409 : 502;
        return json({ error: message }, status);
      }
    }

    if (url.pathname.startsWith("/api/")) return json({ error: "Not found" }, 404);
    return env.ASSETS.fetch(request);
  }
};
