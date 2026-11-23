/**
 * The protected contact forms of cinteca.es and adrianocaldas.com, as a function of the self-hosted platform
 * (MainServer, environment General). It replaces the AWS Lambda contact-form-endpoint (cinteca-prod, eu-central-1),
 * whose code it keeps: the same request contract, origin and site checks, honeypot, mandatory Turnstile (token,
 * action and hostname), body limit, answers and status codes. The sites call it from the visitor's browser, as they
 * called the Lambda's function URL, either through the proxy container deploy/contact-proxy in General (external access
 * off; the recommended choice, owner question Q-F8: it limits what reaches the platform's function runners) or at its
 * own public URL https://<function id>.<General's primary domain>/ (external access on). Either way every server
 * serves the name with its own container and runner, so any one server down leaves the form working.
 *
 * Changed for the platform (owner decision D14, 2026-11-22: "Função da plataforma"):
 *   - the message goes through the platform's mail server as General's no-reply user (SMTP_PASSWORD, injected by the
 *     platform), not through Amazon SES; From defaults to "<site> contact form <SMTP_USER>" when no sender of the site
 *     is configured (a brand sender such as web-cinteca@cinteca.es needs a sender grant on the platform first);
 *   - SMTP_SECURE defaults to true on port 465 (the platform's submission port); a temporary SMTP failure is tried
 *     again on a new connection while the call has time left (every call is a new container: no transport to reuse);
 *   - General's variables are shared by all its functions and containers, so on the platform (MAINSERVER_FUNCTION_ID
 *     is set) only the CINTECA_CONTACT_ names count; elsewhere the Lambda's names still work:
 *       CINTECA_CONTACT_TO_EMAIL                       <- CONTACT_TO_EMAIL
 *       CINTECA_CONTACT_FROM_EMAIL_CINTECA, _AC        <- CONTACT_FROM_EMAIL_CINTECA, CONTACT_FROM_EMAIL_AC
 *       CINTECA_CONTACT_ALLOWED_ORIGINS                <- ALLOWED_ORIGINS
 *       CINTECA_CONTACT_TURNSTILE_SECRET_KEY (secret)  <- TURNSTILE_SECRET_KEY
 *       CINTECA_CONTACT_TURNSTILE_EXPECTED_ACTION      <- TURNSTILE_EXPECTED_ACTION
 *       CINTECA_CONTACT_TURNSTILE_EXPECTED_HOSTNAMES   <- TURNSTILE_EXPECTED_HOSTNAMES
 *     SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_REQUIRE_TLS, SMTP_USER and SMTP_PASS (or the platform's SMTP_PASSWORD)
 *     keep their names: they are the environment's mail settings, shared on purpose.
 *   - nodemailer 10.5.0 (9.0.3 on AWS: npm audit reports advisories up to 10.1.3);
 *   - Turnstile's remoteip is the visitor's address: sourceIp when it is public, else (behind the proxy) X-Real-IP.
 */
import crypto from "node:crypto";
import net from "node:net";
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

// The Lambda's variable names and their names on the platform.
const PLATFORM_NAMES = {
  CONTACT_TO_EMAIL: "CINTECA_CONTACT_TO_EMAIL",
  CONTACT_FROM_EMAIL_CINTECA: "CINTECA_CONTACT_FROM_EMAIL_CINTECA",
  CONTACT_FROM_EMAIL_AC: "CINTECA_CONTACT_FROM_EMAIL_AC",
  ALLOWED_ORIGINS: "CINTECA_CONTACT_ALLOWED_ORIGINS",
  TURNSTILE_SECRET_KEY: "CINTECA_CONTACT_TURNSTILE_SECRET_KEY",
  TURNSTILE_EXPECTED_ACTION: "CINTECA_CONTACT_TURNSTILE_EXPECTED_ACTION",
  TURNSTILE_EXPECTED_HOSTNAMES: "CINTECA_CONTACT_TURNSTILE_EXPECTED_HOSTNAMES",
};

// Pauses before the second and the third SMTP try; a new try starts only with this much of the call's time left.
const SMTP_RETRY_PAUSES_MS = [1_000, 3_000];
const SMTP_MIN_REMAINING_MS = 15_000;

// Replaceable in tests (no mail server, no Cloudflare, no waiting).
export const deps = {
  createTransport: (options) => nodemailer.createTransport(options),
  fetch: (...args) => fetch(...args),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** A setting by the Lambda's name: on the platform its CINTECA_CONTACT_ name only, elsewhere either. */
export function setting(name, environment = process.env) {
  const platformName = PLATFORM_NAMES[name];
  const prefixed = platformName ? environment[platformName] : undefined;
  if (typeof prefixed === "string" && prefixed.trim()) return prefixed.trim();
  if (platformName && environment.MAINSERVER_FUNCTION_ID) return "";
  const value = environment[name];
  return typeof value === "string" ? value.trim() : "";
}

function smtpPassword(environment = process.env) {
  return environment.SMTP_PASS || environment.SMTP_PASSWORD || "";
}

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

// Addresses that are never a visitor's: the platform's own networks (containers, mesh), loopback and link-local.
const PRIVATE_ADDRESSES = new net.BlockList();
for (const [prefix, bits] of [["10.0.0.0", 8], ["172.16.0.0", 12], ["192.168.0.0", 16], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["100.64.0.0", 10], ["0.0.0.0", 8]]) PRIVATE_ADDRESSES.addSubnet(prefix, bits, "ipv4");
for (const [prefix, bits] of [["::", 127], ["fc00::", 7], ["fe80::", 10]]) PRIVATE_ADDRESSES.addSubnet(prefix, bits, "ipv6");

/** An IP address as { address, private }, or null; an IPv4-mapped IPv6 address counts as its IPv4 address. */
function parseAddress(value) {
  const address = String(value ?? "").trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, "");
  const family = net.isIP(address);
  if (family === 0) return null;
  return { address, private: PRIVATE_ADDRESSES.check(address, family === 4 ? "ipv4" : "ipv6") };
}

/**
 * The visitor's address, for Turnstile's optional remoteip. A public call (external access on, as the Lambda URL) has
 * it as sourceIp. Behind the platform proxy (deploy/contact-proxy: external access off, the call comes from the proxy
 * container through <id>.internal) sourceIp is the proxy's private address and the proxy sends the visitor's in
 * X-Real-IP, overwriting any value the visitor sent. X-Real-IP is read only when sourceIp is private (only a container
 * of the environment can then be the caller). No public address found: no remoteip (Cloudflare does not require it).
 */
export function visitorAddress(event) {
  const source = parseAddress(event?.requestContext?.http?.sourceIp);
  if (!source) return "";
  if (!source.private) return source.address;
  const forwarded = parseAddress(getHeader(event, "x-real-ip"));
  return forwarded && !forwarded.private ? forwarded.address : "";
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

export function isAllowedOrigin(origin, configuredOrigins = setting("ALLOWED_ORIGINS")) {
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

/** The site's sender, else "<label> contact form <SMTP_USER>" (the platform's no-reply user). */
function senderFor(config, environment) {
  const configured = setting(config.senderEnvironment, environment);
  if (configured) return configured;
  const smtpUser = (environment.SMTP_USER ?? "").trim();
  return smtpUser.includes("@") ? `${config.label} contact form <${smtpUser}>` : "";
}

export function resolveContactRoute(site, environment = process.env) {
  const config = SITE_CONFIG[site];
  if (!config) throw new Error("Unsupported contact site");

  const to = setting("CONTACT_TO_EMAIL", environment);
  if (!to) {
    throw new Error("Missing required environment variable: CONTACT_TO_EMAIL");
  }

  const from = senderFor(config, environment);
  if (!from) {
    throw new Error(`Missing required environment variable: ${config.senderEnvironment}`);
  }

  return { to, from, label: config.label };
}

function requiredEnvironment(site, environment = process.env) {
  const missing = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER"].filter((name) => !environment[name]?.trim());
  if (!smtpPassword(environment)) missing.push("SMTP_PASSWORD");
  for (const name of ["CONTACT_TO_EMAIL", "TURNSTILE_SECRET_KEY", "ALLOWED_ORIGINS"]) {
    if (!setting(name, environment)) missing.push(PLATFORM_NAMES[name]);
  }
  const config = SITE_CONFIG[site];
  if (config && !senderFor(config, environment)) missing.push(PLATFORM_NAMES[config.senderEnvironment]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}

async function validateTurnstile(token, remoteIp) {
  const verificationResponse = await deps.fetch(SITEVERIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      secret: setting("TURNSTILE_SECRET_KEY"),
      response: token,
      remoteip: remoteIp || undefined,
      idempotency_key: crypto.randomUUID(),
    }),
    signal: AbortSignal.timeout(8_000),
  });

  if (!verificationResponse.ok) return false;

  const result = await verificationResponse.json();
  if (!result.success) return false;

  const expectedAction = setting("TURNSTILE_EXPECTED_ACTION") || "contact";
  if (expectedAction && result.action !== expectedAction) return false;

  const expectedHostnames = splitEnvironmentList(setting("TURNSTILE_EXPECTED_HOSTNAMES"));
  if (expectedHostnames.length > 0 && !expectedHostnames.includes(result.hostname)) {
    return false;
  }

  return true;
}

export function transportOptions(environment = process.env) {
  const port = Number.parseInt(environment.SMTP_PORT, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("SMTP_PORT must be a valid TCP port");
  }
  const secure = environment.SMTP_SECURE ? environment.SMTP_SECURE === "true" : port === 465;

  return {
    host: environment.SMTP_HOST,
    port,
    secure,
    requireTLS: environment.SMTP_REQUIRE_TLS !== "false",
    auth: {
      user: environment.SMTP_USER,
      pass: smtpPassword(environment),
    },
    tls: { minVersion: "TLSv1.2" },
    connectionTimeout: 8_000,
    greetingTimeout: 8_000,
    socketTimeout: 12_000,
  };
}

/** A failure a new try can fix: no connection or no answer, or a 4xx (rate limit, greylisting, restart). */
export function isTemporarySmtpError(error) {
  const code = Number(error?.responseCode);
  if (Number.isInteger(code) && code > 0) return code >= 400 && code < 500;
  return ["ECONNECTION", "ETIMEDOUT", "ESOCKET", "EDNS", "ECONNREFUSED", "ECONNRESET", "EPIPE", "EAI_AGAIN"].includes(
    error?.code,
  );
}

async function sendWithRetry(message, context) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await deps.createTransport(transportOptions()).sendMail(message);
    } catch (error) {
      const pause = SMTP_RETRY_PAUSES_MS[attempt];
      const remaining =
        typeof context?.getRemainingTimeInMillis === "function" ? context.getRemainingTimeInMillis() : Infinity;
      if (pause === undefined || !isTemporarySmtpError(error) || remaining - pause < SMTP_MIN_REMAINING_MS) {
        throw error;
      }
      console.warn("Contact delivery retry", { attempt: attempt + 1, code: error?.responseCode ?? error?.code });
      await deps.sleep(pause);
    }
  }
}

export function buildContactEmail(data, requestId, route) {
  const safeName = escapeHtml(data.name);
  const safeEmail = escapeHtml(data.email);
  const safeCompany = escapeHtml(data.company || "—");
  const safeSubject = escapeHtml(data.subject);
  const safeMessage = escapeHtml(data.message).replaceAll("\n", "<br>");

  return {
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
  };
}

async function sendContactEmail(data, requestId, context) {
  const route = resolveContactRoute(data.site);
  await sendWithRetry(buildContactEmail(data, requestId, route), context);
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
    const remoteIp = visitorAddress(event);
    const turnstileValid = await validateTurnstile(
      validation.data.turnstileToken,
      remoteIp,
    );

    if (!turnstileValid) {
      return response(400, { ok: false, message: "Human verification failed." }, origin);
    }

    const requestId = context?.awsRequestId || crypto.randomUUID();
    await sendContactEmail(validation.data, requestId, context);
    return response(202, { ok: true, requestId }, origin);
  } catch (error) {
    console.error("Contact delivery failed", {
      requestId: context?.awsRequestId,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return response(503, { ok: false, message: "Contact service temporarily unavailable." }, origin);
  }
}
