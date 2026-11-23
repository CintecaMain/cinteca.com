// The contact forms' proxy (deploy/contact-proxy): the start script that writes the function route, and the limits and
// route of nginx.conf. No nginx here: the image build runs nginx -t.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dir = path.join(import.meta.dirname, "..", "deploy", "contact-proxy");
const read = (name) => fs.readFileSync(path.join(dir, name), "utf8");
const hasShell = spawnSync("sh", ["-c", "exit 0"]).status === 0;

function routes(env) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "contact-proxy-"));
  const resolv = path.join(tmp, "resolv.conf");
  fs.writeFileSync(resolv, "nameserver 127.0.0.11\noptions ndots:0\n");
  const out = path.join(tmp, "function-routes.conf");
  const run = spawnSync("sh", [path.join(dir, "function-routes.sh")], {
    env: { PATH: process.env.PATH, FUNCTION_ROUTES_CONF: out, RESOLV_CONF: resolv,
      FUNCTION_ROUTES: "fn_contact:CINTECA_CONTACT_FUNCTION_URL", ...env },
    encoding: "utf8",
  });
  const conf = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : null;
  fs.rmSync(tmp, { recursive: true, force: true });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr, conf };
}

test("start script: the function's internal URL, off when unset, refused when malformed", { skip: !hasShell }, () => {
  const on = routes({ CINTECA_CONTACT_FUNCTION_URL: " http://fn-abc234.internal/ " });
  assert.equal(on.status, 0, on.stderr);
  assert.match(on.conf, /^resolver 127\.0\.0\.11 valid=10s ipv6=off;$/m);
  assert.match(on.conf, /map \$host \$fn_contact \{\n {4}default "http:\/\/fn-abc234\.internal";\n\}/);

  const off = routes({});
  assert.equal(off.status, 0, off.stderr);
  assert.match(off.conf, /default "";/);
  assert.match(off.stdout, /CINTECA_CONTACT_FUNCTION_URL is not set: 503/);

  for (const bad of ["http://fn-abc234.internal/path", "fn-abc234.internal", "http://a b.internal"]) {
    const refused = routes({ CINTECA_CONTACT_FUNCTION_URL: bad });
    assert.equal(refused.status, 1, bad);
    assert.equal(refused.conf, null, bad);
  }
});

test("nginx.conf: POST and OPTIONS on / only, limits per visitor and per server, no CORS of its own", () => {
  const conf = read("nginx.conf");
  const route = conf.slice(conf.indexOf("location = / {"), conf.indexOf("location @rate_limited"));
  assert.match(route, /limit_except POST OPTIONS \{ deny all; \}/);
  assert.match(route, /limit_req zone=contact_visitor burst=6 nodelay;/);
  assert.match(route, /limit_req zone=contact_server burst=10 nodelay;/);
  assert.match(route, /limit_conn contact_inflight 4;/);
  assert.match(route, /rewrite \^ \/ break;\n\s+proxy_pass \$fn_contact;/);
  assert.match(route, /proxy_set_header X-Real-IP \$remote_addr;/);
  assert.match(route, /proxy_read_timeout 70s;/);
  assert.match(conf, /limit_req_zone \$binary_remote_addr zone=contact_visitor:1m rate=2r\/m;/);
  assert.match(conf, /limit_req_zone \$server_name zone=contact_server:64k rate=10r\/m;/);
  assert.match(conf, /limit_conn_zone \$server_name zone=contact_inflight:64k;/);
  assert.match(conf, /location \/ \{\n\s+return 404/);
  assert.doesNotMatch(conf.replace(/^\s*#.*$/gm, ""), /Access-Control/i);
  // Every brace closes (a cheap guard; nginx -t runs at image build).
  const code = conf.replace(/'[^'\n]*'/g, "").replace(/#.*$/gm, "");
  assert.equal((code.match(/\{/g) ?? []).length, (code.match(/\}/g) ?? []).length);
});

test("image and platform files agree: build context, route variable, proxy settings", () => {
  assert.match(read("container.yml"), /^ {2}context: deploy\/contact-proxy$/m);
  const dockerfile = read("Dockerfile");
  assert.match(dockerfile, /ENV FUNCTION_ROUTES="fn_contact:CINTECA_CONTACT_FUNCTION_URL"/);
  assert.match(dockerfile, /nginx -t/);
  assert.match(dockerfile, /HEALTHCHECK/);
  assert.match(read("function-proxy.conf"), /^proxy_next_upstream off;$/m);
  assert.match(read("README.md"), /CINTECA_CONTACT_FUNCTION_URL/);
});
