import fs from "node:fs";

function readEnvFiles(files) {
  const env = {};
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
  return env;
}

function classify(status, raw) {
  const lower = String(raw || "").toLowerCase();
  if (status === 429 || lower.includes("quota") || lower.includes("resource_exhausted") || lower.includes("rate limit")) return "quota";
  if (status === 401 || status === 403 || lower.includes("api key") || lower.includes("permission")) return "auth";
  if (status === 400 || status === 404 || lower.includes("model")) return "model";
  if (status >= 500) return "provider_error";
  return "request_error";
}

const env = readEnvFiles([".env.local", ".env.staging.local"]);
const model = env.GEMINI_MODEL || "gemini-2.5-flash";

if (!env.GEMINI_API_KEY) {
  console.log(JSON.stringify({ status: "FAIL", reason: "missing_key", model }, null, 2));
  process.exit(0);
}

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 20_000);

try {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "Reply with exactly: ok" }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 8 },
      }),
      signal: controller.signal,
    },
  );
  clearTimeout(timer);

  const raw = await response.text();
  if (!response.ok) {
    console.log(
      JSON.stringify(
        { status: "FAIL", httpStatus: response.status, reason: classify(response.status, raw), model },
        null,
        2,
      ),
    );
    process.exit(0);
  }

  const data = JSON.parse(raw);
  const text = data?.candidates?.[0]?.content?.parts?.find((part) => part.text)?.text?.trim() || "";
  console.log(
    JSON.stringify(
      { status: text ? "PASS" : "FAIL", httpStatus: response.status, reason: text ? "ok" : "empty", model, textLength: text.length },
      null,
      2,
    ),
  );
} catch (error) {
  clearTimeout(timer);
  console.log(
    JSON.stringify(
      { status: "FAIL", reason: error?.name === "AbortError" ? "timeout" : "network", model },
      null,
      2,
    ),
  );
}
