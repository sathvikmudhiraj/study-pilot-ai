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

function classify(status, text) {
  const lower = String(text || "").toLowerCase();
  if (status === 401 || status === 403 || lower.includes("api key") || lower.includes("permission")) return "auth";
  if (status === 429 || lower.includes("quota") || lower.includes("rate limit") || lower.includes("resource_exhausted")) return "quota";
  if (status === 400 || status === 404 || lower.includes("model")) return "model";
  if (status === 503 || lower.includes("unavailable") || lower.includes("overloaded")) return "provider_busy";
  if (status >= 500) return "provider_error";
  return "request_error";
}

async function withTimeout(ms, fn) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function geminiTiny(env) {
  const model = env.GEMINI_MODEL || "gemini-2.5-flash";
  if (!env.GEMINI_API_KEY) return { status: "FAIL", reason: "missing_key" };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;
  try {
    return await withTimeout(20_000, async (signal) => {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "Reply with exactly: ok" }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 8 },
        }),
        signal,
      });
      const raw = await response.text();
      if (!response.ok) return { status: "FAIL", httpStatus: response.status, reason: classify(response.status, raw), model };
      const data = JSON.parse(raw);
      const text = data?.candidates?.[0]?.content?.parts?.find((part) => part.text)?.text?.trim() || "";
      return { status: text ? "PASS" : "FAIL", httpStatus: response.status, reason: text ? "ok" : "empty", model, textLength: text.length };
    });
  } catch (error) {
    return { status: "FAIL", reason: error?.name === "AbortError" ? "timeout" : "network", model };
  }
}

async function nvidiaChat(env, structured = false) {
  if (!env.NVIDIA_API_KEY) return { status: "FAIL", reason: "missing_key" };
  const baseUrl = (env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1").replace(/\/+$/, "");
  const model = env.NVIDIA_MODEL || "nvidia/nemotron-3.5-lightning-30b-a3b";
  try {
    return await withTimeout(60_000, async (signal) => {
      const body = {
        model,
        messages: [
          ...(structured
            ? [{ role: "system", content: "You output valid compact JSON only. No markdown. No prose." }]
            : []),
          {
            role: "user",
            content: structured
              ? "Output exactly this JSON object: {\"ok\":true,\"answer\":\"tiny\"}"
              : "Reply with exactly: ok",
          },
        ],
        temperature: 0,
        max_tokens: 32,
      };
      if (structured) body.response_format = { type: "json_object" };

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.NVIDIA_API_KEY}`,
        },
        body: JSON.stringify(body),
        signal,
      });
      const raw = await response.text();
      if (!response.ok) return { status: "FAIL", httpStatus: response.status, reason: classify(response.status, raw), model };
      const data = JSON.parse(raw);
      const content = data?.choices?.[0]?.message?.content?.trim() || "";
      if (!structured) return { status: content ? "PASS" : "FAIL", httpStatus: response.status, reason: content ? "ok" : "empty", model, textLength: content.length };

      try {
        const parsed = JSON.parse(content);
        return {
          status: parsed?.ok === true && parsed?.answer === "tiny" ? "PASS" : "FAIL",
          httpStatus: response.status,
          reason: "json_checked",
          model,
          keys: Object.keys(parsed || {}).sort(),
        };
      } catch {
        return { status: "FAIL", httpStatus: response.status, reason: "bad_json", model, textLength: content.length };
      }
    });
  } catch (error) {
    return { status: "FAIL", reason: error?.name === "AbortError" ? "timeout" : "network", model };
  }
}

const env = readEnvFiles([".env.staging.local", ".env.local"]);
const result = {
  geminiTiny: await geminiTiny(env),
  nvidiaTiny: await nvidiaChat(env, false),
  nvidiaStructuredJson: await nvidiaChat(env, true),
};

console.log(JSON.stringify(result, null, 2));
