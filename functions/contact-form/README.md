# Cinteca contact Lambda

Node.js Lambda that receives the protected contact forms from `cinteca.es` and
`adrianocaldas.com`, validates Cloudflare Turnstile server-side and sends each
message through SMTP to one configured recipient using the sender associated
with the originating website.

## AWS configuration

- Runtime: Node.js 22.x
- Handler: `index.handler`
- Recommended memory: 256 MB
- Recommended timeout: 15 seconds
- Function URL authentication: `NONE` (the endpoint is protected by exact-origin
  checks, payload validation, a honeypot and mandatory Turnstile verification)
- Function URL: `https://u33x6xbn7dq2l5jn66hvv7ovc40bgiye.lambda-url.eu-central-1.on.aws/`

Copy every value from `.env.example` to the Lambda environment. Keep
`TURNSTILE_SECRET_KEY` and SMTP credentials only in Lambda. For production,
prefer encrypted Lambda environment variables or AWS Secrets Manager.

## Message routing

The websites send only a fixed site identifier. The Lambda validates the
identifier against the request origin, keeps one destination mailbox and
selects the sender server-side:

- all messages → `CONTACT_TO_EMAIL`
- `cinteca` → `CONTACT_FROM_EMAIL_CINTECA=web-cinteca@cinteca.es`
- `adrianocaldas` → `CONTACT_FROM_EMAIL_AC=web-ac@cinteca.es`

Do not accept sender or recipient addresses from the browser payload. Both are
resolved exclusively from the Lambda environment.

Leave the AWS-managed Function URL CORS setting empty: the function enforces the
exact origin and returns the required CORS headers itself. Do not configure both
layers to emit CORS headers, because duplicate headers can be rejected by
browsers.

## Turnstile configuration

Configure the Cloudflare Turnstile widget for both production hostnames. Put its
public sitekey in the website as `NEXT_PUBLIC_TURNSTILE_SITE_KEY`; put the secret
key in this Lambda as `TURNSTILE_SECRET_KEY`. The server checks the token,
hostname and `contact` action before SMTP is called.

For local testing only, Cloudflare's official always-pass pair is:

- Sitekey: `1x00000000000000000000AA`
- Secret: `1x0000000000000000000000000000000AA`

Never use the test pair in production.

For an end-to-end local test, temporarily add the required local origin, such
as `http://localhost:3000` or `http://localhost:3001`, to
`ALLOWED_ORIGINS`, add `localhost` to `TURNSTILE_EXPECTED_HOSTNAMES`, and use
`TURNSTILE_EXPECTED_ACTION=test` if the dummy verification response reports the
test action. Remove these development allowances before production.

## Install, test and package

```sh
npm install
npm test
npm prune --omit=dev
zip -r cinteca-contact-lambda.zip index.mjs node_modules package.json
```

Upload the ZIP to the existing Lambda and configure the environment before
enabling the contact form in production.
