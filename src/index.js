import { handleAlexaBridgeRequest, runAppCommand, alexaStatus, APP_COMMANDS } from "./alexa.js";

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
      if (!APP_COMMANDS.includes(command)) {
        return json({ error: `Command must be one of: ${APP_COMMANDS.join(", ")}.` }, 400);
      }
      if (!env.MY_LIGHTS_KV) {
        return json({ error: "Cloudflare KV storage MY_LIGHTS_KV has not been configured." }, 503);
      }

      try {
        const result = await runAppCommand(env, ctx, command);
        return json(result);
      } catch (error) {
        const message = error && error.message ? error.message : "Alexa could not accept the routine trigger.";
        console.error("My Lights command failed:", message);
        const status = message.includes("not been linked") ? 409 : 502;
        return json({ error: message }, status);
      }
    }

    if (url.pathname === "/privacy" || url.pathname === "/privacy/") {
      const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>My Lights — Privacy Notice</title>
<style>
body{font:16px/1.65 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:760px;margin:48px auto;padding:0 22px;color:#202124}
h1{line-height:1.2}h2{margin-top:2em}.updated{color:#666;font-size:.92rem}
</style>
</head>
<body>
<h1>My Lights — Privacy Notice</h1>
<p class="updated">Last updated: November 23, 2026</p>
<p>My Lights is a personal smart-lighting controller that connects an Amazon Alexa account to a web application so its controls can trigger lighting routines through Alexa.</p>
<h2>Information processed</h2>
<p>To provide account linking and operate the integration, My Lights may process an Amazon account identifier and authorization tokens issued by Amazon during account linking. It also processes Alexa directives and event messages needed to discover the integration's devices and trigger configured lighting routines.</p>
<h2>How information is used</h2>
<p>This information is used only to authenticate the Alexa connection, receive authorized Alexa requests, and send lighting events needed to operate the service. My Lights does not sell personal information or use it for advertising.</p>
<h2>Storage and service providers</h2>
<p>Integration credentials and related connection data are stored by the service in Cloudflare Workers KV. The application is hosted using Cloudflare, and Alexa account linking and smart-home messaging are provided by Amazon. These providers process information as necessary to deliver their services under their own terms and privacy practices.</p>
<h2>Sharing</h2>
<p>My Lights does not rent or sell personal information. Information is shared with Amazon and Cloudflare only as needed to provide account linking, hosting, and requested smart-lighting functionality, or when required by law.</p>
<h2>Retention and disconnecting</h2>
<p>Connection information is retained while needed to operate the linked service. You can disconnect My Lights in the Alexa app's skill settings. Amazon's account-linking revocation process notifies the service when authorization is revoked, and associated connection data can then be removed.</p>
<h2>Security</h2>
<p>The service uses authorization credentials and server-side secrets to protect requests between its components. No internet service can guarantee absolute security.</p>
<h2>Children</h2>
<p>My Lights is not designed for children and is not intended to collect personal information from children.</p>
<h2>Changes</h2>
<p>This notice may be updated as the service changes. The date above indicates when it was last revised.</p>
<h2>Privacy questions</h2>
<p>For privacy questions or requests concerning information associated with your My Lights connection, use the developer contact/support information provided with the My Lights Alexa skill.</p>
</body></html>`;
      return new Response(html, {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }
      });
    }

    if (url.pathname.startsWith("/api/")) return json({ error: "Not found" }, 404);
    return env.ASSETS.fetch(request);
  }
};
