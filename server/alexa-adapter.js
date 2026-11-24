/*
 * IMPORTANT: This is an intentional placeholder, not a working Alexa connector.
 *
 * Next engineering milestone:
 * 1. Verify the Alexa Smart Home skill virtual CONTACT_SENSOR approach with an
 *    actual Alexa account and routine trigger.
 * 2. Implement the Amazon-required skill endpoint, discovery, account linking,
 *    authorization, state-change event reporting, and token lifecycle.
 * 3. Map WHITE / BLUE / OFF to the verified trigger mechanism.
 *
 * Never place Amazon client secrets or private signing keys in the PWA.
 */
async function handleLightingCommand(command) {
  return {
    accepted: false,
    command,
    message: "Alexa integration is not implemented yet. No bulb command was sent."
  };
}
module.exports = { handleLightingCommand };
