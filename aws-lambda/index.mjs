const WORKER_PATH = "/alexa-bridge";

export const handler = async (event) => {
  const workerBaseUrl = process.env.WORKER_URL;
  const bridgeSecret = process.env.ALEXA_BRIDGE_SECRET;

  if (!workerBaseUrl || !bridgeSecret) {
    throw new Error("WORKER_URL and ALEXA_BRIDGE_SECRET Lambda environment variables are required.");
  }

  if (!event || typeof event !== "object" || !event.directive?.header?.namespace || !event.directive?.header?.name) {
    throw new Error("The Alexa Smart Home request envelope is missing its directive header.");
  }

  const target = new URL(WORKER_PATH, workerBaseUrl);
  if (target.protocol !== "https:") {
    throw new Error("WORKER_URL must use HTTPS.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6500);

  try {
    const response = await fetch(target, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-my-lights-bridge-secret": bridgeSecret
      },
      body: JSON.stringify(event),
      signal: controller.signal
    });

    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(`Cloudflare Worker returned HTTP ${response.status}: ${responseText.slice(0, 400)}`);
    }

    try {
      return JSON.parse(responseText);
    } catch {
      throw new Error("Cloudflare Worker returned invalid JSON.");
    }
  } finally {
    clearTimeout(timeout);
  }
};
