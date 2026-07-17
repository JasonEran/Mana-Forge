const assert = require("node:assert/strict");
const fs = require("node:fs");

const REQUIRED_SECTIONS = Object.freeze([
  "Validation evidence",
  "Security impact",
  "Rollback plan",
]);

function sectionBody(body, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(body || "").match(
    new RegExp(`##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, "i"),
  );
  return match ? match[1].trim() : "";
}

function validatePullRequestBody(body) {
  const value = String(body || "");
  const missing = [];
  if (!/(?:closes|fixes|resolves|refs)\s+#\d+/i.test(value)) {
    missing.push("linked issue");
  }
  for (const name of REQUIRED_SECTIONS) {
    if (!sectionBody(value, name)) missing.push(name.toLowerCase());
  }
  return missing;
}

function main(env = process.env) {
  assert.ok(env.GITHUB_EVENT_PATH, "GITHUB_EVENT_PATH is required.");
  const event = JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, "utf8"));
  const missing = validatePullRequestBody(event.pull_request?.body || "");
  if (missing.length) {
    throw new Error(`PR body is missing: ${missing.join(", ")}`);
  }
  process.stdout.write("Pull request contract passed.\n");
}

if (require.main === module) main();

module.exports = { sectionBody, validatePullRequestBody };
