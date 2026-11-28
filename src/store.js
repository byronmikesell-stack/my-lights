import { DurableObject } from "cloudflare:workers";

const LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token";
const LEVELS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
const DEFAULT_LEVEL = 100;

// One Durable Object holds the Alexa tokens and the brightness level.
// Unlike KV it never returns a stale copy, and every token refresh runs one
// at a time, so a rotated refresh token is never reused.
export class LightsStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.queue = Promise.resolve();
  }

  // Runs fn after every earlier queued call has finished.
  serial(fn) {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }

  async getAccount() {
    return (await this.ctx.storage.get("account")) || null;
  }

  async setAccount(account) {
    return this.serial(() => this.ctx.storage.put("account", account));
  }

  async clearAccount() {
    return this.serial(() => this.ctx.storage.delete("account"));
  }

  // Returns an account with a usable access token. With force=true the token
  // is refreshed unless someone already replaced staleAccessToken.
  async freshAccount(force = false, staleAccessToken = "") {
    return this.serial(async () => {
      const account = await this.ctx.storage.get("account");
      if (!account?.accessToken) throw new Error("Alexa has not been linked to My Lights yet.");
      if (force) {
        if (staleAccessToken && account.accessToken !== staleAccessToken) return account;
      } else if (account.expiresAt && Date.now() < account.expiresAt - 60000) {
        return account;
      }
      const updated = await refreshTokens(this.env, account);
      await this.ctx.storage.put("account", updated);
      return updated;
    });
  }

  async stepLevel(direction) {
    return this.serial(async () => {
      const stored = await this.ctx.storage.get("level");
      const current = LEVELS.includes(stored) ? stored : DEFAULT_LEVEL;
      const index = LEVELS.indexOf(current) + (direction === "UP" ? 1 : -1);
      const next = LEVELS[Math.min(LEVELS.length - 1, Math.max(0, index))];
      await this.ctx.storage.put("level", next);
      return next;
    });
  }

  async getLevel() {
    const stored = await this.ctx.storage.get("level");
    return LEVELS.includes(stored) ? stored : DEFAULT_LEVEL;
  }

  async resetLevel() {
    return this.serial(() => this.ctx.storage.put("level", DEFAULT_LEVEL));
  }
}

async function refreshTokens(env, account) {
  const clientId = (env.ALEXA_SKILL_CLIENT_ID || "").trim();
  const clientSecret = (env.ALEXA_SKILL_CLIENT_SECRET || "").trim();
  if (!account.refreshToken || !clientId || !clientSecret) {
    throw new Error("Alexa Event Gateway refresh credentials are unavailable.");
  }
  const response = await fetch(LWA_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: account.refreshToken,
      client_id: clientId,
      client_secret: clientSecret
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    // Amazon's error code only; never log tokens or secrets.
    console.error("Alexa LWA refresh failed:", JSON.stringify({
      httpStatus: response.status,
      error: data.error || null,
      errorDescription: data.error_description || null
    }));
    throw new Error(`Amazon could not refresh the Alexa Event Gateway token (${data.error || "HTTP " + response.status}).`);
  }
  return {
    ...account,
    accessToken: data.access_token,
    refreshToken: data.refresh_token || account.refreshToken,
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000
  };
}
