import crypto from "node:crypto";
import nodemailer from "nodemailer";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const MAX_BODY_BYTES = 32_768;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SUPPORTED_LANGUAGES = new Set(["pt", "en", "es", "nb"]);
const SUPPORTED_SITES = new Set(["cinteca", "adrianocaldas"]);

const SITE_CONFIG = {
  cinteca: {
    senderEnvironment: "CONTACT_FROM_EMAIL_CINTECA",
    label: "Cinteca",
  },
  adrianocaldas: {
    senderEnvironment: "CONTACT_FROM_EMAIL_AC",
    label: "AdrianoCaldas.com",
  },
};

let transporter;

function splitEnvironmentList(value = "") {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getHeader(event, name) {
  const expected = name.toLowerCase();
  const entry = Object.entries(event?.headers ?? {}).find(
    ([headerName]) => headerName.toLowerCase() === expected,
  );
  return entry?.[1] ?? "";
}

function requestMethod(event) {
  return event?.requestContext?.http?.method ?? event?.httpMethod ?? "";
}

function response(statusCode, body, origin = "") {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    Vary: "Origin",
  };

  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type";
    headers["Access-Control-Max-Age"] = "600";
  }

  return {
    statusCode,
    headers,
    body: body === null ? "" : JSON.stringify(body),
  };
}

function cleanSingleLine(value) {
  return String(value ?? "")
    .replace(/[\r\n\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanMultiline(value) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .trim();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function validatePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, reason: "invalid-payload" };
  }

  const data = {
    name: cleanSingleLine(payload.name),
    email: cleanSingleLine(payload.email).toLowerCase(),
    company: cleanSingleLine(payload.company),
    subject: cleanSingleLine(payload.subject),
    message: cleanMultiline(payload.message),
    website: cleanSingleLine(payload.website),
    turnstileToken: cleanSingleLine(payload.turnstileToken),
    language: SUPPORTED_LANGUAGES.has(payload.language) ? payload.language : "en",
    privacyAccepted: payload.privacyAccepted === true,
    site: cleanSingleLine(payload.site).toLowerCase(),
  };

  if (data.website.length > 0) return { ok: true, honeypot: true, data };
  if (data.name.length < 2 || data.name.length > 100) {
    return { ok: false, reason: "invalid-name" };
  }
  if (data.email.length > 254 || !EMAIL_PATTERN.test(data.email)) {
    return { ok: false, reason: "invalid-email" };
  }
  if (data.company.length > 120) return { ok: false, reason: "invalid-company" };
  if (data.subject.length < 3 || data.subject.length > 160) {
    return { ok: false, reason: "invalid-subject" };
  }
  if (data.message.length < 20 || data.message.length > 5_000) {
    return { ok: false, reason: "invalid-message" };
  }
  if (!data.privacyAccepted) return { ok: false, reason: "privacy-required" };
  if (!SUPPORTED_SITES.has(data.site)) {
    return { ok: false, reason: "invalid-site" };
  }
  if (
    data.turnstileToken.length < 1 ||
    data.turnstileToken.length > 2_048
  ) {
    return { ok: false, reason: "turnstile-required" };
  }

  return { ok: true, honeypot: false, data };
}

export function isAllowedOrigin(origin, configuredOrigins = process.env.ALLOWED_ORIGINS) {
  if (!origin) return false;
  return splitEnvironmentList(configuredOrigins).includes(origin);
}

export function siteForOrigin(origin) {
  let hostname;
  try {
    hostname = new URL(origin).hostname.toLowerCase();
  } catch {
    return null;
  }

  if (
    hostname === "cinteca.es" ||
    hostname === "www.cinteca.es" ||
    hostname === "cinteca-es.acmc.chatgpt.site"
  ) {
    return "cinteca";
  }

  if (hostname === "adrianocaldas.com" || hostname === "www.adrianocaldas.com") {
    return "adrianocaldas";
  }

  return null;
}

export function resolveContactRoute(site, environment = process.env) {
  const config = SITE_CONFIG[site];
  if (!config) throw new Error("Unsupported contact site");

  const to = environment.CONTACT_TO_EMAIL?.trim();
  if (!to) {
    throw new Error("Missing required environment variable: CONTACT_TO_EMAIL");
  }

  const from = environment[config.senderEnvironment]?.trim();
  if (!from) {
    throw new Error(`Missing required environment variable: ${config.senderEnvironment}`);
  }

  return { to, from, label: config.label };
}

function requiredEnvironment(site) {
  const senderEnvironment = SITE_CONFIG[site]?.senderEnvironment;
  const required = [
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_USER",
    "SMTP_PASS",
    "CONTACT_TO_EMAIL",
    "TURNSTILE_SECRET_KEY",
    "ALLOWED_ORIGINS",
    senderEnvironment,
  ].filter(Boolean);
  const missing = required.filter((name) => !process.env[name]?.trim());

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}

async function validateTurnstile(token, remoteIp) {
  const verificationResponse = await fetch(SITEVERIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      secret: process.env.TURNSTILE_SECRET_KEY,
      response: token,
      remoteip: remoteIp || undefined,
      idempotency_key: crypto.randomUUID(),
    }),
    signal: AbortSignal.timeout(8_000),
  });

  if (!verificationResponse.ok) return false;

  const result = await verificationResponse.json();
  if (!result.success) return false;

  const expectedAction = process.env.TURNSTILE_EXPECTED_ACTION || "contact";
  if (expectedAction && result.action !== expectedAction) return false;

  const expectedHostnames = splitEnvironmentList(
    process.env.TURNSTILE_EXPECTED_HOSTNAMES,
  );
  if (expectedHostnames.length > 0 && !expectedHostnames.includes(result.hostname)) {
    return false;
  }

  return true;
}

function getTransporter() {
  if (transporter) return transporter;

  const port = Number.parseInt(process.env.SMTP_PORT, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("SMTP_PORT must be a valid TCP port");
  }

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE === "true",
    requireTLS: process.env.SMTP_REQUIRE_TLS !== "false",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    connectionTimeout: 8_000,
    greetingTimeout: 8_000,
    socketTimeout: 12_000,
  });

  return transporter;
}

async function sendContactEmail(data, requestId) {
  const route = resolveContactRoute(data.site);
  const safeName = escapeHtml(data.name);
  const safeEmail = escapeHtml(data.email);
  const safeCompany = escapeHtml(data.company || "—");
  const safeSubject = escapeHtml(data.subject);
  const safeMessage = escapeHtml(data.message).replaceAll("\n", "<br>");

  await getTransporter().sendMail({
    from: route.from,
    to: route.to,
    replyTo: { name: data.name, address: data.email },
    subject: `[${route.label}] ${data.subject}`,
    text: [
      `Site: ${route.label}`,
      `Name: ${data.name}`,
      `Email: ${data.email}`,
      `Company: ${data.company || "—"}`,
      `Language: ${data.language}`,
      `Request: ${requestId}`,
      "",
      data.message,
    ].join("\n"),
    html: `
      <h2>New ${escapeHtml(route.label)} contact</h2>
      <p><strong>Site:</strong> ${escapeHtml(route.label)}</p>
      <p><strong>Name:</strong> ${safeName}</p>
      <p><strong>Email:</strong> ${safeEmail}</p>
      <p><strong>Company:</strong> ${safeCompany}</p>
      <p><strong>Language:</strong> ${escapeHtml(data.language)}</p>
      <p><strong>Subject:</strong> ${safeSubject}</p>
      <p><strong>Request:</strong> ${escapeHtml(requestId)}</p>
      <hr>
      <p>${safeMessage}</p>
    `,
  });
}

export async function handler(event, context) {
  const origin = getHeader(event, "origin");
  const originAllowed = isAllowedOrigin(origin);
  const method = requestMethod(event).toUpperCase();

  if (method === "OPTIONS") {
    return originAllowed
      ? response(204, null, origin)
      : response(403, { ok: false, message: "Origin not allowed." });
  }

  if (method !== "POST") {
    return response(405, { ok: false, message: "Method not allowed." }, originAllowed ? origin : "");
  }

  if (!originAllowed) {
    return response(403, { ok: false, message: "Origin not allowed." });
  }

  const contentType = getHeader(event, "content-type").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    return response(415, { ok: false, message: "JSON content required." }, origin);
  }

  let rawBody = event?.body ?? "";
  if (event?.isBase64Encoded) rawBody = Buffer.from(rawBody, "base64").toString("utf8");
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return response(413, { ok: false, message: "Request too large." }, origin);
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return response(400, { ok: false, message: "Invalid request." }, origin);
  }

  const validation = validatePayload(payload);
  if (!validation.ok) {
    return response(400, { ok: false, message: "Please review the submitted fields." }, origin);
  }

  // Silently accept bot submissions that filled the hidden field.
  if (validation.honeypot) {
    return response(202, { ok: true }, origin);
  }

  const expectedSite = siteForOrigin(origin);
  if (expectedSite && validation.data.site !== expectedSite) {
    return response(400, { ok: false, message: "Site does not match request origin." }, origin);
  }

  try {
    requiredEnvironment(validation.data.site);
    const remoteIp = event?.requestContext?.http?.sourceIp ?? "";
    const turnstileValid = await validateTurnstile(
      validation.data.turnstileToken,
      remoteIp,
    );

    if (!turnstileValid) {
      return response(400, { ok: false, message: "Human verification failed." }, origin);
    }

    const requestId = context?.awsRequestId ?? crypto.randomUUID();
    await sendContactEmail(validation.data, requestId);
    return response(202, { ok: true, requestId }, origin);
  } catch (error) {
    console.error("Contact delivery failed", {
      requestId: context?.awsRequestId,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return response(503, { ok: false, message: "Contact service temporarily unavailable." }, origin);
  }
}
