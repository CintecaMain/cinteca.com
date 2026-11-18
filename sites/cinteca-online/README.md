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
- Privacy: no cookies, scripts, analytics, trackers or outside resources; the web server's technical access logs;
  the contact details people register are used to run their account, sign them in and send those messages. This
  short note stays until the full privacy policy, which comes with the move of the sign-in service (owner decision
  of 2026-11-18).

A change of any of these facts is the owner's decision. Update all three languages and the "Last updated" date.

## Files

| Path | What |
|---|---|
| `public/` | The pages (`index.html`, `es/`, `pt/`, `404.html`), `site.css`, `favicon.svg`, `robots.txt` |
| `deploy/nginx.conf` | nginx: port 8080, `/healthz` (never cached), `/en/` → `/`, 404 page, Cache-Control |
| `deploy/security-headers.conf` | HSTS (one year, this host only), a CSP with no script or outside origin, and the other headers |
| `deploy/container.yml` | The platform CI/CD configuration (build context `sites/cinteca-online`) |
| `Dockerfile` | `nginxinc/nginx-unprivileged` pinned by digest, uid 101, port 8080, a `HEALTHCHECK` on `/healthz` |
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

1. checks that the image's user is 101 and that nothing in the image's `/tmp` belongs to another user;
2. **run 1, as the platform:** a new container with `--security-opt no-new-privileges --cpus 0.5 --memory 256m
   --memory-swap 256m --pids-limit 4096` and no tmpfs; it must become healthy, run as uid 101, and uid 101 must not
   be able to write the pages or the configuration;
3. **run 2, read-only root file system:** a new container with `--read-only --tmpfs /tmp --cap-drop ALL`; the image
   must work there too;
4. in both runs: 200 on `/`, `/es/`, `/pt/`, `/healthz`, `/site.css`, `/favicon.svg`, `/robots.txt`; the redirects,
   404s and 405; the eight security headers and `Server: nginx` without a version on a page, `/healthz` and a 404;
   Cache-Control (`no-cache` on pages, `no-store` on `/healthz`, one hour on the stylesheet); the facts above in all
   three languages; no script or outside resource; no nginx error line.

To look at it in a browser: `docker run --rm --security-opt no-new-privileges -p 8080:8080 cinteca-online-identity:test`,
then http://localhost:8080/.

## Deploy on the platform

Containers › Running › Deploy, in the OAuth environment, for the container that serves `www.cinteca.online`:
repository `CintecaMain/cinteca.com`, branch `migration/mainserver`, configuration file
`sites/cinteca-online/deploy/container.yml`, HTTP port 8080. No variables, mounts, command or migrations.

Plain HTTP is not redirected to HTTPS yet: until the public name servers of cinteca.online point to the platform,
the ingress has no certificate for `www.cinteca.online` (it serves its default one), and a redirect would send
visitors to a certificate error. Once a valid certificate is served, nginx can answer `301 https://…` when
`X-Forwarded-Proto` is `http`, keeping `/healthz` on plain HTTP.
