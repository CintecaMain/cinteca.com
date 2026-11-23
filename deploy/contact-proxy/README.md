# Contact forms' proxy (platform container, environment General)

Prepared for the owner's choice in the AWS exit (forms runbook, question Q-F8); **not deployed**. With it, the
platform function `CintecaContact` (`functions/contact-form`) keeps its **external access off**, and the contact forms
of `cinteca.es` and `adrianocaldas.com` post to this container instead of to the function's own public URL.

## Why

On the platform every server runs one function runner, which admits at most 32 calls at once
(`FUNCTIONS_MAX_CONCURRENT`, one counter for every environment's functions on that server) and starts a new container
for every call, `OPTIONS` and `GET` included. A public function with nothing in front lets one flood of cheap requests
fill those slots on all three servers at the same time, and then LeadBIOS, WebsiteContact, the Meta webhook and the
other environments' functions get 429 everywhere. On AWS the same flood hit only that one Lambda. This proxy puts
limits in front, as the nordixsystems.com and ncsengine.com containers do for their forms:

| Limit | Value | Answer |
|---|---|---|
| per visitor (address from Traefik's `X-Forwarded-For`) | 6 at once, then 2 a minute (a submission is a preflight and a POST; the browser keeps the preflight 600 s) | 429 `Retry-After: 60` |
| per server, all visitors | 10 at once, then 10 a minute | 429 |
| per server, calls in flight to the function | 4 (of 32) | 429 |
| methods | `POST` and `OPTIONS` on `/` only | 403 (other methods), 404 (other paths), no function call |
| body | 64 KiB (the function's own 413 starts at 32 KiB) | 413 |

During a flood the form itself may answer 429 to real visitors for a while: the other functions stay available.
The function still answers CORS and checks the Origin, the site, the honeypot and Turnstile itself. nginx adds no CORS
header; its own answers (429, 503) therefore look like a failed request to the browser, and the forms show their error
message, as for any failure.

The visitor's address reaches the function in `X-Real-IP` (nginx replaces any value the visitor sent); the function
reads that header only when the caller is a private address (`visitorAddress` in `functions/contact-form/index.mjs`)
and passes it to Turnstile as `remoteip`.

## On the platform

| Setting | Value |
|---|---|
| Environment | General (where `CintecaContact` runs: `http://<function id>.internal` resolves only there) |
| Repository / config path | `CintecaMain/cinteca.com`, `deploy/contact-proxy/container.yml` (build context this folder) |
| Hostname | `cinteca-contact` in General's primary domain: `https://cinteca-contact.<General's primary domain>/` (protected CNAME and certificate by the platform) |
| Internal port | 8080 |
| Run mode / instances | continuous, 1 per server, **maximum 1** (the per-server limits are per instance) |
| Limits | 0.25 vCPU, 128 MiB |
| Secrets | none (`secretVariables: none`: nginx needs no secret) |
| Variable | `CINTECA_CONTACT_FUNCTION_URL` = `http://<function id>.internal` (unset: every form call is a 503) |

Each server's instance calls its own server's gateway and runner, and Traefik on a server uses another server's
instance only while its own is not healthy: any one of the three servers down leaves the forms working on the others.

## Files

- `nginx.conf`: the server, the limits and the route; checked with `nginx -t` at image build.
- `function-routes.sh`, `function-proxy.conf`: the same as ncsengine.com's (`NCSengine/website`, `deploy/`): the
  function URL from the environment at start, the proxy settings (no retry: a message is never sent twice by nginx).
- `Dockerfile`, `container.yml`: the image (`nginxinc/nginx-unprivileged`, uid 101, port 8080, `HEALTHCHECK /healthz`).

Tests: `node --test tests/contact-proxy.test.mjs` (the start script on, off and malformed; the limits and the route in
`nginx.conf`). There is no local nginx check: the image build runs `nginx -t`, and a failed build changes nothing.
