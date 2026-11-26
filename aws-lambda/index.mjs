const WORKER_PATH = "/alexa-bridge";

export const handler = async (event) => {
  const workerBaseUrl = process.env.WORKER_URL;
  const bridgeSecret = process.env.ALEXA_BRIDGE_SECRET;

  if (!workerBaseUrl || !bridgeSecret) {
    throw new Error("WORKER_URL and ALEXA_BRIDGE_SECRET Lambda environment variables are required.");
  }

  const namespace = event?.directive?.header?.namespace;
  const name = event?.directive?.header?.name;
  if (!event || typeof event !== "object" || !namespace || !name) {
    throw new Error("The Alexa Smart Home request envelope is missing its directive header.");
  }

  const target = new URL(WORKER_PATH, workerBaseUrl);
  if (target.protocol !== "https:") {
    throw new Error("WORKER_URL must use HTTPS.");
  }

  console.log("Alexa bridge received directive:", namespace + "." + name);
  console.log("Forwarding directive to Cloudflare Worker.");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6500);

  try {
    let response;
    try {
      response = await fetch(target, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-my-lights-bridge-secret": bridgeSecret
        },
        body: JSON.stringify(event),
        signal: controller.signal
      });
    } catch (error) {
      console.error("Cloudflare Worker request failed:", error?.name || "UnknownError", error?.message || "No error message");
      throw error;
    }

    const responseText = await response.text();
    console.log("Cloudflare Worker responded with HTTP", response.status);

    if (!response.ok) {
      console.error("Cloudflare Worker returned a non-success response.");
      throw new Error(`Cloudflare Worker returned HTTP ${response.status}: ${responseText.slice(0, 400)}`);
    }

    try {
      const result = JSON.parse(responseText);
      console.log("Cloudflare Worker response was valid JSON.");
      return result;
    } catch {
      console.error("Cloudflare Worker response was not valid JSON.");
      throw new Error("Cloudflare Worker returned invalid JSON.");
    }
  } finally {
    clearTimeout(timeout);
  }
};
