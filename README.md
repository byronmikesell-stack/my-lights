# My Lights — personal lighting controller

This repository contains the installable web app and a Cloudflare Worker API shell for your personal Alexa lighting project.

## What works now

- Responsive WHITE, BLUE, and OFF controls.
- Installable PWA structure for iPhone Safari ("Add to Home Screen").
- Cloudflare Worker serves the website and API from one HTTPS origin.
- The API checks an app bearer token before accepting a lighting command.
- Health check: `/api/health`.

## What is not connected yet

The Alexa integration is deliberately **not represented as working**. The command endpoint currently returns HTTP 501 after authentication. No bulb command is sent.

Before implementing the Alexa side, we must prove that the Alexa Smart Home skill virtual contact-sensor approach is accepted as a routine trigger for your actual Alexa account. The actual Alexa skill endpoint must also implement Amazon's required request verification, discovery, account linking/authorization, state reporting, and token handling.

No Amazon credentials, signing keys, or access tokens are included in this repository.

## Cloud hosting

The project is configured for Cloudflare Workers with static assets. Cloudflare Workers Builds can connect to this GitHub repository and deploy on each push to `main`.

1. Create/sign into a Cloudflare account and open **Workers & Pages**.
2. Choose **Create application** and select **GitHub**.
3. Authorize Cloudflare's GitHub app when asked.
4. Choose `byronmikesell-stack/my-lights` and branch `main`.
5. Keep the root directory blank. No build command is required. Use the default deploy command `npx wrangler deploy`.
6. Save and deploy. Cloudflare provides a `workers.dev` HTTPS address.

The free Workers plan currently includes 100,000 Worker requests per day. Static asset requests are served separately from Worker script requests. Check Cloudflare's current plan and billing screens before enabling any paid feature.

## Runtime secret

Before the command endpoint can accept an app request, create a Worker secret named `APP_TOKEN` in the Cloudflare dashboard. Use a long random value. Do not put this value in GitHub or in this README. Enter the same value in the app's Connection settings after deployment.

The command endpoint still returns HTTP 501 until the Alexa integration is implemented and tested.

## Local development (optional)

Install Node.js, then from the repository root run:

```bash
npm install
npm run dev
```

## iPhone installation (after hosting on HTTPS)

1. Open the Cloudflare `workers.dev` app URL in Safari.
2. Tap Share.
3. Choose **Add to Home Screen**.
4. Enable **Open as Web App** if offered, then tap Add.

This is not yet a functioning Alexa controller. It is the hosted app shell and API foundation.
