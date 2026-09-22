import fs from "node:fs";

const nextEmail = `studypilot-e2e-other-${Date.now()}@studypilot.ai`;

for (const file of [".env.local", ".env.staging.local"]) {
  if (!fs.existsSync(file)) continue;
  let text = fs.readFileSync(file, "utf8");
  const pattern = /^(\s*STUDYPILOT_E2E_OTHER_EMAIL\s*=\s*).*$/m;
  if (pattern.test(text)) {
    text = text.replace(pattern, `$1${nextEmail}`);
  } else {
    text = `${text.trimEnd()}\nSTUDYPILOT_E2E_OTHER_EMAIL=${nextEmail}\n`;
  }
  fs.writeFileSync(file, text);
}

console.log(JSON.stringify({ updated: true, files: [".env.local", ".env.staging.local"] }));
