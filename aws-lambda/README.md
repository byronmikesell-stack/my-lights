# AWS Lambda bridge

Alexa Smart Home uses an AWS Lambda ARN endpoint in the current Developer Console workflow. This tiny function is only a secure relay: Alexa invokes Lambda, Lambda forwards the directive to the existing Cloudflare Worker, and the Worker returns the Smart Home response.

## Create the function

1. In AWS Lambda, choose **Create function** and **Author from scratch**.
2. Name it `my-lights-alexa-bridge`.
3. Choose **Node.js 22.x** and the default architecture.
4. Create or use an execution role with **AWSLambdaBasicExecutionRole**.
5. After creating the function, add an **Alexa** trigger, choose **Alexa Smart Home**, and enter the Skill ID from your Alexa Developer Console.
6. In the function's **Code** tab, replace the contents of `index.mjs` with the file in this folder and choose **Deploy**.
7. Set the function timeout to **8 seconds** and memory to **256 MB**.
8. Under **Configuration → Environment variables**, add:
   - `WORKER_URL` = `https://my-lights.byronmikesell.workers.dev`
   - `ALEXA_BRIDGE_SECRET` = the same random secret saved in the Cloudflare Worker as an encrypted secret.

The Lambda handler setting should be `index.handler`.

## Connect Alexa

Copy the Lambda function ARN. In the Alexa Developer Console, open the Smart Home model and paste the ARN into the Smart Home service endpoint for the North America / US region. Use the same ARN for the default endpoint and the North America region if both fields are shown.

## Cloudflare

Add `ALEXA_BRIDGE_SECRET` as an encrypted Worker secret. Do not put its value in GitHub, a Worker plain-text variable, or this README. The Lambda and Worker values must match exactly.

The Worker receives the request at `POST /alexa-bridge`, checks the shared secret, and handles the Alexa directive using the KV-backed account and sensor state. The browser app continues to call the Worker directly; Lambda is not in the button-press path.
