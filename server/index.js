const express = require("express");
const path = require("path");
const { handleLightingCommand } = require("./alexa-adapter");

const app = express();
app.use(express.json({ limit: "10kb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "my-lights", alexaConnected: false }));

app.post("/api/command", async (req, res) => {
  const expected = process.env.APP_TOKEN;
  if (!expected || req.headers.authorization !== `Bearer ${expected}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const command = req.body && req.body.command;
  if (!["WHITE", "BLUE", "OFF"].includes(command)) {
    return res.status(400).json({ error: "Command must be WHITE, BLUE, or OFF." });
  }
  try {
    const result = await handleLightingCommand(command);
    return res.status(501).json({ error: result.message });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, "0.0.0", (0) => console.log(`My Lights listening on ${port}`)));
