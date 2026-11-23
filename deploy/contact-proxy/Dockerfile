# The contact forms' proxy (README.md in this folder) as an nginx image for the self-hosted platform (MainServer CI/CD,
# config path deploy/contact-proxy/container.yml, build context this folder). No site files: nginx only passes the
# forms' calls to the platform function CintecaContact, with the limits of nginx.conf.
FROM nginxinc/nginx-unprivileged:1.30-alpine
USER root
RUN rm -rf /usr/share/nginx/html/* /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/nginx.conf
COPY function-proxy.conf /etc/nginx/function-proxy.conf
# Writes /tmp/function-routes.conf (included by nginx.conf) at every start from the environment: README.md.
COPY --chmod=0755 function-routes.sh /docker-entrypoint.d/30-function-routes.sh
ENV FUNCTION_ROUTES="fn_contact:CINTECA_CONTACT_FUNCTION_URL"
# The configuration is checked at build time (with the route off, as when CINTECA_CONTACT_FUNCTION_URL is unset):
# nginx -t runs as root and leaves a root-owned /tmp/nginx.pid and temp folders in the layer, removed, or nginx
# (uid 101) could not write them when /tmp is not a fresh tmpfs.
RUN /docker-entrypoint.d/30-function-routes.sh \
 && nginx -t \
 && rm -rf /tmp/function-routes.conf /tmp/nginx.pid /tmp/client_temp /tmp/proxy_temp /tmp/fastcgi_temp \
      /tmp/uwsgi_temp /tmp/scgi_temp
USER 101
EXPOSE 8080
# The platform routes an instance only while this check passes.
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
