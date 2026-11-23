import assert from "node:assert/strict";
import test from "node:test";

import { resolveLocale, translations } from "../app/i18n.ts";

test("matches the four supported browser language families", () => {
  assert.equal(resolveLocale(["pt-BR"]), "pt");
  assert.equal(resolveLocale(["en-US"]), "en");
  assert.equal(resolveLocale(["es-ES"]), "es");
  assert.equal(resolveLocale(["nb-NO"]), "nb");
  assert.equal(resolveLocale(["no-NO"]), "nb");
});

test("uses the first supported browser language and falls back to English", () => {
  assert.equal(resolveLocale(["fr-FR", "es-MX", "en"]), "es");
  assert.equal(resolveLocale(["de-DE", "fr-FR"]), "en");
  assert.equal(resolveLocale(["nn-NO"]), "en");
  assert.equal(resolveLocale([]), "en");
});

test("every locale contains the complete capability inventory", () => {
  for (const locale of ["pt", "en", "es", "nb"]) {
    const items = translations[locale].capabilities.items;
    const topicCount = items.reduce(
      (total, item) => total + item.direct.length + item.adjacent.length,
      0,
    );

    assert.equal(items.length, 13, `${locale} domain count`);
    assert.equal(topicCount, 195, `${locale} capability count`);
  }
});

test("every locale presents the company with global scope", () => {
  assert.match(translations.en.status.join(" "), /Global scope/);
  assert.match(translations.es.status.join(" "), /Alcance global/);
  assert.match(translations.pt.status.join(" "), /Atuação global/);
  assert.match(translations.nb.status.join(" "), /Globalt virkeområde/);
});

test("every locale describes the protected contact channel", () => {
  for (const locale of ["pt", "en", "es", "nb"]) {
    const copy = translations[locale];
    assert.ok(copy.contact.protectedLabel.length > 0, `${locale} protection label`);
    assert.ok(copy.contact.privacyAcknowledgement.length > 0, `${locale} privacy notice`);
    assert.match(copy.privacy.intro, /Turnstile/i, `${locale} Turnstile disclosure`);
  }
});

test("every locale names the form's platform, its US server and the transfer safeguards", () => {
  for (const locale of ["pt", "en", "es", "nb"]) {
    const privacy = translations[locale].privacy;
    const recipients = privacy.items[4].body;

    assert.equal(privacy.items.length, 6, `${locale} privacy clauses`);
    assert.doesNotMatch(privacy.intro, /AWS|SMTP/, `${locale} intro without AWS or SMTP`);
    assert.match(recipients, /Amsterdam|Ámsterdam|Amsterdã/, `${locale} Amsterdam`);
    assert.match(recipients, /Milan|Milán|Milão|Milano/, `${locale} Milan`);
    assert.match(recipients, /Chicago/, `${locale} Chicago`);
    assert.match(recipients, /Amazon S3/, `${locale} site hosting`);
    assert.match(recipients, /45/, `${locale} Article 45`);
    assert.match(recipients, /46/, `${locale} Article 46`);
    assert.match(recipients, /Turnstile/, `${locale} Turnstile`);
  }
});

test("every locale lists the four OEPM patent applications of the company", () => {
  for (const locale of ["pt", "en", "es", "nb"]) {
    const patents = translations[locale].patents;
    assert.deepEqual(
      patents.items.map((patent) => patent.number),
      ["P202631350", "P202631351", "P202631352", "P202631353"],
      `${locale} application numbers`,
    );
    assert.ok(patents.items.every((patent) => patent.title.length > 0), `${locale} titles`);
    assert.ok(
      patents.facts.some(([, value]) => value === "AD Caldas Innotec, S.A."),
      `${locale} applicant`,
    );
    assert.ok(patents.facts.some(([, value]) => /OEPM/.test(value)), `${locale} office`);
  }
});
