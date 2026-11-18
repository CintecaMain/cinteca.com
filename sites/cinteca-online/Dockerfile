# The cinteca.online identity page (www.cinteca.online: operator, purpose, abuse/postmaster contact, privacy note) as
# an nginx image for the self-hosted platform's CI/CD (configuration file sites/cinteca-online/deploy/container.yml,
# build context sites/cinteca-online). Static files only: no build step, no build arguments, secrets or credentials.
# The Next.js site at the repository root does not use this folder.

# Non-root nginx on port 8080 (uid 101), pinned by digest (as the ShoppingNavigator and LegalNeuron sites).
FROM nginxinc/nginx-unprivileged:1.30-alpine@sha256:f5116ed4606f3eb015dd4a8e28cb9b351476dc0ad4bc6e9f93b19cec130cdf03

USER root
RUN rm -rf /usr/share/nginx/html/* /etc/nginx/conf.d/default.conf
COPY deploy/nginx.conf /etc/nginx/nginx.conf
COPY deploy/security-headers.conf /etc/nginx/security-headers.conf
COPY public/ /usr/share/nginx/html/
# Owned by root and read-only for nginx's user, whatever modes the build context had; the configuration is checked
# at build time.
RUN chmod -R u=rwX,go=rX /usr/share/nginx/html /etc/nginx/nginx.conf /etc/nginx/security-headers.conf \
 && nginx -t

USER 101
EXPOSE 8080
# The platform routes an instance only while this check passes.
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
