import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { classify } from "./mock-ai.mjs";

const html = await readFile(new URL("./index.html", import.meta.url));

const MODEL_TIMEOUT_MS = 300;
const TOPICS = new Set(["delivery", "pricing", "other"]);
const MANUAL_REVIEW = { status: "manual_review", topic: null, draft: null };

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function readText(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
  const text = body?.text;
  return typeof text === "string" && text.trim() !== "" ? text : null;
}

async function askModel(text) {
  const signal = AbortSignal.timeout(MODEL_TIMEOUT_MS);
  // Синхронное исключение провайдера становится отклонённым промисом до подписки на abort.
  const pending = Promise.resolve().then(() => classify(text, { signal }));
  const aborted = new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
  // Гонка держит лимит, даже если провайдер не реагирует на signal.
  return Promise.race([pending, aborted]);
}

function parseModelOutput(raw) {
  const { topic, draft } = JSON.parse(raw) ?? {};
  if (!TOPICS.has(topic)) throw new Error("Unexpected topic");
  if (typeof draft !== "string" || draft.trim() === "") throw new Error("Empty draft");
  return { topic, draft };
}

async function handleTriage(request, response) {
  const text = await readText(request);
  if (text === null) return json(response, 400, { status: "invalid_input" });

  let result;
  try {
    result = parseModelOutput(await askModel(text));
  } catch {
    return json(response, 200, MANUAL_REVIEW);
  }
  return json(response, 200, { status: "ready", ...result });
}

export function createApp() {
  return createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(html);
      return;
    }
    if (request.method !== "POST" || request.url !== "/api/triage") {
      return json(response, 404, { status: "not_found" });
    }
    try {
      await handleTriage(request, response);
    } catch {
      json(response, 500, { status: "server_error" });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createApp().listen(Number(process.env.PORT || 3000), "127.0.0.1");
}
