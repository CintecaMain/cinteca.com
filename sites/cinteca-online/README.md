# www.cinteca.online — identity page

The public page that says who operates cinteca.online, what it is for, how to report abuse or reach the postmaster,
and a short privacy note, in English (`/`), Spanish (`/es/`) and Portuguese (`/pt/`). cinteca.online hosts the
sign-in and account service (OAuth) of Cinteca's applications; mailbox providers and abuse desks look for this page
before they trust the messages it sends.

This folder is self-contained. The Next.js site at the repository root (cinteca.es) neither uses nor builds it.

## Facts on the page

- Operator: AD Caldas Innotec, S.A., registered in Spain, NIF A66316399 — the form the company site uses (owner
  decisions of 2026-11-05 and 2026-11-18).
- Cinteca is the technology brand of AD Caldas Innotec, S.A. (the wording of the company site, `app/i18n.ts`).
- Contact for abuse, the postmaster and personal data questions: admin@cinteca.cloud.
- Purpose: the sign-in and account service of Cinteca's applications; only transactional messages (account
  verification, password reset) to people who asked for them.
- Privacy: no cookies, scripts, analytics, trackers or outside resources; the contact details people register are
  used to run their account, sign them in and send those messages; and what the logs hold and for how long:
  - nginx's access log (`log_format main` in `deploy/nginx.conf`): the visitor's address (`X-Forwarded-For`) and the
    platform proxy's (`$remote_addr`), date and time, the request line (method, page, protocol), status, bytes sent,
    referring page and browser identification (`$remote_user` is always empty: no authentication). It is the
    container's output: the platform keeps it 30 days or 1 GiB per container and server, whichever comes first
    (MainServer `docs/memory/log-and-metric-retention.md`, Loki), and Docker's local log of each running instance
    holds up to 5 × 20 MB until the instance is replaced (agent `createInstance`, `LogConfig`).
  - Traefik's access log on the platform (the proxy in front): client address, host, method, path and query,
    status, sizes and duration, no request headers; kept up to 365 days or 1 GiB (MainServer
    `infra/runbooks/traefik.md`).
  This short note stays until the full privacy policy, which comes with the move of the sign-in service (owner
  decision of 2026-11-18). A change of the log format or of the platform's retention changes this note.

A change of any of these facts is the owner's decision. Update all three languages and the "Last updated" date.

## Files

| Path | What |
|---|---|
| `public/` | The pages (`index.html`, `es/`, `pt/`, `404.html`), `site.css`, `favicon.svg`, `robots.txt` |
| `deploy/nginx.conf` | nginx: port 8080, plain HTTP → HTTPS (301, not `/healthz`), `/healthz` (never cached), `/en/` → `/`, 404 page, Cache-Control |
| `deploy/security-headers.conf` | HSTS (one year, this host only, HTTPS answers only), a CSP with no script or outside origin, and the other headers |
| `deploy/container.yml` | The platform CI/CD configuration (build context `sites/cinteca-online`) |
| `Dockerfile` | `nginxinc/nginx-unprivileged` pinned by digest, uid 101, port 8080, configuration and pages root's and read-only, a `HEALTHCHECK` on `/healthz` |
| `local-test.sh` | The local test below |

## Test it locally

```bash
bash sites/cinteca-online/local-test.sh    # Docker, bash and curl; prints PASS/FAIL lines and ends with ALL PASS
```

The test builds the image and checks it the way the platform runs it. The platform starts every instance as a new
container of the image, as the image's own user (uid 101), on the image's own file system and `/tmp` (no tmpfs over
it), with no-new-privileges and the container's CPU and memory limits. A `docker run --read-only --tmpfs /tmp` alone
is not enough: the fresh `/tmp` hides files the build leaves there, and that is how the first deployment failed
(`nginx -t` at build time left a root-owned `/tmp/nginx.pid`, so nginx as uid 101 could not start). So the test:

1. checks that the image's user is 101, that nothing in the image's `/tmp` belongs to another user, and that
   `/etc/nginx`, the pages, `/var/cache/nginx` and the entrypoint belong to root with no group or other write
   (each `docker run` of these checks must also exit 0);
2. **run 1, as the platform:** a new container with `--security-opt no-new-privileges --cpus 0.5 --memory 256m
   --memory-swap 256m --pids-limit 4096` and no tmpfs; it must become healthy and run as uid 101;
3. **run 2, read-only root file system:** a new container with `--read-only --tmpfs /tmp --cap-drop ALL`; the image
   must work there too;
4. in both runs, sending `X-Forwarded-Proto` as Traefik does (and none where the health check sends none): 200 on
   `/`, `/es/`, `/pt/`, `/healthz`, `/site.css`, `/favicon.svg`, `/robots.txt`; `/es`, `/pt`, `/en`, `/en/`
   redirected; plain HTTP answered `301 https://www.cinteca.online/…` (path and query kept) except `/healthz` (200);
   404s and 405; the eight security headers and `Server: nginx` without a version, with HSTS on HTTPS answers only;
   Cache-Control (`no-cache` on pages and every redirect, `no-store` on `/healthz`, one hour on the stylesheet); the
   facts above, the privacy note's log fields and retention in all three languages; no script or outside resource;
   as uid 101, no way to change or add a configuration file or a page (create, `mkdir`, symlink, append, `chmod`,
   replace by `mv`); no nginx error line.

The test fails against an image where uid 101 can write `/etc/nginx` (the base image's modes, or the `Dockerfile` of
ab8dca1): the ownership check and the write attempts of run 1 report it.

To look at it in a browser: `docker run --rm --security-opt no-new-privileges -p 8080:8080 cinteca-online-identity:test`,
then http://localhost:8080/.

## Deploy on the platform

Containers › Running › Deploy, in the OAuth environment, for the container that serves `www.cinteca.online`:
repository `CintecaMain/cinteca.com`, branch `migration/mainserver`, configuration file
`sites/cinteca-online/deploy/container.yml`, HTTP port 8080. No variables, mounts, command or migrations.

Since 2026-11-18 the registry delegates cinteca.online to the platform's name servers, and the ingress serves a
Let's Encrypt certificate for `www.cinteca.online` (the platform's DNS-01 validation, no HTTP challenge). So nginx
redirects plain HTTP to HTTPS: Traefik forwards both of its entry points to port 8080 and sets `X-Forwarded-Proto`
(`http` or `https`; it replaces a client's own forwarded headers, the platform trusts none, MainServer
`infra/runbooks/traefik.md`), and on `http` nginx answers `301 https://<host><path and query>`. `/healthz` is never
redirected: the platform routes an instance only while the image's `HEALTHCHECK` passes, and Docker runs that check
inside the container on `http://127.0.0.1:8080/healthz`, without the header (Traefik has no active check on this
route). HSTS goes only on the HTTPS answers. The platform's own HTTP → HTTPS switch (`TRAEFIK_HTTPS_REDIRECT`) is off;
it would cover every environment's name, so this page does its own.
