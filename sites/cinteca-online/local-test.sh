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
# Traefik sends every request with X-Forwarded-Proto (http or https); the image's HEALTHCHECK sends none. The test
# sends the header the way Traefik does and leaves it out where the health check would.
#
# Draft text: while a page still holds "[[TO CONFIRM" (a fact or legal choice the owner has not approved), the image's
# build refuses it, as it will on the platform. To look at such a draft locally, run with ALLOW_DRAFT=1: the image is
# then built with the draft, and the test also checks that a build without ALLOW_DRAFT still refuses it.
set -u
export MSYS_NO_PATHCONV=1  # Git Bash on Windows: keep /tmp and other container paths as they are.
cd "$(dirname "$0")" || exit 2
IMG=cinteca-online-identity:test
NAME=cinteca-online-identity-test
PORT=${PORT:-18080}
B="http://127.0.0.1:$PORT"
HOST="Host: www.cinteca.online"
fail=0
ok() { echo "PASS $*"; }
ko() { echo "FAIL $*"; fail=1; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
hdrs() { curl -s -D - -o /dev/null "$@" | tr -d '\r'; }
# "<status> <Location>" of an answer (Location empty when there is none).
status_location() { hdrs "$@" | sed -n -e '1s/^HTTP[^ ]* \([0-9]*\).*/\1/p' -e 's/^[Ll]ocation: //p' | paste -sd ' '; }

ALLOW_DRAFT=${ALLOW_DRAFT:-0}
drafts=$(grep -rlF '[[TO CONFIRM' public | paste -sd ' ')
docker build -q --build-arg ALLOW_DRAFT="$ALLOW_DRAFT" -t "$IMG" . >/dev/null || {
  echo "FAIL build${drafts:+ (draft text in: $drafts; run with ALLOW_DRAFT=1 to test the draft)}"; exit 1; }
ok "build $IMG${drafts:+ (ALLOW_DRAFT=1, draft text in: $drafts)}"
if [ -n "$drafts" ]; then
  # The build the platform runs (no build argument) must refuse the draft.
  docker build -q -t "$IMG-guard" . >/dev/null 2>&1 && { ko "a build without ALLOW_DRAFT accepted draft text"; docker rmi -f "$IMG-guard" >/dev/null 2>&1; } \
    || ok "a build without ALLOW_DRAFT refuses the draft text"
else
  ok "no draft text in the pages"
fi
[ "$(docker inspect -f '{{.Config.User}}' "$IMG")" = 101 ] && ok "image user 101" || ko "image user is not 101"
# Nothing the build left in /tmp may belong to anyone but nginx's user.
left=$(docker run --rm --entrypoint find "$IMG" /tmp -mindepth 1 ! -user 101); rc=$?
if [ $rc != 0 ]; then ko "find in the image's /tmp failed (exit $rc)"
elif [ -n "$left" ]; then ko "files in /tmp not owned by 101: $left"
else ok "no file in the image's /tmp owned by another user"; fi
# The configuration, the pages, nginx's cache folder and the entrypoint belong to root, and neither their group nor
# others may write them (the base image gives /etc/nginx and /var/cache/nginx to uid 101 with group write).
RO="/etc/nginx /usr/share/nginx/html /var/cache/nginx /docker-entrypoint.sh /docker-entrypoint.d"
bad=$(docker run --rm --entrypoint find "$IMG" $RO ! -type l \( ! -user 0 -o -perm -020 -o -perm -002 \)); rc=$?
if [ $rc != 0 ]; then ko "find on the configuration and pages failed (exit $rc)"
elif [ -n "$bad" ]; then ko "not root's or writable by group/others: $(echo $bad)"
else ok "configuration, pages, cache folder and entrypoint owned by root, not writable by group or others"; fi

# Run inside a container as uid 101: every way to change or add a configuration file or a page. Prints the ones that
# worked (none may).
WRITE_TRY='
w=
t() { sh -c "$1" 2>/dev/null && w="$w | $1"; }
for d in /etc/nginx /etc/nginx/conf.d /usr/share/nginx/html /usr/share/nginx/html/es /usr/share/nginx/html/pt \
    /usr/share/nginx/html/privacy /usr/share/nginx/html/es/privacidad /usr/share/nginx/html/pt/privacidade; do
  t "touch $d/.w101"; t "mkdir $d/.w101d"; t "ln -s /tmp $d/.w101l"
done
for f in /etc/nginx/nginx.conf /etc/nginx/security-headers.conf /etc/nginx/mime.types \
    /usr/share/nginx/html/index.html /usr/share/nginx/html/es/index.html /usr/share/nginx/html/pt/index.html \
    /usr/share/nginx/html/privacy/index.html /usr/share/nginx/html/es/privacidad/index.html \
    /usr/share/nginx/html/pt/privacidade/index.html /usr/share/nginx/html/site.css; do
  t "printf \"\" >> $f"; t "chmod u+w $f"; t "cp $f /tmp/.w101 && mv -f /tmp/.w101 $f"
  rm -f /tmp/.w101
done
printf "%s" "$w"'

# The eight security headers and Server: nginx (no version); HSTS only on answers that went out over HTTPS.
SEC=("Content-Security-Policy: default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
  "X-Content-Type-Options: nosniff" "X-Frame-Options: DENY" "Referrer-Policy: no-referrer"
  "Permissions-Policy: camera=(), geolocation=(), microphone=(), payment=(), usb=()"
  "Cross-Origin-Opener-Policy: same-origin" "Cross-Origin-Resource-Policy: same-origin" "Server: nginx")
HSTS="Strict-Transport-Security: max-age=31536000"
# The proxy log's retention, word for word the same in the identity note and in the policy (placeholder C9 on both).
PROXY_EN="about one year after their log file is closed"
PROXY_ES="aproximadamente un año después de cerrarse su archivo"
PROXY_PT="cerca de um ano depois do fechamento do arquivo"
headers() {  # label, yes|no (HSTS expected), curl arguments
  local label=$1 hsts=$2 H n=0 want; shift 2
  H=$(hdrs "$@")
  for want in "${SEC[@]}"; do
    grep -qixF "$want" <<<"$H" && n=$((n + 1)) || ko "$label lacks: $want"
  done
  if [ "$hsts" = yes ]; then
    grep -qixF "$HSTS" <<<"$H" && n=$((n + 1)) || ko "$label lacks: $HSTS"
  else
    grep -qi '^Strict-Transport-Security:' <<<"$H" && ko "$label has HSTS" || n=$((n + 1))
  fi
  [ $n = 9 ] && ok "$label: security headers, Server: nginx without version, HSTS $hsts"
}

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
  # As Traefik's HTTPS entry point (X-Forwarded-Proto: https) and as the health check (no header).
  for p in / /es/ /pt/ /privacy/ /es/privacidad/ /pt/privacidade/ /healthz /site.css /favicon.svg /robots.txt; do
    c=$(code -H "X-Forwarded-Proto: https" "$B$p"); [ "$c" = 200 ] && ok "HTTPS GET $p 200" || ko "HTTPS GET $p $c"
    c=$(code "$B$p"); [ "$c" = 200 ] && ok "direct GET $p 200" || ko "direct GET $p $c"
  done
  # Relative Location (absolute_redirect off): the browser keeps the scheme and host it used.
  for r in "/es /es/" "/pt /pt/" "/en /" "/en/ /" "/privacy /privacy/" "/es/privacidad /es/privacidad/" \
    "/pt/privacidade /pt/privacidade/"; do
    c=$(status_location -H "X-Forwarded-Proto: https" "$B${r% *}")
    [ "$c" = "301 ${r#* }" ] && ok "GET ${r% *} 301 ${r#* }" || ko "GET ${r% *} $c"
  done
  # Plain HTTP through Traefik: 301 to https, same host, path and query; /healthz is never redirected.
  for r in "/ https://www.cinteca.online/" "/es/?x=1 https://www.cinteca.online/es/?x=1" \
    "/nope https://www.cinteca.online/nope" "/site.css https://www.cinteca.online/site.css"; do
    c=$(status_location -H "$HOST" -H "X-Forwarded-Proto: http" "$B${r% *}")
    [ "$c" = "301 ${r#* }" ] && ok "plain HTTP ${r% *} 301 ${r#* }" || ko "plain HTTP ${r% *}: $c"
  done
  c=$(code -H "$HOST" -H "X-Forwarded-Proto: http" "$B/healthz")
  [ "$c" = 200 ] && ok "plain HTTP /healthz 200, not redirected" || ko "plain HTTP /healthz $c"
  c=$(code -H "X-Forwarded-Proto: https" "$B/nope"); [ "$c" = 404 ] && ok "GET /nope 404" || ko "GET /nope $c"
  c=$(code -H "X-Forwarded-Proto: https" "$B/404.html"); [ "$c" = 404 ] && ok "GET /404.html 404" || ko "GET /404.html $c"
  c=$(code -X POST -H "X-Forwarded-Proto: https" "$B/"); [ "$c" = 405 ] && ok "POST / 405" || ko "POST / $c"
  [ "$(curl -s "$B/healthz")" = ok ] && ok "/healthz says ok" || ko "/healthz body"
  for p in / /healthz /nope; do headers "HTTPS $p" yes -H "X-Forwarded-Proto: https" "$B$p"; done
  headers "plain HTTP 301 of /" no -H "$HOST" -H "X-Forwarded-Proto: http" "$B/"
  headers "direct / (no X-Forwarded-Proto)" no "$B/"
  # Pages revalidated, /healthz never stored, static files an hour, every redirect revalidated.
  for want in "/ Cache-Control: no-cache" "/healthz Cache-Control: no-store" "/site.css Cache-Control: public, max-age=3600" \
    "/es Cache-Control: no-cache" "/pt Cache-Control: no-cache" "/en Cache-Control: no-cache" "/en/ Cache-Control: no-cache" \
    "/privacy Cache-Control: no-cache" "/es/privacidad Cache-Control: no-cache" "/pt/privacidade Cache-Control: no-cache" \
    "/privacy/ Cache-Control: no-cache" "/ Content-Type: text/html; charset=utf-8"; do
    p=${want%% *}; hd=${want#* }
    hdrs -H "X-Forwarded-Proto: https" "$B$p" | grep -qixF "$hd" && ok "$p $hd" || ko "$p lacks $hd"
  done
  hdrs -H "$HOST" -H "X-Forwarded-Proto: http" "$B/site.css" | grep -qixF "Cache-Control: no-cache" \
    && ok "plain HTTP 301 of /site.css Cache-Control: no-cache" || ko "plain HTTP 301 of /site.css lacks Cache-Control: no-cache"
  for p in / /es/ /pt/; do
    body=$(curl -s -H "X-Forwarded-Proto: https" "$B$p")
    # The privacy note names everything the access log records and how long logs are kept (the proxy's retention in
    # the policy's own words, so the two cannot drift apart), and links to the full privacy policy in the same language.
    case $p in
      /) priv=("referring page" "browser identification" "30 days" "$PROXY_EN" 'href="/privacy/"') ;;
      /es/) priv=("página de procedencia" "identificación del navegador" "30 días" "$PROXY_ES" 'href="/es/privacidad/"') ;;
      /pt/) priv=("página de origem" "identificação do navegador" "30 dias" "$PROXY_PT" 'href="/pt/privacidade/"') ;;
    esac
    for want in "AD Caldas Innotec, S.A." "NIF A66316399" "admin@cinteca.cloud" "OAuth" 'href="/es/"' 'href="/pt/"' 'href="/"' \
      "${priv[@]}" "1 GB" "100 MB"; do
      grep -qF "$want" <<<"$body" || ko "$p lacks $want"
    done
    grep -qE 'CIF|Innotec SA|[Gg]rupo|[Gg]roup' <<<"$body" && ko "$p has an old legal form or the group wording"
    grep -qiE '<script|<iframe|<img|<object|<embed| on[a-z]+=|@import|url\(|<link[^>]+rel="(stylesheet|icon|preload|prefetch|preconnect|dns-prefetch|modulepreload)"[^>]+href="(https?:)?//' <<<"$body" \
      && ko "$p has a script or an outside resource" || ok "$p facts present, no script or outside resource"
  done
  # The privacy policy: the controller and the contact, the servers and the backup provider, the laws and authorities,
  # the retention of logs and backups, the cookie statement, its three languages linked to each other and the way back.
  for p in /privacy/ /es/privacidad/ /pt/privacidade/; do
    body=$(curl -s -H "X-Forwarded-Proto: https" "$B$p")
    case $p in
      /privacy/) lang=("Privacy policy" "Amsterdam" "30 days" "90 days" "$PROXY_EN" "sets no cookies" 'href="/"') ;;
      /es/privacidad/) lang=("Política de privacidad" "Ámsterdam" "30 días" "90 días" "$PROXY_ES" "no instala cookies" 'href="/es/"') ;;
      /pt/privacidade/) lang=("Política de privacidade" "Amsterdã" "30 dias" "90 dias" "$PROXY_PT" "não grava cookies" 'href="/pt/"') ;;
    esac
    for want in "AD Caldas Innotec, S.A." "NIF A66316399" "admin@cinteca.cloud" "BelHost" "ITLDC" "Cherry Servers" "Chicago" \
      "Backblaze" "PBKDF2-SHA512" "LGPD" "LOPDGDD" "AEPD" "ANPD" "1 GB" "100 MB" \
      'href="/privacy/"' 'href="/es/privacidad/"' 'href="/pt/privacidade/"' "${lang[@]}"; do
      grep -qF "$want" <<<"$body" || ko "$p lacks $want"
    done
    grep -qE 'CIF|Innotec SA|[Gg]rupo|[Gg]roup' <<<"$body" && ko "$p has an old legal form or the group wording"
    grep -qiE '<script|<iframe|<img|<object|<embed| on[a-z]+=|@import|url\(|<link[^>]+rel="(stylesheet|icon|preload|prefetch|preconnect|dns-prefetch|modulepreload)"[^>]+href="(https?:)?//' <<<"$body" \
      && ko "$p has a script or an outside resource" || ok "$p facts present, no script or outside resource"
  done
  # Last, as they would change the files if the image allowed it.
  out=$(docker exec "$NAME" sh -c "$WRITE_TRY"); rc=$?
  if [ $rc != 0 ]; then ko "write attempts as uid 101 did not run (exit $rc)"
  elif [ -n "$out" ]; then ko "uid 101 changed or added configuration or pages:$out"
  else ok "uid 101 can neither change nor add configuration files or pages"; fi
  docker logs "$NAME" 2>&1 | grep -E '\[(emerg|alert|crit|error)\]' && ko "nginx error lines" || ok "no nginx error line"
  docker rm -f "$NAME" >/dev/null 2>&1
}

echo "== run 1: as the platform (image's /tmp, uid 101, no-new-privileges, 0.5 vCPU, 256 MiB)"
check --security-opt no-new-privileges --cpus 0.5 --memory 256m --memory-swap 256m --pids-limit 4096
echo "== run 2: read-only root file system, fresh /tmp, no capabilities"
check --read-only --tmpfs /tmp:rw,size=16m --cap-drop ALL --security-opt no-new-privileges
[ $fail = 0 ] && echo "ALL PASS" || echo "SOME FAILED"
exit $fail
