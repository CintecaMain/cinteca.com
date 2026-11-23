// scripts/switch-contact-endpoint.mjs: the endpoint switch of a live static export without a rebuild, on an in-memory
// copy of a bucket shaped like the live cinteca.es one (pages naming hashed chunks, an older build's chunks left over).
import assert from "node:assert/strict";
import test from "node:test";
import { planSwitch, renamedChunk } from "../scripts/switch-contact-endpoint.mjs";

const OLD = "https://old-endpoint.example.test/";
const NEW = "https://cinteca-contact.general.example.test/";

function bucket(overrides = {}) {
  const files = {
    "index.html": '<script src="/_next/static/chunks/aaa111form.js" async=""></script><script src="/_next/static/chunks/bbb222main.js"></script>"b":"BUILDID"',
    "index.txt": ':HL["/_next/static/chunks/aaa111form.js"]\n2:I[1,["/_next/static/chunks/aaa111form.js"]]',
    "legal/index.html": '<script src="/_next/static/chunks/bbb222main.js"></script>',
    "_next/static/chunks/aaa111form.js": `let e="${OLD}";fetch(e,{method:"POST"})`,
    "_next/static/chunks/bbb222main.js": "console.log(1)",
    "_next/static/chunks/old999form.js": `let e="${OLD}";`,
    "_next/static/BUILDID/_buildManifest.js": "self.__BUILD_MANIFEST={}",
    ...overrides,
  };
  for (const [name, value] of Object.entries(files)) if (value === null) delete files[name];
  return {
    files: Object.keys(files).sort(),
    read: (file) => Buffer.from(files[file], "utf8"),
    oldEndpoint: OLD,
    newEndpoint: NEW,
  };
}

test("the chunk with the endpoint gets a new name; only the pages that name it change, by that name only", () => {
  const plan = planSwitch(bucket());
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.ok, true);
  assert.equal(plan.chunks.length, 1);
  const [chunk] = plan.chunks;
  assert.equal(chunk.from, "_next/static/chunks/aaa111form.js");
  assert.match(chunk.to, /^_next\/static\/chunks\/aaa111form-[0-9a-f]{10}\.js$/);
  assert.equal(chunk.to, renamedChunk(chunk.from, chunk.content));
  assert.equal(chunk.content, `let e="${NEW}";fetch(e,{method:"POST"})`);
  assert.deepEqual(plan.pages.map((page) => page.path), ["index.html", "index.txt"]);
  const newName = chunk.to.split("/").pop();
  for (const page of plan.pages) {
    assert.ok(page.content.includes(newName));
    assert.ok(!page.content.includes("aaa111form.js"));
    assert.equal(page.content.split(newName).join("aaa111form.js"), page.original);
  }
  assert.deepEqual(plan.stale, ["_next/static/chunks/old999form.js"]);
});

test("stops: no chunk of the current pages holds the old endpoint", () => {
  const plan = planSwitch(bucket({ "_next/static/chunks/aaa111form.js": "let e=1" }));
  assert.equal(plan.ok, false);
  assert.match(plan.errors.join("\n"), /no chunk of the current pages holds the old endpoint/);
});

test("stops: a page holds the endpoint, or the new endpoint is already there", () => {
  const inPage = planSwitch(bucket({ "legal/index.html": `<a href="${OLD}">x</a>` }));
  assert.match(inPage.errors.join("\n"), /a page holds the old endpoint: legal\/index\.html/);
  const already = planSwitch(bucket({ "_next/static/chunks/bbb222main.js": `"${NEW}"` }));
  assert.match(already.errors.join("\n"), /the new endpoint is already in _next\/static\/chunks\/bbb222main\.js/);
});

test("stops: another chunk of the pages names the renamed chunk (renames would cascade)", () => {
  const plan = planSwitch(bucket({ "_next/static/chunks/bbb222main.js": 'load("aaa111form.js")' }));
  assert.match(plan.errors.join("\n"), /bbb222main\.js names _next\/static\/chunks\/aaa111form\.js/);
});

test("stops: no HTML page names the chunk; bad endpoints", () => {
  const noHtml = planSwitch(bucket({
    "index.html": '<script src="/_next/static/chunks/bbb222main.js"></script>',
  }));
  assert.match(noHtml.errors.join("\n"), /no HTML page names the chunk/);
  const same = planSwitch({ ...bucket(), newEndpoint: OLD });
  assert.match(same.errors.join("\n"), /must differ/);
  const nested = planSwitch({ ...bucket(), newEndpoint: `${OLD}x` });
  assert.match(nested.errors.join("\n"), /must not contain the other/);
});
