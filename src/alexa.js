import { SkillRequestSignatureVerifier } from "ask-sdk-express-adapter";

const EVENT_GATEWAY_URL = "https://api.amazonalexa.com/v3/events";
const LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token";
const ACCOUNT_KEY = "alexa:owner";
const PULSE_MS = 1800;

const SENSORS = [
  { id: "my-lights-white", command: "WHITE", name: "My Lights White" },
  { id: "my-lights-blue", command: "BLUE", name: "My Lights Blue" },
  { id: "my-lights-off", command: "OFF", name: "My Lights Off" }
];

const signatureVerifier = new SkillRequestSignatureVerifier();

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

async function readAccount(env) {
  if (!kvReady(env)) return null;
  return await env.MY_LIGHTS_KV.get(ACCOUNT_KEY, "json");
}

async function saveAccount(env, account) {
  if (!kvReady(env)) throw new Error("Cloudflare KV binding MY_LIGHTS_KV is missing.");
  await env.MY_LIGHTS_KV.put(ACCOUNT_KEY, JSON.stringify(account));
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
    client_id: env.ALEXA_SKILL_CLIENT_ID,
    client_secret: env.ALEXA_SKILL_CLIENT_SECRET
  });

  const response = await fetch(LWA_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token || !data.refresh_token) {
    throw new Error("Amazon did not issue Alexa Event Gateway tokens.");
  }
  return data;
}

async function refreshGatewayToken(env, account) {
  if (!account?.refreshToken || !env.ALEXA_SKILL_CLIENT_ID || !env.ALEXA_SKILL_CLIENT_SECRET) {
    throw new Error("Alexa Event Gateway refresh credentials are unavailable.");
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: account.refreshToken,
    client_id: env.ALEXA_SKILL_CLIENT_ID,
    client_secret: env.ALEXA_SKILL_CLIENT_SECRET
  });

  const response = await fetch(LWA_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error("Amazon could not refresh the Alexa Event Gateway token.");
  }

  const updated = {
    ...account,
    accessToken: data.access_token,
    refreshToken: data.refresh_token || account.refreshToken,
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000
  };
  await saveAccount(env, updated);
  return updated;
}

async function currentGatewayAccount(env, account) {
  if (!account?.accessToken) throw new Error("Alexa is not linked yet.");
  if (!account.expiresAt || Date.now() > account.expiresAt - 60000) {
    return await refreshGatewayToken(env, account);
  }
  return account;
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
    current = await refreshGatewayToken(env, current);
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

function verifyDateHeader(request) {
  const rawDate = request.headers.get("date");
  if (!rawDate) throw new Error("Alexa Date header is missing.");
  const parsed = Date.parse(rawDate);
  if (!Number.isFinite(parsed) || Math.abs(Date.now() - parsed) > 150000) {
    throw new Error("Alexa request timestamp is outside the allowed 150-second window.");
  }
}

async function verifyAlexaRequest(request, rawBody) {
  const headers = Object.fromEntries(request.headers.entries());
  await signatureVerifier.verify(rawBody, headers);
  verifyDateHeader(request);
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
      await saveAccount(env, {
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
    if (kvReady(env)) await env.MY_LIGHTS_KV.delete(ACCOUNT_KEY);
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
  if (!account?.accountLinkToken || !suppliedToken || suppliedToken !== account.accountLinkToken) {
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

export async function handleAlexaRequest(request, env) {
  if (request.method !== "POST") {
    return okJson({ error: "Method not allowed" }, 405);
  }
  if (!kvReady(env)) {
    return okJson({ error: "Cloudflare KV binding MY_LIGHTS_KV is not configured." }, 503);
  }

  const rawBody = await request.text();
  if (rawBody.length > 256000) return okJson({ error: "Request body too large." }, 413);

  try {
    await verifyAlexaRequest(request, rawBody);
  } catch (error) {
    console.error("Rejected unsigned or invalid Alexa request:", error.message);
    return okJson({ error: "Invalid Alexa request signature or timestamp." }, 400);
  }

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

export async function alexaStatus(env) {
  const account = await readAccount(env);
  return {
    linked: Boolean(account?.accountLinkToken && account?.refreshToken),
    sensorCount: SENSORS.length,
    sensors: SENSORS.map(sensor => ({ id: sensor.id, name: sensor.name }))
  };
}
