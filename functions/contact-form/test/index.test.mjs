import assert from "node:assert/strict";
import test from "node:test";

import {
  handler,
  isAllowedOrigin,
  resolveContactRoute,
  siteForOrigin,
  validatePayload,
} from "../index.mjs";

const validPayload = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  company: "Analytical Engines",
  subject: "International technology project",
  message: "I would like to discuss a technology project with Cinteca.",
  website: "",
  turnstileToken: "valid-turnstile-token",
  language: "en",
  privacyAccepted: true,
  site: "cinteca",
};

test("accepts and normalises a valid contact payload", () => {
  const result = validatePayload(validPayload);

  assert.equal(result.ok, true);
  assert.equal(result.honeypot, false);
  assert.equal(result.data.email, "ada@example.com");
  assert.equal(result.data.site, "cinteca");
});

test("rejects invalid or incomplete submissions", () => {
  assert.equal(validatePayload({ ...validPayload, email: "invalid" }).ok, false);
  assert.equal(validatePayload({ ...validPayload, message: "short" }).ok, false);
  assert.equal(validatePayload({ ...validPayload, privacyAccepted: false }).ok, false);
  assert.equal(validatePayload({ ...validPayload, turnstileToken: "" }).ok, false);
  assert.equal(validatePayload({ ...validPayload, site: "unknown" }).ok, false);
});

test("uses one recipient and selects the sender for each trusted site", () => {
  const environment = {
    CONTACT_TO_EMAIL: "shared-destination@example.com",
    CONTACT_FROM_EMAIL_CINTECA: "web-cinteca@cinteca.es",
    CONTACT_FROM_EMAIL_AC: "web-ac@cinteca.es",
  };

  assert.deepEqual(resolveContactRoute("cinteca", environment), {
    to: "shared-destination@example.com",
    from: "web-cinteca@cinteca.es",
    label: "Cinteca",
  });
  assert.deepEqual(resolveContactRoute("adrianocaldas", environment), {
    to: "shared-destination@example.com",
    from: "web-ac@cinteca.es",
    label: "AdrianoCaldas.com",
  });
  assert.throws(() => resolveContactRoute("unknown", environment));
  assert.throws(() =>
    resolveContactRoute("cinteca", {
      CONTACT_FROM_EMAIL_CINTECA: "web-cinteca@cinteca.es",
    }),
  );
});

test("associates production origins with their fixed site identifiers", () => {
  assert.equal(siteForOrigin("https://cinteca.es"), "cinteca");
  assert.equal(siteForOrigin("https://www.cinteca.es"), "cinteca");
  assert.equal(siteForOrigin("https://adrianocaldas.com"), "adrianocaldas");
  assert.equal(siteForOrigin("https://www.adrianocaldas.com"), "adrianocaldas");
  assert.equal(siteForOrigin("https://evil.example"), null);
});

test("silently identifies the honeypot before sending email", () => {
  const result = validatePayload({ ...validPayload, website: "https://spam.invalid" });
  assert.equal(result.ok, true);
  assert.equal(result.honeypot, true);
});

test("allows only exact configured origins", () => {
  const origins = "https://cinteca.es,http://localhost:3000";

  assert.equal(isAllowedOrigin("https://cinteca.es", origins), true);
  assert.equal(isAllowedOrigin("http://localhost:3000", origins), true);
  assert.equal(isAllowedOrigin("https://evil.example", origins), false);
  assert.equal(isAllowedOrigin("https://cinteca.es.evil.example", origins), false);
});

test("enforces CORS before processing a public request", async () => {
  const previousOrigins = process.env.ALLOWED_ORIGINS;
  process.env.ALLOWED_ORIGINS = "https://cinteca.es";

  try {
    const blocked = await handler({
      headers: { origin: "https://evil.example" },
      requestContext: { http: { method: "POST" } },
    });
    const preflight = await handler({
      headers: { origin: "https://cinteca.es" },
      requestContext: { http: { method: "OPTIONS" } },
    });

    assert.equal(blocked.statusCode, 403);
    assert.equal(preflight.statusCode, 204);
    assert.equal(
      preflight.headers["Access-Control-Allow-Origin"],
      "https://cinteca.es",
    );
  } finally {
    if (previousOrigins === undefined) delete process.env.ALLOWED_ORIGINS;
    else process.env.ALLOWED_ORIGINS = previousOrigins;
  }
});

test("rejects a site identifier that does not match the request origin", async () => {
  const previousOrigins = process.env.ALLOWED_ORIGINS;
  process.env.ALLOWED_ORIGINS = "https://adrianocaldas.com";

  try {
    const result = await handler({
      headers: {
        origin: "https://adrianocaldas.com",
        "content-type": "application/json",
      },
      requestContext: { http: { method: "POST" } },
      body: JSON.stringify(validPayload),
    });

    assert.equal(result.statusCode, 400);
    assert.match(result.body, /does not match request origin/i);
  } finally {
    if (previousOrigins === undefined) delete process.env.ALLOWED_ORIGINS;
    else process.env.ALLOWED_ORIGINS = previousOrigins;
  }
});
