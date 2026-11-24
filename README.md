# My Lights — personal Alexa lighting controller

This repository contains an installable web app and a Cloudflare Worker that exposes three virtual Alexa contact sensors:

- **My Lights White**
- **My Lights Blue**
- **My Lights Off**

Each app button sends a short contact-sensor open/close event to Alexa. You create one Alexa Routine per sensor and choose what that Routine does with your existing Cync lights (and any future Alexa-compatible brands).

## Current state

- The PWA interface is hosted on Cloudflare Workers.
- The Worker code now handles Alexa Smart Home discovery and state reports for three virtual contact sensors.
- The Worker validates Alexa request signatures and request dates.
- It implements the Alexa Event Gateway authorization-code exchange, token refresh, and ChangeReport events.
- The buttons remain inactive until the Cloudflare KV binding and secrets are configured, a Smart Home skill is created and linked, and the three Routines are configured.

## Cloudflare setup required

### 1. Create the KV namespace

In the Cloudflare dashboard, create a Workers KV namespace named `my-lights-data`. Then give the namespace a binding name of `MY_LIGHTS_KV` for the `my-lights` Worker. The namespace ID must also be added to `wrangler.jsonc` before future GitHub deployments. Do not put credentials or token values in the namespace ID field.

### 2. Add Worker secrets

In the `my-lights` Worker settings, add these encrypted secrets (not plain text variables):

- `APP_TOKEN` — a long random value used by the web app to authenticate button requests.
- `ALEXA_SKILL_CLIENT_ID` — the **Alexa Skill Messaging** client ID shown after enabling **Send Alexa Events** in the Alexa Developer Console.
- `ALEXA_SKILL_CLIENT_SECRET` — the matching **Alexa Skill Messaging** client secret.

These two Alexa Skill Messaging values are different from the Login with Amazon (LWA) Security Profile credentials used in the Alexa **Account Linking** screen.

Never commit secrets to GitHub or paste them into this README.

## Alexa Developer Console setup

Create a new **Smart Home** skill/add-on in the Alexa Developer Console. Use English (US) and the Smart Home model.

Configure its Smart Home service endpoint as:

```text
https://my-lights.byronmikesell.workers.dev/alexa
```

The current skill manifest schema supports an HTTPS URL for a custom endpoint. Select the trusted-certificate option if the console asks for the HTTPS certificate type. If the console only offers an AWS Lambda ARN for the Smart Home endpoint, stop there; don't create a separate paid service or substitute a random ARN. The endpoint configuration needs to be resolved before the skill can call this Worker.

### Account linking

All Smart Home add-ons need account linking. Use Login with Amazon (LWA) as the authorization server:

- Authorization URI: `https://www.amazon.com/ap/oa`
- Access Token URI: `https://api.amazon.com/auth/o2/token`
- Grant type: Authorization Code
- Scope: `profile:user_id`
- Client authentication: HTTP Basic

Create an LWA Security Profile, enter its Client ID and Client Secret in the Alexa Account Linking settings, save, and then add the Alexa Redirect URLs shown by the Developer Console to the LWA Security Profile's Allowed Return URLs.

### Send Alexa Events permission

In the Alexa Developer Console, open **Permissions** and enable **Send Alexa Events**. Copy the **Alexa Skill Messaging** Client ID and Client Secret and add them to the Cloudflare Worker secrets listed above. Do not share either value in chat or commit it to GitHub.

After the skill is configured, enable it for Development testing and link it in the Alexa app using the same Amazon account as the Developer Console. Alexa should discover the three virtual contact sensors.

## Configure your Routines

Create three Alexa Routines. For each one, choose its matching My Lights contact sensor as the trigger and use the sensor's **open** event:

- My Lights White opens → run your WHITE lighting actions.
- My Lights Blue opens → run your BLUE lighting actions.
- My Lights Off opens → run your OFF lighting actions.

The Worker reports the sensor closing again shortly after the trigger, so each tap acts like a momentary button.

## App access token

After setting `APP_TOKEN` as a Cloudflare Worker secret, open the My Lights app, choose **Connection settings**, and enter the same value as the App access token. The app uses its own Cloudflare Worker URL automatically.

## API behavior

- `GET /api/health` reports whether Alexa has been linked.
- `POST /api/command` accepts WHITE, BLUE, and OFF using the app bearer token.
- `POST /alexa` receives Alexa Smart Home directives.

No Amazon credentials, signing keys, LWA access tokens, or refresh tokens are included in this repository.
