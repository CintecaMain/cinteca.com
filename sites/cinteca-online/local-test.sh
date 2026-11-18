#!/usr/bin/env bash
# Local test of the identity page image, run the way the platform runs it. Needs Docker, bash and curl.
#   bash sites/cinteca-online/local-test.sh          (PORT=18080 by default; prints PASS/FAIL lines, exit 0 = all pass)
#
# The platform's agent starts each instance as a new container of the image (MainServer
# backend/src/agent/containers/module.ts, createInstance): the image's own user (USER 101), the image's own /tmp
# (no tmpfs over it), no-new-privileges, the container's CPU and memory limits (0.5 vCPU, 256 MiB here) and a 4096
# pids limit. Run 1 does exactly that, so a file the build leaves in /tmp owned by root (the nginx.pid of the first
# deployment) makes nginx exit and the test fail. Run 2 adds a read-only root file system with a fresh /tmp: the
# image must work there too, but that run alone would hide such leftovers, so it is never the only check.
set -u
export MSYS_NO_PATHCONV=1  # Git Bash on Windows: keep /tmp and other container paths as they are.
cd "$(dirname "$0")" || exit 2
IMG=cinteca-online-identity:test
NAME=cinteca-online-identity-test
PORT=${PORT:-18080}
B="http://127.0.0.1:$PORT"
fail=0
ok() { echo "PASS $*"; }
ko() { echo "FAIL $*"; fail=1; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

docker build -q -t "$IMG" . >/dev/null || { echo "FAIL build"; exit 1; }
ok "build $IMG"
[ "$(docker inspect -f '{{.Config.User}}' "$IMG")" = 101 ] && ok "image user 101" || ko "image user is not 101"
# Nothing the build left in /tmp may belong to anyone but nginx's user.
left=$(docker run --rm --entrypoint find "$IMG" /tmp -mindepth 1 ! -user 101)
[ -z "$left" ] && ok "no file in the image's /tmp owned by another user" || ko "files in /tmp not owned by 101: $left"

check() {
  docker rm -f "$NAME" >/dev/null 2>&1
  docker run -d --name "$NAME" "$@" -p 127.0.0.1:$PORT:8080 "$IMG" >/dev/null || { ko "run"; return; }
  h=starting
  for i in $(seq 1 30); do
    h=$(docker inspect -f '{{.State.Health.Status}}' "$NAME" 2>/dev/null)
    [ "$h" = healthy ] && break
    [ "$(docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null)" = true ] || break
    sleep 1
  done
  if [ "$h" != healthy ]; then
    ko "container health: $h"; docker logs "$NAME" 2>&1 | tail -5; docker rm -f "$NAME" >/dev/null 2>&1; return
  fi
  ok "healthy after ~${i}s"
  [ "$(docker exec "$NAME" id -u)" = 101 ] && ok "nginx runs as uid 101" || ko "nginx is not uid 101"
  # uid 101 may write in /tmp (and nginx's cache folder), not the pages or the configuration.
  docker exec "$NAME" sh -c 'for f in /usr/share/nginx/html/new /usr/share/nginx/html/index.html \
      /usr/share/nginx/html/es/index.html /etc/nginx/nginx.conf /etc/nginx/security-headers.conf; do
      touch "$f" 2>/dev/null && { echo "$f"; exit 0; }; done; exit 1' \
    && ko "uid 101 can write the file above" || ok "pages and configuration read-only for uid 101"
  for p in / /es/ /pt/ /healthz /site.css /favicon.svg /robots.txt; do
    c=$(code "$B$p"); [ "$c" = 200 ] && ok "GET $p 200" || ko "GET $p $c"
  done
  # Relative Location (absolute_redirect off): the browser keeps the scheme and host it used.
  for r in "/es /es/" "/en/ /"; do
    c=$(curl -s -D - -o /dev/null "$B${r% *}" | tr -d '\r' | sed -n -e '1s/^HTTP[^ ]* \([0-9]*\).*/\1/p' -e 's/^[Ll]ocation: //p' | paste -sd ' ')
    [ "$c" = "301 ${r#* }" ] && ok "GET ${r% *} 301 ${r#* }" || ko "GET ${r% *} $c"
  done
  c=$(code "$B/nope"); [ "$c" = 404 ] && ok "GET /nope 404" || ko "GET /nope $c"
  c=$(code "$B/404.html"); [ "$c" = 404 ] && ok "GET /404.html 404" || ko "GET /404.html $c"
  c=$(code -X POST "$B/"); [ "$c" = 405 ] && ok "POST / 405" || ko "POST / $c"
  [ "$(curl -s "$B/healthz")" = ok ] && ok "/healthz says ok" || ko "/healthz body"
  for p in / /healthz /nope; do
    H=$(curl -s -D - -o /dev/null "$B$p" | tr -d '\r')
    n=0
    for want in "Strict-Transport-Security: max-age=31536000" \
      "Content-Security-Policy: default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" \
      "X-Content-Type-Options: nosniff" "X-Frame-Options: DENY" "Referrer-Policy: no-referrer" \
      "Permissions-Policy: camera=(), geolocation=(), microphone=(), payment=(), usb=()" \
      "Cross-Origin-Opener-Policy: same-origin" "Cross-Origin-Resource-Policy: same-origin" "Server: nginx"; do
      grep -qixF "$want" <<<"$H" && n=$((n + 1)) || ko "$p lacks: $want"
    done
    [ $n = 9 ] && ok "$p 8 security headers and Server: nginx without version"
  done
  for want in "/ Cache-Control: no-cache" "/healthz Cache-Control: no-store" "/site.css Cache-Control: public, max-age=3600" \
    "/ Content-Type: text/html; charset=utf-8"; do
    p=${want%% *}; hd=${want#* }
    curl -s -D - -o /dev/null "$B$p" | tr -d '\r' | grep -qixF "$hd" && ok "$p $hd" || ko "$p lacks $hd"
  done
  for p in / /es/ /pt/; do
    body=$(curl -s "$B$p")
    for want in "AD Caldas Innotec, S.A." "NIF A66316399" "admin@cinteca.cloud" "OAuth" 'href="/es/"' 'href="/pt/"' 'href="/"'; do
      grep -qF "$want" <<<"$body" || ko "$p lacks $want"
    done
    grep -qE 'CIF|Innotec SA|[Gg]rupo|[Gg]roup' <<<"$body" && ko "$p has an old legal form or the group wording"
    grep -qiE '<script|<iframe|<img|<object|<embed| on[a-z]+=|@import|url\(|<link[^>]+rel="(stylesheet|icon|preload|prefetch|preconnect|dns-prefetch|modulepreload)"[^>]+href="(https?:)?//' <<<"$body" \
      && ko "$p has a script or an outside resource" || ok "$p facts present, no script or outside resource"
  done
  docker logs "$NAME" 2>&1 | grep -E '\[(emerg|alert|crit|error)\]' && ko "nginx error lines" || ok "no nginx error line"
  docker rm -f "$NAME" >/dev/null 2>&1
}

echo "== run 1: as the platform (image's /tmp, uid 101, no-new-privileges, 0.5 vCPU, 256 MiB)"
check --security-opt no-new-privileges --cpus 0.5 --memory 256m --memory-swap 256m --pids-limit 4096
echo "== run 2: read-only root file system, fresh /tmp, no capabilities"
check --read-only --tmpfs /tmp:rw,size=16m --cap-drop ALL --security-opt no-new-privileges
[ $fail = 0 ] && echo "ALL PASS" || echo "SOME FAILED"
exit $fail
