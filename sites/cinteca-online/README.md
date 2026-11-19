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
  Its last item links to the full policy in the same language. Its proxy sentence uses the policy's words («up to about
  one year after their log file is closed», the recommendation of the owner's notes, since the file closes only every
  100 MiB) and, with the "Last updated" date, carries the policy's placeholders C9 and C1: the build refuses them too
  until they are replaced together with the policy's, and `local-test.sh` checks that note and policy say the same.

A change of any of these facts is the owner's decision. Update all three languages and the "Last updated" date.

## Full privacy policy (draft for the owner's approval)

`/privacy/`, `/es/privacidad/` and `/pt/privacidade/` (the Portuguese is Brazilian, as the identity page): the full
policy of the sign-in service (auth.cinteca.online, login.cinteca.online), of this site and of messages to
admin@cinteca.cloud, structured after GDPR art. 13/14, the LOPDGDD and the LGPD (W1 runbook item CPOL, approval PP12
with L1-L6). Every fact comes from: this page; the authapi code and `docs/platform.md` (data and fields, code and
token lifetimes per client and the device code's, hashing, no cookie and no browser storage on the login portal, no
consent screen for the first-party clients, the BIOS internal endpoints and the BIOS reclaim of an unverified account,
client `nordix-tpv`'s lookups by account code and by id (used by NordixSys-API `terminal/customers` and others), the
message-preference register keyed by business, with people who have no account, no automatic deletion of the
database records); the platform facts of the legal notes (`juridico-revisao.md`,
`decisoes-dono-pt.md`: BelHost eu-1 Amsterdam, ITLDC eu-2 Milan, Cherry Servers us-1 Chicago, each with a full copy;
encrypted backups at Backblaze B2 in Virginia for 90 days + ~30; encrypted network between servers; mail over TLS when
the receiving server accepts it); and the W1 runbook (the stopped copy at AWS Frankfurt kept for rollback).

Every fact or legal choice the notes do not settle (controller, registered office, DPO/encarregado, legal bases,
transfer safeguards, DPAs, several retention periods, SMS, minimum age, change notices, the publication date) is a
marked placeholder `[[TO CONFIRM: Cn — …]]`, the same numbers in the three languages. The image's build refuses any
page that still holds `[[TO CONFIRM` (`Dockerfile`), so a deployment of this branch fails until the owner approves the
text and the placeholders are replaced; the current pages stay live meanwhile. At publication: replace every
placeholder (and its `<mark>`) in the three languages of the policy and of the identity pages (C9's proxy sentence and
C1's date, as `<time datetime="YYYY-MM-DD">`), then run `local-test.sh` without `ALLOW_DRAFT`.

## Files

| Path | What |
|---|---|
| `public/` | The pages (`index.html`, `es/`, `pt/`, `404.html`), the privacy policy (`privacy/`, `es/privacidad/`, `pt/privacidade/`), `site.css`, `favicon.svg`, `robots.txt` |
| `deploy/nginx.conf` | nginx: port 8080, plain HTTP → HTTPS (301, not `/healthz`), `/healthz` (never cached), `/en/` → `/`, 404 page, Cache-Control |
| `deploy/security-headers.conf` | HSTS (one year, this host only, HTTPS answers only), a CSP with no script or outside origin, and the other headers |
| `deploy/container.yml` | The platform CI/CD configuration (build context `sites/cinteca-online`) |
| `Dockerfile` | `nginxinc/nginx-unprivileged` pinned by digest, uid 101, port 8080, configuration and pages root's and read-only, a `HEALTHCHECK` on `/healthz`, and the build refuses draft text (`[[TO CONFIRM`) unless `ALLOW_DRAFT=1` |
| `local-test.sh` | The local test below |

## Test it locally

```bash
bash sites/cinteca-online/local-test.sh    # Docker, bash and curl; prints PASS/FAIL lines and ends with ALL PASS
ALLOW_DRAFT=1 bash sites/cinteca-online/local-test.sh    # while a page still holds draft text
```

While a page holds `[[TO CONFIRM`, the plain run stops at the build, as the platform would; with `ALLOW_DRAFT=1` the
image is built with the draft and the test also checks that a build without the argument still refuses it.

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
   `/`, `/es/`, `/pt/`, the three policy pages, `/healthz`, `/site.css`, `/favicon.svg`, `/robots.txt`; `/es`, `/pt`,
   `/en`, `/en/` and the policy folders without their slash redirected; plain HTTP answered `301 https://www.cinteca.online/…` (path and query kept) except `/healthz` (200);
   404s and 405; the eight security headers and `Server: nginx` without a version, with HSTS on HTTPS answers only;
   Cache-Control (`no-cache` on pages and every redirect, `no-store` on `/healthz`, one hour on the stylesheet); the
   facts above, the privacy note's log fields and retention and its link to the policy in all three languages; the
   policy's controller, contact, servers, backup provider, laws, authorities, retention and cookie statement, its
   three languages linked to each other; no script or outside resource;
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

The policy draft sits on this branch since c57be1d; the live image is 93d57fc's. Until the owner approves it (W1
PP12) and the placeholders are replaced, a deployment from this branch stops at the build, by design. If the identity
page must be redeployed before that, or the owner does not approve the policy, first revert the policy commits on this
branch (from c57be1d on), so the branch builds the 93d57fc pages again.

Since 2026-11-18 the registry delegates cinteca.online to the platform's name servers, and the ingress serves a
Let's Encrypt certificate for `www.cinteca.online` (the platform's DNS-01 validation, no HTTP challenge). So nginx
redirects plain HTTP to HTTPS: Traefik forwards both of its entry points to port 8080 and sets `X-Forwarded-Proto`
(`http` or `https`; it replaces a client's own forwarded headers, the platform trusts none, MainServer
`infra/runbooks/traefik.md`), and on `http` nginx answers `301 https://<host><path and query>`. `/healthz` is never
redirected: the platform routes an instance only while the image's `HEALTHCHECK` passes, and Docker runs that check
inside the container on `http://127.0.0.1:8080/healthz`, without the header (Traefik has no active check on this
route). HSTS goes only on the HTTPS answers. The platform's own HTTP → HTTPS switch (`TRAEFIK_HTTPS_REDIRECT`) is off;
it would cover every environment's name, so this page does its own.
