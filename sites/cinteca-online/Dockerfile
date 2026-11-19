# The cinteca.online identity page (www.cinteca.online: operator, purpose, abuse/postmaster contact, privacy note,
# privacy policy) as an nginx image for the self-hosted platform's CI/CD (configuration file
# sites/cinteca-online/deploy/container.yml, build context sites/cinteca-online). Static files only: no build step,
# secrets or credentials, and one build argument for the local test only (ALLOW_DRAFT, below).
# The Next.js site at the repository root does not use this folder.

# Non-root nginx on port 8080 (uid 101), pinned by digest (as the ShoppingNavigator and LegalNeuron sites).
FROM nginxinc/nginx-unprivileged:1.30-alpine@sha256:f5116ed4606f3eb015dd4a8e28cb9b351476dc0ad4bc6e9f93b19cec130cdf03

# A page whose text is still a draft (it holds "[[TO CONFIRM", the marker of a fact or a legal choice the owner has not
# approved yet) is never published: the build stops at the last RUN below. The platform's CI/CD passes no build
# argument, so it always applies; local-test.sh passes ALLOW_DRAFT=1 only when asked to (ALLOW_DRAFT=1 in its
# environment), to look at a draft locally.
ARG ALLOW_DRAFT=0

USER root
RUN rm -rf /usr/share/nginx/html/* /etc/nginx/conf.d/default.conf
COPY deploy/nginx.conf /etc/nginx/nginx.conf
COPY deploy/security-headers.conf /etc/nginx/security-headers.conf
COPY public/ /usr/share/nginx/html/
# The configuration and the pages belong to root and are read-only for nginx's user (folders 0755, files 0644),
# whatever modes the build context had. The base image gives /etc/nginx (with mime.types, which nginx.conf includes)
# and /var/cache/nginx to uid 101 with group write: taken back, so uid 101 can neither change nor add a file there.
# nginx writes only in /tmp (its pid file and temporary folders, see nginx.conf). The configuration is checked at
# build time: `nginx -t` runs as root here and leaves a root-owned /tmp/nginx.pid (and the temp folders) in the layer,
# removed, or nginx (uid 101) cannot write its pid file and exits when /tmp is not a fresh tmpfs, as on the platform.
RUN chown -R -h root:root /etc/nginx /usr/share/nginx/html /var/cache/nginx \
 && find /etc/nginx /usr/share/nginx/html /var/cache/nginx -type d -exec chmod 0755 {} + \
 && find /etc/nginx /usr/share/nginx/html /var/cache/nginx -type f -exec chmod 0644 {} + \
 && nginx -t \
 && rm -rf /tmp/nginx.pid /tmp/client_temp /tmp/proxy_temp /tmp/fastcgi_temp /tmp/uwsgi_temp /tmp/scgi_temp \
 && if [ "$ALLOW_DRAFT" != 1 ] && grep -rlF '[[TO CONFIRM' /usr/share/nginx/html; then \
      echo 'Draft text ("[[TO CONFIRM") in the pages above: not publishable until the owner approves it' >&2; exit 1; \
    fi

USER 101
EXPOSE 8080
# The platform routes an instance only while this check passes.
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
