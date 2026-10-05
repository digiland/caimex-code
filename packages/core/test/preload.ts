process.env.OPENCODE_DB = ":memory:"
process.env.NPM_CONFIG_AUDIT = "false"
// Caimex: keeps the Caimex plugin's gateway catalog fetch off the network in tests (the
// CLI's test environment sets the same flag).
process.env.OPENCODE_DISABLE_MODELS_FETCH = "true"
