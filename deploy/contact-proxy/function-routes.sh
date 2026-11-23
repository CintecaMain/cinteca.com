#!/bin/sh
# The function route (README.md in this folder), run at container start before nginx: writes
# /tmp/function-routes.conf, which nginx.conf includes in its http block. It holds the resolver nginx needs to look up
# a function's host at request time, and one variable per route: the function's URL, or empty when it is not set.
#   FUNCTION_ROUTES   set in the Dockerfile: space-separated <variable>:<environment variable> pairs, e.g.
#                     "fn_contact:CINTECA_CONTACT_FUNCTION_URL".
#   <environment variable>  set on the platform: the function's URL, http(s)://<host>[:<port>] with nothing after the
#                     host but an optional "/", normally http://<function id>.internal (the environment's own network).
#                     Unset or empty: nginx answers 503 on that route.
# nginx always sends the call to the path "/" of that URL (never the visitor's path). A malformed value stops the start
# (exit 1): an instance that is not healthy is never routed. FUNCTION_ROUTES_CONF and RESOLV_CONF override the output
# and the resolver source (tests).
set -eu
out=${FUNCTION_ROUTES_CONF:-/tmp/function-routes.conf}
resolv=${RESOLV_CONF:-/etc/resolv.conf}
tmp="$out.tmp.$$"
die() { rm -f "$tmp"; echo "function-routes: $*" >&2; exit 1; }

# nginx resolves a host held in a variable at request time, so it needs the container's DNS server (Docker's embedded
# server, 127.0.0.11, on the environment network): the nameservers of resolv.conf, IPv6 ones in brackets.
servers=''
if [ -r "$resolv" ]; then
  for ns in $(awk '$1 == "nameserver" { print $2 }' "$resolv"); do
    case $ns in
      *[!0-9A-Fa-f.:]*) continue ;;
      *:*) servers="$servers [$ns]" ;;
      *) servers="$servers $ns" ;;
    esac
  done
fi
[ -n "$servers" ] || servers=' 127.0.0.11'

{
  echo '# Written at start by function-routes.sh from the environment (see deploy/README.md).'
  echo "resolver$servers valid=10s ipv6=off;"
  echo 'resolver_timeout 5s;'
} > "$tmp"

routes=${FUNCTION_ROUTES:-}
set -f
for pair in $routes; do
  var=${pair%%:*}
  name=${pair#*:}
  case $var in '' | *[!a-z0-9_]*) die "bad FUNCTION_ROUTES entry: $pair" ;; esac
  case $name in '' | *[!A-Z0-9_]*) die "bad FUNCTION_ROUTES entry: $pair" ;; esac
  value=$(printenv "$name" 2>/dev/null || true)
  # Leading and trailing blanks only (a pasted value); a blank inside makes the value malformed.
  value=$(printf '%s' "$value" | tr '\r\n' '  ' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
  value=${value%/}
  if [ -n "$value" ]; then
    printf '%s\n' "$value" | grep -Eq '^https?://[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*(:[0-9]{1,5})?$' \
      || die "$name must be http(s)://<host>[:<port>] (e.g. http://<function id>.internal)"
    echo "route $var -> $value ($name)"
  else
    echo "route $var off ($name is not set: 503)"
  fi
  {
    echo "map \$host \$$var {"
    echo "    default \"$value\";"
    echo '}'
  } >> "$tmp"
done
set +f
mv -f "$tmp" "$out"
