# www.cinteca.online — identity page

The public page that says who operates cinteca.online, what it is for, how to report abuse or reach the postmaster,
and a short privacy note, in English (`/`), Spanish (`/es/`) and Portuguese (`/pt/`). cinteca.online hosts the
sign-in and account service (OAuth) of the Cinteca group's applications; mailbox providers and abuse desks look for
this page before they trust the messages it sends.

This folder is self-contained. The Next.js site at the repository root (cinteca.es) neither uses nor builds it.

## Facts on the page

- Operator: AD Caldas Innotec SA, registered in Spain, CIF A66316399 (owner decision of 2026-11-05 for the
  platform's identity).
- Contact for abuse, the postmaster and personal data questions: admin@cinteca.cloud.
- Purpose: the group's sign-in and account service; only transactional messages (account verification, password
  reset) to people who asked for them.
- Privacy: no cookies, scripts, analytics, trackers or outside resources; the web server's technical access logs;
  the contact details people register are used to run their account, sign them in and send those messages.

A change of any of these facts is the owner's decision. Update all three languages and the "Last updated" date.

## Files

| Path | What |
|---|---|
| `public/` | The pages (`index.html`, `es/`, `pt/`, `404.html`), `site.css`, `favicon.svg`, `robots.txt` |
| `deploy/nginx.conf` | nginx: port 8080, `/healthz`, `/en/` → `/`, 404 page, Cache-Control |
| `deploy/security-headers.conf` | HSTS (one year, this host only), a CSP with no script or outside origin, and the other headers |
| `deploy/container.yml` | The platform CI/CD configuration (build context `sites/cinteca-online`) |
| `Dockerfile` | `nginxinc/nginx-unprivileged` pinned by digest, uid 101, port 8080, a `HEALTHCHECK` on `/healthz` |

## Run it locally

```bash
docker build -t cinteca-online-identity sites/cinteca-online
docker run --rm --read-only --tmpfs /tmp -p 8080:8080 cinteca-online-identity
# http://localhost:8080/ , /es/ , /pt/ , /healthz
```

## Deploy on the platform

Containers › Running › Deploy, in the OAuth environment, for the container that serves `www.cinteca.online`:
repository `CintecaMain/cinteca.com`, branch `migration/mainserver`, configuration file
`sites/cinteca-online/deploy/container.yml`, HTTP port 8080. No variables, mounts, command or migrations.
