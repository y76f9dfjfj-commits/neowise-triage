import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "./server.mjs";

const MANUAL_REVIEW = { status: "manual_review", topic: null, draft: null };
const INVALID_INPUT = { status: "invalid_input" };

let server;
let url;

before(async () => {
  server = createApp();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${server.address().port}/api/triage`;
});

after(() => new Promise((resolve) => server.close(resolve)));

async function post(body) {
  const reply = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  return { status: reply.status, json: await reply.json() };
}

test("корректная заявка получает тему и черновик", async () => {
  const { status, json } = await post(JSON.stringify({ text: "Когда будет доставка?" }));
  assert.equal(status, 200);
  assert.equal(json.status, "ready");
  assert.equal(json.topic, "delivery");
  assert.ok(json.draft.trim());
});

for (const marker of ["[timeout]", "[error]", "[bad-json]", "[bad-topic]", "[empty-draft]"]) {
  test(`сбой модели ${marker} отправляет заявку на ручной разбор`, async () => {
    const { status, json } = await post(JSON.stringify({ text: `Заявка ${marker}` }));
    assert.equal(status, 200);
    assert.deepEqual(json, MANUAL_REVIEW);
  });
}

test("ожидание модели ограничено 300 мс", async () => {
  const started = performance.now();
  const { json } = await post(JSON.stringify({ text: "Заявка [timeout]" }));
  assert.deepEqual(json, MANUAL_REVIEW);
  assert.ok(performance.now() - started < 600);
});

for (const [name, body] of [
  ["битый JSON", "{text:"],
  ["нет поля text", "{}"],
  ["text не строка", JSON.stringify({ text: 42 })],
  ["пустая строка", JSON.stringify({ text: "" })],
  ["строка из пробелов", JSON.stringify({ text: "   " })],
  ["тело null", "null"],
]) {
  test(`невалидный ввод: ${name}`, async () => {
    const { status, json } = await post(body);
    assert.equal(status, 400);
    assert.deepEqual(json, INVALID_INPUT);
  });
}
