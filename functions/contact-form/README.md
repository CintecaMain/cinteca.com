# Cinteca contact function

Receives the protected contact forms of `cinteca.es` (this repository, `app/page.tsx`) and `adrianocaldas.com`
(repository `adrianocmcaldas/adrianocaldas.com`, `app/contact-form.tsx`), validates Cloudflare Turnstile server-side
and sends each message by SMTP to one configured recipient, with the sender of the originating site.

It was the AWS Lambda `contact-form-endpoint` (cinteca-prod, eu-central-1, function URL with auth `NONE`). By the
owner's decision D14 (2026-11-22, «Função da plataforma») it runs as a function of the self-hosted platform
(MainServer), environment **General**, and sends through the platform's mail server instead of Amazon SES. The first
commit of this folder is the Lambda's code package as deployed; the next one is the port (its header lists every
change). `test/index.test.mjs` is the Lambda's own suite, unchanged and passing; `test/platform.test.mjs` covers the
platform.

## Contract (unchanged)

The websites send a fixed site identifier (`cinteca` or `adrianocaldas`); the function checks it against the request
origin, keeps one destination mailbox and chooses the sender itself. Sender and recipient never come from the browser.

| Request | Answer |
|---|---|
| `OPTIONS` from an allowed origin | 204 with CORS headers (`POST, OPTIONS`, `Content-Type`, max age 600) |
| `OPTIONS` or `POST` from another origin, or without one | 403 `Origin not allowed.` (no CORS headers) |
| neither `OPTIONS` nor `POST` | 405 |
| not `application/json` | 415 |
| body over 32 KiB | 413 |
| not JSON / fields invalid (name 2-100, e-mail, company <= 120, subject 3-160, message 20-5,000, privacy accepted, known site, token present) | 400 |
| honeypot `website` filled | 202 `{ ok: true }`, nothing sent |
| site does not match the origin | 400 `Site does not match request origin.` |
| Turnstile refused (token, action `contact`, hostname) | 400 `Human verification failed.` |
| settings missing, Cloudflare or SMTP failing | 503 `Contact service temporarily unavailable.` |
| sent | 202 `{ ok: true, requestId }` (the platform's invocation id) |

The function answers CORS itself: nothing in front of it may add CORS headers (the platform adds none).

## On the platform

| Setting | Value |
|---|---|
| Environment | General (the functions environment; its no-reply user sends) |
| Runtime / entry point | Node.js 24 / `index.handler` |
| Time limit | 60 s (as on AWS) |
| Memory / CPU | 0.25 GiB / 0.5 |
| External access | **on**: the sites call `https://<function id>.<General's primary domain>/` from the visitor's browser, as they called the Lambda URL. Every server serves that name with its own runner (no single server) |
| Code | `node functions/pack.mjs contact-form` -> `functions/dist/contact-form.zip` (Functions › the function › Code; the platform runs `npm ci` from the lock) |

Variables (General's are shared by all its containers and functions, hence the prefix; on the platform only these
names count):

| Name | Value |
|---|---|
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER` | already set in General (LeadBIOS): the platform mail server, `465` (TLS from the start), the no-reply user |
| `SMTP_PASSWORD` **S** | General's system secret, injected and rotated by the platform (never set `SMTP_PASS` there) |
| `CINTECA_CONTACT_TO_EMAIL` | the recipient: the same mailbox as the Lambda's `CONTACT_TO_EMAIL` |
| `CINTECA_CONTACT_ALLOWED_ORIGINS` | `https://cinteca.es,https://www.cinteca.es,https://adrianocaldas.com,https://www.adrianocaldas.com` |
| `CINTECA_CONTACT_TURNSTILE_SECRET_KEY` **S** | the Turnstile widget's secret (the Lambda's `TURNSTILE_SECRET_KEY`) |
| `CINTECA_CONTACT_TURNSTILE_EXPECTED_ACTION` | `contact` |
| `CINTECA_CONTACT_TURNSTILE_EXPECTED_HOSTNAMES` | `cinteca.es,www.cinteca.es,adrianocaldas.com,www.adrianocaldas.com` |
| `CINTECA_CONTACT_FROM_EMAIL_CINTECA`, `CINTECA_CONTACT_FROM_EMAIL_AC` | optional: unset, the sender is `Cinteca contact form <no-reply@...>` / `AdrianoCaldas.com contact form <no-reply@...>`. A brand address (`web-cinteca@cinteca.es`, `web-ac@cinteca.es` on AWS) needs the platform to send for that domain first |

The Lambda's development hostname `cinteca-es.acmc.chatgpt.site` is still recognised by `siteForOrigin` (unchanged
code) but is not in the platform's allowed origins or Turnstile hostnames.

## Tests and package

```sh
cd functions/contact-form
npm ci
npm test                                 # 17 cases: the Lambda's 8 and the platform's 9; no network
cd ../.. && node functions/pack.mjs contact-form
```

Build the zip from a checkout with LF line endings (`git -c core.autocrlf=false clone ...`): the same sources then
give the same SHA-256 on every machine.

## Local test

Cloudflare's always-pass pair (sitekey `1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA`) works
for a local run: add the local origin (e.g. `http://localhost:3000`) to the allowed origins, `localhost` to the
expected hostnames, and the action the test widget reports. Never in General.
