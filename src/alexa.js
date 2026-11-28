const EVENT_GATEWAY_URL = "https://api.amazonalexa.com/v3/events";
const LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token";
const ACCOUNT_KEY = "alexa:owner";
const PULSE_MS = 1800;

const LEVELS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]; // must match src/store.js

const SENSORS = [
  { id: "my-lights-white", command: "WHITE", name: "My Lights White" },
  { id: "my-lights-blue", command: "BLUE", name: "My Lights Blue" },
  { id: "my-lights-off", command: "OFF", name: "My Lights Off" },
  { id: "my-lights-green", command: "GREEN", name: "My Lights Green" },
  { id: "my-lights-red", command: "RED", name: "My Lights Red" },
  { id: "my-lights-purple", command: "PURPLE", name: "My Lights Purple" },
  ...LEVELS.map(level => ({
    id: `my-lights-level-${level}`,
    command: `LEVEL_${level}`,
    name: `My Lights Level ${level}`
  }))
];

// Commands the phone app may send. UP and DN step through the LEVEL_ sensors.
export const APP_COMMANDS = ["WHITE", "BLUE", "OFF", "GREEN", "RED", "PURPLE", "UP", "DN"];

function newId() {
  return crypto.randomUUID();
}

function message(header, body = {}) {
  return {
    event: {
      header: {
        namespace: "Alexa",
        name: "ErrorResponse",
        payloadVersion: "3",
        messageId: newId()
      },
      payload: body
    }
  };
}

function alexaError(type, messageText, originalMessageId) {
  return {
    event: {
      header: {
        namespace: "Alexa",
        name: "ErrorResponse",
        payloadVersion: "3",
        messageId: newId(),
        ...(originalMessageId ? { correlationToken: originalMessageId } : {})
      },
      payload: { type, message: messageText }
    }
  };
}

function okJson(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function kvReady(env) {
  return Boolean(env.MY_LIGHTS_KV);
}

function secureEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

// Tokens and brightness live in a Durable Object (src/store.js) so reads are
// never stale and refreshes never overlap.
function store(env) {
  if (!env.LIGHTS_STORE) throw new Error("Durable Object binding LIGHTS_STORE is missing.");
  return env.LIGHTS_STORE.get(env.LIGHTS_STORE.idFromName(ACCOUNT_KEY));
}

async function readAccount(env) {
  return await store(env).getAccount();
}

async function saveAccount(env, account) {
  await store(env).setAccount(account);
}

// Alexa's account-linking token changes every hour, so identify the user by
// their Amazon user_id instead of comparing tokens.
async function amazonUserId(token) {
  if (!token) return "";
  const response = await fetch("https://api.amazon.com/user/profile", {
    headers: { authorization: `Bearer ${token}` }
  });
  if (!response.ok) {
    console.error("Amazon profile lookup failed:", response.status);
    return "";
  }
  const data = await response.json().catch(() => ({}));
  return typeof data.user_id === "string" ? data.user_id : "";
}

function sensorForCommand(command) {
  return SENSORS.find(sensor => sensor.command === command);
}

function sensorForId(endpointId) {
  return SENSORS.find(sensor => sensor.id === endpointId);
}

function sensorCapabilities() {
  return [
    {
      type: "AlexaInterface",
      interface: "Alexa.ContactSensor",
      version: "3",
      properties: {
        supported: [{ name: "detectionState" }],
        proactivelyReported: true,
        retrievable: true
      }
    },
    {
      type: "AlexaInterface",
      interface: "Alexa.EndpointHealth",
      version: "3",
      properties: {
        supported: [{ name: "connectivity" }],
        proactivelyReported: true,
        retrievable: true
      }
    },
    { type: "AlexaInterface", interface: "Alexa", version: "3" }
  ];
}

function discoveryResponse(messageId) {
  return {
    event: {
      header: {
        namespace: "Alexa.Discovery",
        name: "Discover.Response",
        payloadVersion: "3",
        messageId: newId()
      },
      payload: {
        endpoints: SENSORS.map(sensor => ({
          endpointId: sensor.id,
          manufacturerName: "My Lights",
          description: "Virtual button for a My Lights Alexa Routine",
          friendlyName: sensor.name,
          displayCategories: ["CONTACT_SENSOR"],
          cookie: { command: sensor.command },
          capabilities: sensorCapabilities()
        }))
      }
    }
  };
}

function sampledProperty(namespace, name, value) {
  return {
    namespace,
    name,
    value,
    timeOfSample: new Date().toISOString(),
    uncertaintyInMilliseconds: 0
  };
}

async function getSensorState(env, endpointId) {
  if (!kvReady(env)) return "NOT_DETECTED";
  return (await env.MY_LIGHTS_KV.get(`sensor:${endpointId}`)) || "NOT_DETECTED";
}

async function stateReport(env, endpointId, accountLinkToken, correlationToken) {
  const sensor = sensorForId(endpointId);
  if (!sensor) {
    return alexaError("NO_SUCH_ENDPOINT", "The requested sensor does not exist.");
  }
  const state = await getSensorState(env, endpointId);
  return {
    event: {
      header: {
        namespace: "Alexa",
        name: "StateReport",
        payloadVersion: "3",
        messageId: newId(),
        ...(correlationToken ? { correlationToken } : {})
      },
      endpoint: {
        scope: { type: "BearerToken", token: accountLinkToken },
        endpointId
      },
      payload: {}
    },
    context: {
      properties: [
        sampledProperty("Alexa.ContactSensor", "detectionState", state),
        sampledProperty("Alexa.EndpointHealth", "connectivity", { value: "OK" })
      ]
    }
  };
}

async function exchangeGrantCode(env, code) {
  if (!env.ALEXA_SKILL_CLIENT_ID || !env.ALEXA_SKILL_CLIENT_SECRET) {
    throw new Error("ALEXA_SKILL_CLIENT_ID and ALEXA_SKILL_CLIENT_SECRET Worker secrets are not set.");
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: (env.ALEXA_SKILL_CLIENT_ID || "").trim(),
    client_secret: (env.ALEXA_SKILL_CLIENT_SECRET || "").trim()
  });

  const response = await fetch(LWA_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body
  });

  const responseText = await response.text();
  let data = {};
  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch {
    data = {};
  }

  if (!response.ok || !data.access_token || !data.refresh_token) {
    // Log only Amazon's error metadata. Never log the authorization code,
    // client secret, access token, or refresh token.
    const diagnostic = {
      httpStatus: response.status,
      error: typeof data.error === "string" ? data.error : "unknown_error",
      errorDescription: typeof data.error_description === "string"
        ? data.error_description.slice(0, 500)
        : "No error_description was returned.",
      responseIsJson: Boolean(responseText && data && Object.keys(data).length)
    };
    console.error("Alexa LWA authorization-code exchange failed:", JSON.stringify(diagnostic));
    throw new Error(`Amazon token exchange failed (HTTP ${response.status}; ${diagnostic.error}).`);
  }
  return data;
}

async function currentGatewayAccount(env, account) {
  if (!account?.accessToken) throw new Error("Alexa is not linked yet.");
  return await store(env).freshAccount(false);
}

async function sendChangeReport(env, account, sensor, detectionState) {
  let current = await currentGatewayAccount(env, account);
  const makeEvent = token => ({
    event: {
      header: {
        namespace: "Alexa",
        name: "ChangeReport",
        payloadVersion: "3",
        messageId: newId()
      },
      endpoint: {
        scope: { type: "BearerToken", token },
        endpointId: sensor.id
      },
      payload: {
        change: {
          cause: { type: "APP_INTERACTION" },
          properties: [
            sampledProperty("Alexa.ContactSensor", "detectionState", detectionState)
          ]
        }
      }
    },
    context: {
      properties: [
        sampledProperty("Alexa.EndpointHealth", "connectivity", { value: "OK" })
      ]
    }
  });

  const send = token => fetch(EVENT_GATEWAY_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(makeEvent(token))
  });

  let response = await send(current.accessToken);
  if (response.status === 401 && current.refreshToken) {
    const detail = await response.text().catch(() => "");
    console.error("Alexa Event Gateway returned 401 before refresh:", detail.slice(0, 300));
    current = await store(env).freshAccount(true, current.accessToken);
    response = await send(current.accessToken);
  }

  if (response.status !== 202) {
    const detail = await response.text().catch(() => "");
    console.error("Alexa Event Gateway rejected ChangeReport:", response.status, detail.slice(0, 500));
    throw new Error(`Alexa Event Gateway returned HTTP ${response.status}.`);
  }

  await env.MY_LIGHTS_KV.put(`sensor:${sensor.id}`, detectionState);
  return current;
}

function extractBearerScope(directive) {
  const possibleScopes = [
    directive?.payload?.scope,
    directive?.endpoint?.scope
  ];
  return possibleScopes.find(scope => scope?.type === "BearerToken" && scope.token)?.token || "";
}

function extractMessageId(directive) {
  return directive?.header?.messageId || "";
}

async function handleAlexaDirective(directive, env) {
  const header = directive?.header || {};
  const namespace = header.namespace;
  const name = header.name;
  const messageId = header.messageId || "";

  if (namespace === "Alexa.Authorization" && name === "AcceptGrant") {
    const code = directive?.payload?.grant?.code;
    const granteeToken = directive?.payload?.grantee?.token;
    if (!code || !granteeToken) {
      return alexaError("ACCEPT_GRANT_FAILED", "The authorization grant was incomplete.", messageId);
    }
    if (!kvReady(env)) {
      return alexaError("ACCEPT_GRANT_FAILED", "Cloudflare KV storage is not configured yet.", messageId);
    }

    try {
      const tokens = await exchangeGrantCode(env, code);
      const userId = await amazonUserId(granteeToken);
      await saveAccount(env, {
        userId,
        accountLinkToken: granteeToken,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: Date.now() + (Number(tokens.expires_in) || 3600) * 1000,
        linkedAt: new Date().toISOString()
      });
      return {
        event: {
          header: {
            namespace: "Alexa.Authorization",
            name: "AcceptGrant.Response",
            payloadVersion: "3",
            messageId: newId()
          },
          payload: {}
        }
      };
    } catch (error) {
      console.error("Alexa AcceptGrant failed:", error.message);
      return alexaError("ACCEPT_GRANT_FAILED", "My Lights could not complete Alexa authorization.", messageId);
    }
  }

  if (namespace === "Alexa.Authorization" && name === "RevokeAuthorization") {
    await store(env).clearAccount();
    return {
      event: {
        header: {
          namespace: "Alexa.Authorization",
          name: "RevokeAuthorization.Response",
          payloadVersion: "3",
          messageId: newId()
        },
        payload: {}
      }
    };
  }

  const account = await readAccount(env);
  const suppliedToken = extractBearerScope(directive);
  let linked = Boolean(account?.accountLinkToken && suppliedToken);
  if (linked && suppliedToken !== account.accountLinkToken) {
    linked = Boolean(account.userId) && (await amazonUserId(suppliedToken)) === account.userId;
  }
  if (!linked) {
    console.error("Alexa directive rejected: not linked to this Alexa account.", namespace, name);
    return alexaError("INVALID_AUTHORIZATION_CREDENTIAL", "My Lights is not linked to this Alexa account.", messageId);
  }

  if (namespace === "Alexa.Discovery" && name === "Discover") {
    return discoveryResponse(messageId);
  }

  if (namespace === "Alexa" && name === "ReportState") {
    const endpointId = directive?.endpoint?.endpointId;
    return await stateReport(env, endpointId, suppliedToken, header.correlationToken);
  }

  return alexaError("INVALID_DIRECTIVE", "My Lights does not support this Alexa directive.", messageId);
}

export async function handleAlexaBridgeRequest(request, env) {
  if (request.method !== "POST") {
    return okJson({ error: "Method not allowed" }, 405);
  }

  const expectedSecret = env.ALEXA_BRIDGE_SECRET;
  if (!expectedSecret) {
    return okJson({ error: "Alexa bridge secret is not configured." }, 503);
  }
  const suppliedSecret = request.headers.get("x-my-lights-bridge-secret") || "";
  if (!secureEqual(suppliedSecret, expectedSecret)) {
    return okJson({ error: "Unauthorized bridge request." }, 401);
  }

  if (!kvReady(env)) {
    return okJson({ error: "Cloudflare KV binding MY_LIGHTS_KV is not configured." }, 503);
  }

  const rawBody = await request.text();
  if (rawBody.length > 256000) return okJson({ error: "Request body too large." }, 413);

  let envelope;
  try {
    envelope = JSON.parse(rawBody);
  } catch {
    return okJson({ error: "Invalid JSON." }, 400);
  }

  const directive = envelope?.directive;
  if (!directive?.header?.namespace || !directive?.header?.name) {
    return okJson({ error: "Invalid Alexa directive." }, 400);
  }

  const response = await handleAlexaDirective(directive, env);
  return okJson(response);
}

export async function triggerRoutine(env, ctx, command) {
  const sensor = sensorForCommand(command);
  if (!sensor) throw new Error("Unknown lighting command.");

  const account = await readAccount(env);
  if (!account?.accountLinkToken || !account?.accessToken) {
    throw new Error("Alexa has not been linked to My Lights yet.");
  }

  await sendChangeReport(env, account, sensor, "DETECTED");

  const reset = async () => {
    await new Promise(resolve => setTimeout(resolve, PULSE_MS));
    const latest = await readAccount(env);
    if (!latest?.accountLinkToken || latest.accountLinkToken !== account.accountLinkToken) return;
    await sendChangeReport(env, latest, sensor, "NOT_DETECTED");
  };
  ctx.waitUntil(reset());

  return { ok: true, command, sensor: sensor.name, message: "Alexa routine trigger sent." };
}

// UP/DN move the remembered brightness one 10% step and fire that level's
// sensor; every other command fires its own sensor directly.
export async function runAppCommand(env, ctx, command) {
  if (command !== "UP" && command !== "DN") {
    const result = await triggerRoutine(env, ctx, command);
    // WHITE's routine also sets the bulb to 100%, so start stepping from there.
    if (command === "WHITE") await store(env).resetLevel();
    return result;
  }
  const next = await store(env).stepLevel(command);
  const result = await triggerRoutine(env, ctx, `LEVEL_${next}`);
  return { ...result, command, level: next, message: `Brightness set to ${next}%.` };
}

export async function alexaStatus(env) {
  const account = await readAccount(env);
  return {
    linked: Boolean(account?.accountLinkToken && account?.refreshToken),
    sensorCount: SENSORS.length,
    sensors: SENSORS.map(sensor => ({ id: sensor.id, name: sensor.name }))
  };
}
