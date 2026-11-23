// The contact function on the platform (index.test.mjs is the Lambda's own suite, unchanged): settings from General's
// environment, the platform's function URL event, Turnstile, the mail, SMTP retries. No mail server and no
// Cloudflare: the transport and fetch are replaced; every case loads a fresh module copy with its own environment
// (each platform call is a new process).
import assert from "node:assert/strict";
import test from "node:test";
import nodemailer from "nodemailer";

const ENV_NAMES = [
  "MAINSERVER_FUNCTION_ID", "SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_REQUIRE_TLS", "SMTP_USER", "SMTP_PASS",
  "SMTP_PASSWORD", "CONTACT_TO_EMAIL", "CONTACT_FROM_EMAIL_CINTECA", "CONTACT_FROM_EMAIL_AC", "ALLOWED_ORIGINS",
  "TURNSTILE_SECRET_KEY", "TURNSTILE_EXPECTED_ACTION", "TURNSTILE_EXPECTED_HOSTNAMES",
  "CINTECA_CONTACT_TO_EMAIL", "CINTECA_CONTACT_FROM_EMAIL_CINTECA", "CINTECA_CONTACT_FROM_EMAIL_AC",
  "CINTECA_CONTACT_ALLOWED_ORIGINS", "CINTECA_CONTACT_TURNSTILE_SECRET_KEY",
  "CINTECA_CONTACT_TURNSTILE_EXPECTED_ACTION", "CINTECA_CONTACT_TURNSTILE_EXPECTED_HOSTNAMES",
];
let copy = 0;

// What Cloudflare answers for a token of the given site; "fail" = not a valid token.
function siteverify(hostname, action = "contact") {
  return { success: hostname !== "fail", action, hostname };
}

async function load(env, { verdict = siteverify("cinteca.es") } = {}) {
  for (const name of ENV_NAMES) delete process.env[name];
  Object.assign(process.env, env);
  const mod = await import(`../index.mjs?case=${(copy += 1)}`);
  const sent = [];
  const transports = [];
  const pauses = [];
  const failures = [];
  const verifications = [];
  mod.deps.sleep = async (ms) => {
    pauses.push(ms);
  };
  mod.deps.createTransport = (options) => {
    transports.push(options);
    return {
      sendMail: async (message) => {
        sent.push(message);
        const failure = failures.shift();
        if (failure) throw failure;
        return { messageId: `<m${sent.length}@test>` };
      },
    };
  };
  mod.deps.fetch = async (url, init) => {
    verifications.push({ url, body: JSON.parse(init.body) });
    return { ok: true, json: async () => verdict };
  };
  return { mod, sent, transports, pauses, failures, verifications };
}

// General's variables as the cut-over sets them (runbook: aws-exit-prep forms.md).
const PLATFORM_ENV = {
  MAINSERVER_FUNCTION_ID: "fn-test01",
  SMTP_HOST: "mail.example.test",
  SMTP_PORT: "465",
  SMTP_USER: "no-reply@general.example.test",
  SMTP_PASSWORD: "platform-secret",
  CINTECA_CONTACT_TO_EMAIL: "owner@example.test",
  CINTECA_CONTACT_ALLOWED_ORIGINS:
    "https://cinteca.es,https://www.cinteca.es,https://adrianocaldas.com,https://www.adrianocaldas.com",
  CINTECA_CONTACT_TURNSTILE_SECRET_KEY: "ts-secret",
  CINTECA_CONTACT_TURNSTILE_EXPECTED_ACTION: "contact",
  CINTECA_CONTACT_TURNSTILE_EXPECTED_HOSTNAMES: "cinteca.es,www.cinteca.es,adrianocaldas.com,www.adrianocaldas.com",
};

const PAYLOAD = {
  name: "Ada Lovelace",
  email: "Ada@Example.com",
  company: "Analytical Engines",
  subject: "International technology project",
  message: "I would like to discuss a technology project.\nSecond line <b>.",
  website: "",
  turnstileToken: "valid-turnstile-token",
  language: "en",
  privacyAccepted: true,
  site: "cinteca",
};

// A public call through Traefik: the platform's function URL event (payload 2.0), the visitor's address as sourceIp.
function call(method, body, { origin = "https://cinteca.es", headers = {} } = {}) {
  return {
    version: "2.0",
    rawPath: "/",
    headers: { "content-type": "application/json", origin, ...headers },
    requestContext: { http: { method, path: "/", sourceIp: "203.0.113.7" } },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    isBase64Encoded: false,
  };
}

const context = (remaining = 55_000) => ({
  awsRequestId: "inv-1",
  getRemainingTimeInMillis: () => remaining,
});

test("cinteca.es: verified, sent through the platform's mail as the no-reply user, 202", async () => {
  const { mod, sent, transports, verifications } = await load(PLATFORM_ENV);
  const res = await mod.handler(call("POST", PAYLOAD), context());

  assert.equal(res.statusCode, 202);
  assert.deepEqual(JSON.parse(res.body), { ok: true, requestId: "inv-1" });
  assert.equal(res.headers["Access-Control-Allow-Origin"], "https://cinteca.es");
  assert.equal(verifications.length, 1);
  assert.equal(verifications[0].body.secret, "ts-secret");
  assert.equal(verifications[0].body.response, "valid-turnstile-token");
  assert.equal(verifications[0].body.remoteip, "203.0.113.7");
  assert.equal(transports[0].host, "mail.example.test");
  assert.equal(transports[0].port, 465);
  assert.equal(transports[0].secure, true);
  assert.deepEqual(transports[0].auth, { user: "no-reply@general.example.test", pass: "platform-secret" });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].from, "Cinteca contact form <no-reply@general.example.test>");
  assert.equal(sent[0].to, "owner@example.test");
  assert.deepEqual(sent[0].replyTo, { name: "Ada Lovelace", address: "ada@example.com" });
  assert.equal(sent[0].subject, "[Cinteca] International technology project");
  assert.match(sent[0].text, /^Request: inv-1$/m);
  assert.match(sent[0].html, /Second line &lt;b&gt;\./);
});

test("adrianocaldas.com: its own label and default sender; a configured sender wins", async () => {
  const ac = await load(PLATFORM_ENV, { verdict: siteverify("adrianocaldas.com") });
  const res = await ac.mod.handler(
    call("POST", { ...PAYLOAD, site: "adrianocaldas" }, { origin: "https://www.adrianocaldas.com" }),
    context(),
  );
  assert.equal(res.statusCode, 202);
  assert.equal(ac.sent[0].from, "AdrianoCaldas.com contact form <no-reply@general.example.test>");
  assert.equal(ac.sent[0].subject, "[AdrianoCaldas.com] International technology project");

  const branded = await load({ ...PLATFORM_ENV, CINTECA_CONTACT_FROM_EMAIL_CINTECA: "Cinteca <web@cinteca.example>" });
  await branded.mod.handler(call("POST", PAYLOAD), context());
  assert.equal(branded.sent[0].from, "Cinteca <web@cinteca.example>");
});

test("on the platform only the CINTECA_CONTACT_ names count (General's variables are shared)", async () => {
  const shared = {
    ...PLATFORM_ENV,
    CONTACT_TO_EMAIL: "someone-else@example.test",
    ALLOWED_ORIGINS: "https://evil.example",
    TURNSTILE_SECRET_KEY: "other-secret",
  };
  const { mod, sent, verifications } = await load(shared);
  const res = await mod.handler(call("POST", PAYLOAD), context());
  assert.equal(res.statusCode, 202);
  assert.equal(sent[0].to, "owner@example.test");
  assert.equal(verifications[0].body.secret, "ts-secret");
  assert.equal((await mod.handler(call("POST", PAYLOAD, { origin: "https://evil.example" }), context())).statusCode, 403);

  const missing = { ...PLATFORM_ENV, CONTACT_TO_EMAIL: "someone-else@example.test" };
  delete missing.CINTECA_CONTACT_TO_EMAIL;
  const unset = await load(missing);
  const res2 = await unset.mod.handler(call("POST", PAYLOAD), context());
  assert.equal(res2.statusCode, 503);
  assert.equal(unset.sent.length, 0);
  assert.equal(unset.verifications.length, 0);
});

test("outside the platform the Lambda's names still work (and SMTP_PASS wins over SMTP_PASSWORD)", async () => {
  const lambdaEnv = {
    SMTP_HOST: "smtp.example.test",
    SMTP_PORT: "587",
    SMTP_SECURE: "false",
    SMTP_USER: "smtp-user",
    SMTP_PASS: "smtp-pass",
    SMTP_PASSWORD: "ignored",
    CONTACT_TO_EMAIL: "dest@example.test",
    CONTACT_FROM_EMAIL_CINTECA: "web-cinteca@cinteca.example",
    ALLOWED_ORIGINS: "https://cinteca.es",
    TURNSTILE_SECRET_KEY: "lambda-secret",
  };
  const { mod, sent, transports } = await load(lambdaEnv);
  const res = await mod.handler(call("POST", PAYLOAD), context());
  assert.equal(res.statusCode, 202);
  assert.equal(transports[0].secure, false);
  assert.equal(transports[0].requireTLS, true);
  assert.equal(transports[0].auth.pass, "smtp-pass");
  assert.equal(sent[0].from, "web-cinteca@cinteca.example");
});

test("anti-abuse as on AWS: foreign origin, honeypot, Turnstile refused, action or hostname mismatch", async () => {
  const base = await load(PLATFORM_ENV);
  const foreign = await base.mod.handler(call("OPTIONS", undefined, { origin: "https://evil.example" }), context());
  assert.equal(foreign.statusCode, 403);
  assert.equal(foreign.headers["Access-Control-Allow-Origin"], undefined);
  const preflight = await base.mod.handler(call("OPTIONS", undefined, { origin: "https://www.cinteca.es" }), context());
  assert.equal(preflight.statusCode, 204);
  assert.equal(preflight.headers["Access-Control-Allow-Methods"], "POST, OPTIONS");

  const honeypot = await base.mod.handler(call("POST", { ...PAYLOAD, website: "https://spam.invalid" }), context());
  assert.equal(honeypot.statusCode, 202);
  assert.equal(base.verifications.length, 0);
  assert.equal(base.sent.length, 0);

  for (const verdict of [siteverify("fail"), siteverify("cinteca.es", "other"), siteverify("evil.example")]) {
    const refused = await load(PLATFORM_ENV, { verdict });
    const res = await refused.mod.handler(call("POST", PAYLOAD), context());
    assert.equal(res.statusCode, 400);
    assert.match(res.body, /Human verification failed/);
    assert.equal(refused.sent.length, 0);
  }

  const mismatch = await base.mod.handler(
    call("POST", { ...PAYLOAD, site: "adrianocaldas" }, { origin: "https://cinteca.es" }),
    context(),
  );
  assert.equal(mismatch.statusCode, 400);
  assert.match(mismatch.body, /does not match request origin/);
});

test("request shape: JSON only, 32 KiB at most, a base64 body, POST only", async () => {
  const { mod, sent } = await load(PLATFORM_ENV);
  const text = await mod.handler(call("POST", "x", { headers: { "content-type": "text/plain" } }), context());
  assert.equal(text.statusCode, 415);
  const big = await mod.handler(call("POST", { ...PAYLOAD, message: "x".repeat(33_000) }), context());
  assert.equal(big.statusCode, 413);
  assert.equal((await mod.handler(call("GET"), context())).statusCode, 405);
  assert.equal((await mod.handler(call("POST", "{oops"), context())).statusCode, 400);

  const encoded = call("POST", undefined);
  encoded.body = Buffer.from(JSON.stringify(PAYLOAD)).toString("base64");
  encoded.isBase64Encoded = true;
  assert.equal((await mod.handler(encoded, context())).statusCode, 202);
  assert.equal(sent.length, 1);
});

test("SMTP: a temporary failure is tried again on a new connection; permanent or late failures are a 503", async () => {
  const temporary = await load(PLATFORM_ENV);
  temporary.failures.push(Object.assign(new Error("greylisted"), { responseCode: 451 }));
  const ok = await temporary.mod.handler(call("POST", PAYLOAD), context());
  assert.equal(ok.statusCode, 202);
  assert.equal(temporary.sent.length, 2);
  assert.equal(temporary.transports.length, 2);
  assert.deepEqual(temporary.pauses, [1_000]);

  const permanent = await load(PLATFORM_ENV);
  permanent.failures.push(Object.assign(new Error("rejected"), { responseCode: 550 }));
  const failed = await permanent.mod.handler(call("POST", PAYLOAD), context());
  assert.equal(failed.statusCode, 503);
  assert.equal(permanent.sent.length, 1);

  const late = await load(PLATFORM_ENV);
  late.failures.push(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }));
  const noTime = await late.mod.handler(call("POST", PAYLOAD), context(10_000));
  assert.equal(noTime.statusCode, 503);
  assert.equal(late.sent.length, 1);
});

test("missing settings: 503 before Cloudflare or SMTP is called", async () => {
  for (const drop of ["SMTP_PASSWORD", "SMTP_HOST", "CINTECA_CONTACT_TURNSTILE_SECRET_KEY"]) {
    const env = { ...PLATFORM_ENV };
    delete env[drop];
    const { mod, sent, verifications } = await load(env);
    const res = await mod.handler(call("POST", PAYLOAD), context());
    assert.equal(res.statusCode, 503, drop);
    assert.equal(verifications.length, 0);
    assert.equal(sent.length, 0);
  }
});

test("the message nodemailer builds (real nodemailer, stream transport): From, To, Reply-To, both parts", async () => {
  const { mod } = await load(PLATFORM_ENV);
  const route = mod.resolveContactRoute("cinteca");
  const data = mod.validatePayload(PAYLOAD).data;
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
  const info = await transport.sendMail(mod.buildContactEmail(data, "inv-1", route));
  const raw = info.message.toString("utf8");
  assert.match(raw, /^From: Cinteca contact form <no-reply@general\.example\.test>$/m);
  assert.match(raw, /^To: owner@example\.test$/m);
  assert.match(raw, /^Reply-To: Ada Lovelace <ada@example\.com>$/m);
  assert.match(raw, /^Subject: \[Cinteca\] International technology project$/m);
  assert.match(raw, /^Content-Type: multipart\/alternative/m);
});
