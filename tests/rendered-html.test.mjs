import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("renders the official company identity and product portfolio", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="en">/i);
  assert.match(html, /<title>Cinteca · AD Caldas Innotec, S\.A\.<\/title>/i);
  assert.match(html, /A66316399/);
  assert.match(html, /CA-56553/);
  assert.match(html, /LegalNeuron/);
  assert.match(html, /NordixBIOS/);
  assert.match(html, /NordixAIgency/);
  assert.match(html, /NCS Engine/);
  assert.match(html, /id="patentes"/);
  assert.match(html, /In-house research, patent pending\./);
  assert.match(html, /P202631350/);
  assert.match(html, /P202631353/);
  assert.match(html, /Spanish Patent and Trademark Office \(OEPM\)/);
  assert.doesNotMatch(html, /adriano@cinteca\.es/);
  assert.doesNotMatch(html, /\+34 665 478 150/);
  assert.doesNotMatch(html, /href="(?:mailto|tel):/i);
  assert.match(html, /Corporate relationship/);
  assert.match(html, /Cinteca.*technology brand.*AD Caldas Innotec, S\.A\./s);
  assert.match(html, /Tax ID A66316399/);
  assert.match(html, /Global scope/);
  assert.match(html, /progressive global expansion/);
  assert.match(html, /PT(?:<!-- -->)? · (?:<!-- -->)?Português/);
  assert.match(html, /NO(?:<!-- -->)? · (?:<!-- -->)?Norsk bokmål/);
});

test("presents direct and adjacent know-how across the full capability map", async () => {
  const response = await render();
  const html = await response.text();

  assert.match(html, /Complete know-how/);
  assert.match(
    html,
    /13(?:<!-- -->|\s)*domains(?:<!-- -->|\s)*·(?:<!-- -->|\s)*195(?:<!-- -->|\s)*capabilities/,
  );
  assert.match(html, /Digital signal processing/);
  assert.match(html, /AWS, Microsoft Azure and Google Cloud/);
  assert.match(html, /Residential and industrial automation/);
  assert.match(html, /Technical and editorial SEO/);
  assert.match(html, /Direct knowledge/);
  assert.match(html, /Leadership and integration/);
});

test("includes legal, privacy and machine-readable company information", async () => {
  const response = await render();
  const html = await response.text();

  assert.match(html, /Legal notice/);
  assert.match(html, /Privacy policy/);
  assert.match(html, /uses Cinteca(?:'|&#x27;|&#39;)s own server platform \(servers in the Netherlands, Italy and the United States\), the platform(?:'|&#x27;|&#39;)s own email delivery and Cloudflare Turnstile/i);
  assert.match(html, /Amazon Web Services hosts this website \(Amazon S3 and CloudFront\) but does not receive the form data/);
  assert.match(html, /EU-U\.S\. Data Privacy Framework for certified providers \(Article 45 GDPR\) or the standard contractual clauses approved by the European Commission \(Article 46 GDPR\)/);
  assert.doesNotMatch(html, /AWS infrastructure|SMTP delivery|AWS, the configured email provider/);
  assert.match(html, /<form/i);
  assert.match(html, /name="message"/i);
  assert.match(html, /Protected contact form available on this website/i);
  assert.match(html, /application\/ld\+json/);
  assert.match(html, /"legalName":"AD Caldas Innotec, S.A."/);
  assert.match(html, /"alternateName":"Cinteca"/);
  assert.match(html, /"taxID":"A66316399"/);
  assert.match(html, /"areaServed":"Worldwide"/);
  assert.match(html, /"knowsAbout":\[/);
  assert.match(html, /rel="canonical" href="https:\/\/cinteca\.es"/i);
  assert.doesNotMatch(html, /"telephone"|google-analytics|googletagmanager|cookie banner/i);
});

test("identifies Cinteca to the shared contact Lambda", async () => {
  const source = await readFile(
    new URL("../app/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /site: "cinteca"/);
  assert.doesNotMatch(source, /web-cinteca@cinteca\.es/);
});

test("posts the form to the contact function over HTTPS (the Lambda or the platform function)", async () => {
  const source = await readFile(
    new URL("../app/page.tsx", import.meta.url),
    "utf8",
  );
  const declared = source.match(/const defaultContactEndpoint =\s*"([^"]+)"/);

  assert.ok(declared, "app/page.tsx declares the contact function's address");
  assert.match(
    declared[1],
    /^https:\/\/([a-z0-9]+\.lambda-url\.eu-central-1\.on\.aws|fn-[a-z0-9]+\.[a-z0-9.-]+)\/$/,
  );
  assert.match(source, /process\.env\.NEXT_PUBLIC_CONTACT_ENDPOINT \|\| defaultContactEndpoint/);
  assert.match(source, /fetch\(contactEndpoint,/);
});
