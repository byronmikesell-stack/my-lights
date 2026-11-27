# My Lights — personal Alexa lighting controller

This repository contains an installable web app and a Cloudflare Worker that exposes virtual Alexa contact sensors (three originals listed below, plus Green, Red, Purple and ten brightness levels; see "Colors and brightness"):

- **My Lights White**
- **My Lights Blue**
- **My Lights Off**

Each app button sends a short contact-sensor open/close event to Alexa. You create one Alexa Routine per sensor and choose what that Routine does with your existing Cync lights (and future Alexa-compatible brands).

## Architecture

- The PWA and primary application backend run on Cloudflare Workers.
- Cloudflare KV stores Alexa account-link tokens and virtual sensor state.
- A small AWS Lambda function is the Alexa Smart Home endpoint required by the current Smart Home Developer Console workflow. It only forwards Alexa directives to the Cloudflare Worker over HTTPS.
- The browser app still calls Cloudflare directly. Lambda is not involved when you tap WHITE, BLUE, or OFF.

The current Alexa Smart Home setup instructions and endpoint configuration use a Lambda ARN. The older generic skill-manifest v0 schema contains broader HTTPS wording, but we are using the documented Smart Home Lambda workflow rather than depending on the conflicting older description. See the official [Smart Home endpoint setup](https://developer.amazon.com/docs/alexaplus/smarthome/configure-endpoint-tutorial) and [Lambda implementation steps](https://developer.amazon.com/docs/alexaplus/smarthome/implement-your-addon).

## Cloudflare setup

### 1. KV namespace

Create a Workers KV namespace named `my-lights-data`, then bind it to the `my-lights` Worker using the binding name `MY_LIGHTS_KV`. The namespace ID must also be added to `wrangler.jsonc` before future GitHub deployments. Do not put credentials or token values in the namespace ID field.

### 2. Worker secrets

Add these as encrypted Worker secrets, not plain-text variables:

- `APP_TOKEN` — long random value used by the web app to authenticate button requests.
- `ALEXA_SKILL_CLIENT_ID` — Alexa Skill Messaging client ID shown after enabling **Send Alexa Events**.
- `ALEXA_SKILL_CLIENT_SECRET` — matching Alexa Skill Messaging client secret.
- `ALEXA_BRIDGE_SECRET` — long random shared secret used only between Lambda and this Worker.

The Alexa Skill Messaging values are different from the Login with Amazon (LWA) Security Profile credentials used for Account Linking. Never commit secrets to GitHub or paste them into this README.

## AWS Lambda bridge

Follow the step-by-step instructions in [aws-lambda/README.md](aws-lambda/README.md). The bridge code is in [aws-lambda/index.mjs](aws-lambda/index.mjs). It requires only the built-in Node.js fetch API and has no third-party dependencies.

AWS currently lists an always-free Lambda allowance of 1 million requests and 400,000 GB-seconds per month. A personal lighting controller should use very little of that allowance, but AWS usage is still subject to the account's billing plan and any usage beyond the free limits.

## Alexa Developer Console

Create a **Smart Home** skill/add-on, choose English (US), and copy its Skill ID.

Create the Lambda function, add the Alexa Smart Home trigger using that Skill ID, and paste the function ARN into the Smart Home service endpoint for North America / US. Do not enter the Cloudflare URL directly as the Smart Home endpoint.

### Account linking

Smart Home skills require account linking. Use Login with Amazon (LWA) as the authorization server:

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
- `POST /alexa-bridge` receives Alexa Smart Home directives from the authenticated Lambda relay.

No Amazon credentials, signing keys, LWA access tokens, or refresh tokens are included in this repository.


## Colors and brightness

The app also has **BR GREEN**, **BR RED**, **BR PURPLE**, **BR UP** and **BR DN** buttons. After updating, run **Discover Devices** in the Alexa app; it should find 13 new sensors:

- My Lights Green, My Lights Red, My Lights Purple → one routine each that sets the bulb's color. Leave brightness out of these routines.
- My Lights Level 10, 20, 30 … 100 → one routine each that sets the bulb's brightness to that percent.

UP and DN are handled by the Worker: it remembers the last level in KV (`brightness:level`, starting at 100%; tapping WHITE resets it to 100%, so the WHITE routine should also set brightness to 100%) and opens the next level's sensor, stopping at 10% and 100%. If brightness is changed some other way (voice, the Cync app), the next UP/DN steps from the last level the Worker set.
