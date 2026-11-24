# My Lights — starter project

This is the first installable-web-app starter for your personal lighting controller.

## What works now
- Responsive WHITE, BLUE, and OFF controls.
- Installable PWA structure for iPhone Safari ("Add to Home Screen").
- A settings screen to enter your future HTTPS backend URL and access token.
- The app clearly reports that Alexa is not connected until a real backend is configured.

## What is not connected yet
The Alexa integration is deliberately **not represented as working**. The server includes a clearly marked adapter placeholder. Before connecting bulbs, we must prove that an Alexa Smart Home skill can expose a virtual contact sensor and that Alexa accepts its state-change events as routine triggers for your account. We must also implement Amazon-required account linking, authorization, discovery, state reporting, and certification requirements as applicable.

No Amazon credentials, API secrets, or access tokens are included in this project.

## Files
- `public/index.html` — app interface
- `public/app.js` — button and settings behavior
- `public/manifest.webmanifest` — installable app metadata
- `public/sw.js` — basic offline app shell
- `server/index.js` — small Node HTTP API scaffold
- `server/alexa-adapter.js` — intentionally unimplemented Alexa integration boundary

## Run the interface locally in Codespaces
From the repository root:

```bash
npm install
npm start
```

Then open the forwarded port 3000 in the browser.

## Deploying
Do not deploy the API publicly until authentication, HTTPS, rate limiting, and the Alexa integration are implemented and tested. Do not put Amazon client secrets in frontend files or GitHub.

## iPhone installation (after hosting on HTTPS)
1. Open the hosted app URL in Safari.
2. Tap Share.
3. Choose Add to Home Screen.
4. Enable Open as Web App if offered, then tap Add.

This starter is not yet a functioning Alexa controller. It is the app shell and development foundation.
