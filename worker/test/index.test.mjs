// Tests for the contact Worker. Run from the repository root: node --test worker/test/*.test.mjs
// They mock fetch, so no request leaves the machine.
import assert from "node:assert/strict";
import { test } from "node:test";

import worker from "../src/index.js";

const ENV = {
  FROM_EMAIL: "info@vestanabullc.com",
  TO_EMAIL: "info@vestanabullc.com",
  POSTMARK_SERVER_TOKEN: "test-token",
  TURNSTILE_SECRET: "test-secret",
};

// Replaces fetch: Turnstile answers `human`, Postmark answers each status in `postmark` in turn.
function mockFetch({ human = true, postmark = [200] } = {}) {
  const calls = { turnstile: 0, postmark: [] };
  const answers = [...postmark];
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("turnstile")) {
      calls.turnstile += 1;
      return Response.json({ success: human });
    }
    calls.postmark.push(JSON.parse(init.body));
    const status = answers.shift() ?? 200;
    return Response.json(status === 200 ? { ErrorCode: 0 } : { ErrorCode: 412 }, { status });
  };
  return calls;
}

function post(origin, body) {
  return new Request("https://vestanabu-contact.example.workers.dev/", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const VALID = { name: "Ann", email: "ann@example.com", message: "Hello", turnstileToken: "token" };

test("vestanabullc.com: unchanged message to TO_EMAIL", async () => {
  const calls = mockFetch();
  const res = await worker.fetch(post("https://www.vestanabullc.com", { ...VALID, interest: "Consulting" }), ENV);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "https://www.vestanabullc.com");
  assert.deepEqual(calls.postmark, [
    {
      From: "VestaNabu Website <info@vestanabullc.com>",
      To: "info@vestanabullc.com",
      ReplyTo: "ann@example.com",
      Subject: "[Consulting] Ann",
      TextBody: "Name: Ann\nEmail: ann@example.com\nInterest: Consulting\n\nHello",
      MessageStream: "outbound",
    },
  ]);
});

test("vestanabullc.com: unknown interest becomes Something else", async () => {
  const calls = mockFetch();
  await worker.fetch(post("https://vestanabullc.com", { ...VALID, interest: "Free money" }), ENV);
  assert.equal(calls.postmark[0].Subject, "[Something else] Ann");
});

test("vestanabullc.com: Postmark failure names info@vestanabullc.com", async () => {
  mockFetch({ postmark: [422] });
  const res = await worker.fetch(post("https://www.vestanabullc.com", VALID), ENV);
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /info@vestanabullc\.com/);
});

test("www.monaidea.com: message to support@monaidea.com with the form's topic", async () => {
  const calls = mockFetch();
  const res = await worker.fetch(post("https://www.monaidea.com", { ...VALID, interest: "Ledgerstone" }), ENV);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "https://www.monaidea.com");
  assert.deepEqual(calls.postmark, [
    {
      From: "Monaidea Website <info@vestanabullc.com>",
      To: "support@monaidea.com",
      ReplyTo: "ann@example.com",
      Subject: "[Monaidea · Ledgerstone] Ann",
      TextBody: "Site: https://www.monaidea.com\nName: Ann\nEmail: ann@example.com\nTopic: Ledgerstone\n\nHello",
      MessageStream: "outbound",
    },
  ]);
});

test("Monaidea subdomains are accepted; a missing topic gets the default", async () => {
  const calls = mockFetch();
  const res = await worker.fetch(post("https://flagstone.monaidea.com", VALID), ENV);
  assert.equal(res.status, 200);
  assert.equal(calls.postmark[0].Subject, "[Monaidea · General question] Ann");
});

test("Monaidea: if Postmark refuses support@monaidea.com, the message goes to TO_EMAIL with the reason", async () => {
  const calls = mockFetch({ postmark: [422, 200] });
  const res = await worker.fetch(post("https://www.monaidea.com", VALID), ENV);
  assert.equal(res.status, 200);
  assert.equal(calls.postmark.length, 2);
  assert.equal(calls.postmark[1].To, "info@vestanabullc.com");
  assert.match(calls.postmark[1].TextBody, /Postmark refused support@monaidea\.com \(HTTP 422, Postmark error 412\)/);
});

test("Monaidea: if both sends fail, the visitor is told to email support@monaidea.com", async () => {
  mockFetch({ postmark: [422, 500] });
  const res = await worker.fetch(post("https://www.monaidea.com", VALID), ENV);
  assert.equal(res.status, 502);
  assert.equal((await res.json()).error, "Message could not be sent. Please email support@monaidea.com.");
});

test("other origins are refused, lookalikes included", async () => {
  for (const origin of [
    "https://example.com",
    "https://monaidea.com.example.com",
    "https://xmonaidea.com",
    "http://www.monaidea.com",
    "https://www.monaidea.com:8443",
    "null",
    "",
  ]) {
    const calls = mockFetch();
    const res = await worker.fetch(post(origin, VALID), ENV);
    assert.equal(res.status, 403, origin);
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), "https://www.vestanabullc.com", origin);
    assert.equal(calls.turnstile + calls.postmark.length, 0, origin);
  }
});

test("preflight answers each allowed origin with itself", async () => {
  for (const origin of ["https://www.vestanabullc.com", "https://www.monaidea.com", "https://monaidea.com"]) {
    const res = await worker.fetch(new Request("https://w.example/", { method: "OPTIONS", headers: { Origin: origin } }), ENV);
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), origin);
  }
});

test("honeypot: pretends success, checks and sends nothing", async () => {
  const calls = mockFetch();
  const res = await worker.fetch(post("https://www.monaidea.com", { ...VALID, website: "spam.example" }), ENV);
  assert.equal(res.status, 200);
  assert.equal(calls.turnstile + calls.postmark.length, 0);
});

test("failed Turnstile check: 403, nothing sent", async () => {
  const calls = mockFetch({ human: false });
  const res = await worker.fetch(post("https://www.monaidea.com", VALID), ENV);
  assert.equal(res.status, 403);
  assert.equal(calls.postmark.length, 0);
});

test("missing fields and bad JSON: 400", async () => {
  mockFetch();
  for (const body of [{ ...VALID, name: " " }, { ...VALID, email: "nope" }, { ...VALID, message: "" }, "not json", "null", "7"]) {
    const res = await worker.fetch(post("https://www.monaidea.com", body), ENV);
    assert.equal(res.status, 400, JSON.stringify(body));
  }
});

test("subject lines stay on one line", async () => {
  const calls = mockFetch();
  await worker.fetch(post("https://www.monaidea.com", { ...VALID, name: "Ann\r\nBcc: x@example.com", interest: "A\nB" }), ENV);
  assert.equal(calls.postmark[0].Subject, "[Monaidea · A B] Ann Bcc: x@example.com");
});
