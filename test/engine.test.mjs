// Engine contract tests (run against the built package).
import assert from "node:assert/strict";
import { extractStructuredData, googleParseErrorName, validateMarkup } from "../dist/index.js";


const ld = (value) => JSON.stringify({ "@context": "https://schema.org", ...value });
const errors = (report) => report.issues.filter((issue) => issue.severity === "error");
const find = (report, pattern) => report.issues.find((issue) => pattern.test(issue.message));
const feature = (report, id) => report.features.find((item) => item.id === id);
let checks = 0;
const check = (name, fn) => {
  try {
    fn();
    checks += 1;
  } catch (error) {
    console.error(`FAIL: ${name}`);
    throw error;
  }
};

check("complete product passes vocabulary and both product features", () => {
  const report = validateMarkup(ld({
    "@type": "Product", name: "Trail Shoe", image: "https://example.com/shoe.jpg", description: "A shoe.",
    brand: { "@type": "Brand", name: "Acme" }, sku: "TS-1",
    offers: { "@type": "Offer", price: "89.00", priceCurrency: "USD", availability: "https://schema.org/InStock", url: "https://example.com/shoe" },
  }));
  assert.equal(errors(report).length, 0, JSON.stringify(errors(report), null, 1));
  assert.equal(feature(report, "product-snippet").result, "eligible");
  assert.equal(feature(report, "merchant-listing").result, "eligible");
});

check("type typo is an error with a suggestion", () => {
  const issue = find(validateMarkup(ld({ "@type": "LocalBussiness", name: "Cafe" })), /isn't a schema.org type/);
  assert.ok(issue);
  assert.match(issue.fix, /LocalBusiness/);
});

check("property typo is an error with a suggestion", () => {
  const issue = find(validateMarkup(ld({ "@type": "LocalBusiness", name: "Cafe", adress: "1 Main St" })), /adress isn't a schema.org property/);
  assert.ok(issue);
  assert.match(issue.fix, /address/);
});

check("property on the wrong type is an error", () => {
  const report = validateMarkup(ld({ "@type": "Product", name: "Shoe", telephone: "555" }));
  assert.ok(find(report, /telephone isn't a property of Product/));
});

check("inherited properties are accepted (Restaurant inherits LocalBusiness/Organization/Place)", () => {
  const report = validateMarkup(ld({ "@type": "Restaurant", name: "Cafe", telephone: "555", servesCuisine: "Thai", address: { "@type": "PostalAddress", streetAddress: "1 Main St" }, geo: { "@type": "GeoCoordinates", latitude: 1, longitude: 2 } }));
  assert.equal(report.issues.filter((issue) => issue.category === "vocabulary" && issue.severity === "error").length, 0);
  assert.equal(feature(report, "local-business").result, "eligible");
  assert.equal(feature(report, "organization"), undefined, "LocalBusiness doesn't also get the Organization feature");
});

check("JSON syntax errors report a line and column", () => {
  const report = validateMarkup('{\n  "@context": "https://schema.org",\n  "@type": "Thing"\n  "name": "x"\n}');
  const issue = errors(report).find((item) => item.category === "syntax");
  assert.ok(issue);
  assert.match(issue.path, /line 4/);
});

check("JSON-LD inside HTML reports the HTML line", () => {
  const html = '<html>\n<head>\n<script type="application/ld+json">\n{ "@context": "https://schema.org", "@type": "Thing", }\n</script>\n</head></html>';
  const issue = errors(validateMarkup(html)).find((item) => item.category === "syntax");
  assert.ok(issue);
  assert.match(issue.path, /line 4/);
});

check("missing @context is an error", () => {
  assert.ok(find(validateMarkup(JSON.stringify({ "@type": "Thing", name: "x" })), /has no @context/));
});

check("microdata is extracted with nested items", () => {
  const html = `<div itemscope itemtype="https://schema.org/Product">
    <h1 itemprop="name">Trail Shoe</h1><img itemprop="image" src="https://example.com/s.jpg">
    <div itemprop="offers" itemscope itemtype="https://schema.org/Offer">
      <meta itemprop="price" content="89.00"><meta itemprop="priceCurrency" content="USD">
      <link itemprop="availability" href="https://schema.org/InStock">
    </div></div>`;
  const report = validateMarkup(html);
  assert.equal(report.counts.microdata, 1);
  assert.deepEqual(report.types.sort(), ["Offer", "Product"]);
  const offers = report.nodes[0].properties.find((property) => property.name === "offers");
  assert.equal(offers.values[0].kind, "node");
  assert.equal(feature(report, "merchant-listing").result, "eligible");
  assert.equal(errors(report).length, 0, JSON.stringify(errors(report), null, 1));
});

check("RDFa Lite is extracted", () => {
  const html = `<div vocab="https://schema.org/" typeof="Event">
    <span property="name">Jazz Night</span>
    <time property="startDate" datetime="2026-11-01T20:00">Nov 1</time>
    <div property="location" typeof="Place"><span property="name">Hall</span>
      <div property="address" typeof="PostalAddress"><span property="streetAddress">1 Main St</span></div></div></div>`;
  const report = validateMarkup(html);
  assert.equal(report.counts.rdfa, 1);
  assert.equal(feature(report, "event").result, "eligible");
});

check("Open Graph meta tags are not treated as schema.org", () => {
  const report = validateMarkup('<meta property="og:title" content="Hi"><meta property="og:type" content="website">');
  assert.equal(report.nodes.length, 0);
});

check("breadcrumb: last item may omit item, middle items may not", () => {
  const ok = validateMarkup(ld({ "@type": "BreadcrumbList", itemListElement: [
    { "@type": "ListItem", position: 1, name: "Books", item: "https://example.com/books" },
    { "@type": "ListItem", position: 2, name: "Sci-fi" },
  ] }));
  assert.equal(feature(ok, "breadcrumb").result, "eligible");
  const bad = validateMarkup(ld({ "@type": "BreadcrumbList", itemListElement: [
    { "@type": "ListItem", position: 1, name: "Books" },
    { "@type": "ListItem", position: 2, name: "Sci-fi" },
  ] }));
  assert.deepEqual(feature(bad, "breadcrumb").missingRequired, ["ListItem 1: item"]);
});

check("Article has no required properties", () => {
  const report = validateMarkup(ld({ "@type": "NewsArticle", headline: "Hello" }));
  assert.equal(feature(report, "article").result, "eligible");
  assert.ok(find(report, /Article: \d+ recommended properties are missing/));
});

check("nested review needs no itemReviewed and uses the parent's name", () => {
  const report = validateMarkup(ld({ "@type": "Product", name: "Shoe", review: { "@type": "Review", author: { "@type": "Person", name: "Ana" }, reviewRating: { "@type": "Rating", ratingValue: 5 } } }));
  assert.equal(feature(report, "review-snippet").result, "eligible");
  assert.equal(feature(report, "product-snippet").result, "eligible");
});

check("standalone review needs itemReviewed", () => {
  const report = validateMarkup(ld({ "@type": "Review", author: { "@type": "Person", name: "Ana" }, reviewRating: { "@type": "Rating", ratingValue: 5 } }));
  assert.ok(feature(report, "review-snippet").missingRequired.includes("itemReviewed"));
});

check("FAQPage is valid but reported as a retired rich result, not an error", () => {
  const report = validateMarkup(ld({ "@type": "FAQPage", mainEntity: [{ "@type": "Question", name: "Q?", acceptedAnswer: { "@type": "Answer", text: "A." } }] }));
  assert.equal(errors(report).length, 0);
  const retired = report.features.find((item) => item.result === "retired");
  assert.equal(retired.name, "FAQ");
});

check("bad enumeration URL is an error", () => {
  const report = validateMarkup(ld({ "@type": "Offer", price: 1, priceCurrency: "USD", availability: "https://schema.org/InStok" }));
  assert.ok(find(report, /isn't a schema.org ItemAvailability value/));
});

check("non-ISO dates are flagged", () => {
  assert.ok(find(validateMarkup(ld({ "@type": "Article", headline: "x", datePublished: "yesterday" })), /isn't an ISO 8601 date/));
  assert.equal(find(validateMarkup(ld({ "@type": "Article", headline: "x", datePublished: "2026-10-07T09:00:00-04:00" })), /ISO 8601/), undefined);
});

check("@graph references resolve; dangling references are informational", () => {
  const report = validateMarkup(JSON.stringify({ "@context": "https://schema.org", "@graph": [
    { "@type": "Organization", "@id": "https://example.com/#org", name: "Acme", url: "https://example.com" },
    { "@type": "WebSite", "@id": "https://example.com/#site", url: "https://example.com", publisher: { "@id": "https://example.com/#org" }, about: { "@id": "https://example.com/#missing" } },
  ] }));
  const dangling = report.issues.filter((issue) => issue.category === "graph");
  assert.equal(dangling.length, 1);
  assert.equal(dangling[0].severity, "info");
  assert.match(dangling[0].message, /#missing/);
});

check("an enumeration value used as @type is explained", () => {
  assert.ok(find(validateMarkup(ld({ "@type": "InStock" })), /enumeration value, not a type/));
});

check("annotated action properties (mathExpression-input) are valid", () => {
  const report = validateMarkup(ld({ "@type": ["MathSolver", "LearningResource"], name: "Solver", url: "https://example.com", usageInfo: "https://example.com/terms", learningResourceType: "Math solver", potentialAction: { "@type": "SolveMathAction", target: "https://example.com/solve?q={q}", "mathExpression-input": "required name=q" } }));
  assert.equal(find(report, /mathExpression-input isn't/), undefined);
  assert.equal(feature(report, "math-solver").result, "eligible");
});

check("software app needs a rating or review", () => {
  const report = validateMarkup(ld({ "@type": "SoftwareApplication", name: "App", offers: { "@type": "Offer", price: 0 } }));
  assert.deepEqual(feature(report, "software-app").missingRequired, ["aggregateRating or review"]);
});

check("merchant listing needs an Offer, not only an AggregateOffer", () => {
  const report = validateMarkup(ld({ "@type": "Product", name: "Shoe", image: "https://example.com/s.jpg", offers: { "@type": "AggregateOffer", lowPrice: 50, priceCurrency: "USD" } }));
  assert.equal(feature(report, "product-snippet").result, "eligible");
  assert.ok(feature(report, "merchant-listing").missingRequired.includes("offers (Offer)"));
});

check("return policy accepts option A or option B", () => {
  assert.equal(feature(validateMarkup(ld({ "@type": "MerchantReturnPolicy", merchantReturnLink: "https://example.com/returns" })), "return-policy").result, "eligible");
  assert.equal(feature(validateMarkup(ld({ "@type": "MerchantReturnPolicy", applicableCountry: "US", returnPolicyCategory: "https://schema.org/MerchantReturnNotPermitted" })), "return-policy").result, "eligible");
  assert.equal(feature(validateMarkup(ld({ "@type": "MerchantReturnPolicy", applicableCountry: "US" })), "return-policy").result, "missing-required");
});

check("schema.org IRIs and prefixes normalize", () => {
  const extraction = extractStructuredData(JSON.stringify({ "@context": { "@vocab": "https://schema.org/" }, "@type": "https://schema.org/Person", "schema:name": "Ana" }));
  assert.deepEqual(extraction.nodes[0].types, ["Person"]);
  assert.equal(extraction.nodes[0].properties[0].name, "name");
});

check("non-schema.org vocabularies are skipped, not flagged", () => {
  const report = validateMarkup(JSON.stringify({ "@context": "https://www.w3.org/ns/activitystreams", "@type": "Note", content: "Hi" }));
  assert.equal(report.issues.filter((issue) => issue.category === "vocabulary").length, 0);
});

check("variant stubs under hasVariant aren't judged as standalone products", () => {
  const report = validateMarkup(ld({ "@type": "ProductGroup", name: "Runner", productGroupID: "R1", hasVariant: [{ "@type": "Product", url: "https://example.com/runner?size=8" }] }));
  assert.equal(feature(report, "product-variants").result, "eligible");
  assert.equal(feature(report, "product-snippet"), undefined);
});

check("a plain ImageObject isn't judged as image license metadata", () => {
  const plain = validateMarkup(ld({ "@type": "ImageObject", contentUrl: "https://example.com/a.jpg" }));
  assert.equal(feature(plain, "image-metadata"), undefined);
  const licensed = validateMarkup(ld({ "@type": "ImageObject", license: "https://example.com/license" }));
  assert.deepEqual(feature(licensed, "image-metadata").missingRequired, ["contentUrl"]);
});

check("a nested publisher Organization isn't reported as its own result", () => {
  const report = validateMarkup(ld({ "@type": "Article", headline: "x", publisher: { "@type": "Organization", name: "Acme" } }));
  assert.equal(feature(report, "organization"), undefined);
});

check("carousel items (ListItem.item) are checked as standalone results", () => {
  const report = validateMarkup(ld({ "@type": "ItemList", itemListElement: [{ "@type": "ListItem", position: 1, item: { "@type": "Recipe", name: "Pie" } }] }));
  assert.deepEqual(feature(report, "recipe").missingRequired, ["image"]);
});

check("a property used as a type is explained", () => {
  assert.ok(find(validateMarkup('<div itemscope itemtype="https://schema.org/abstract"></div>'), /abstract is a schema.org property, not a type/));
});

// Regressions from the independent review (2026-10-07).
check("prices with symbols or separators are flagged; plain numbers aren't", () => {
  assert.ok(find(validateMarkup(ld({ "@type": "Offer", price: "$19.99", priceCurrency: "USD" })), /price "\$19.99" should be a plain number/));
  assert.ok(find(validateMarkup(ld({ "@type": "Offer", price: "19,99 €", priceCurrency: "EUR" })), /should be a plain number/));
  assert.equal(find(validateMarkup(ld({ "@type": "Offer", price: "19.99", priceCurrency: "USD" })), /plain number|ISO 4217/), undefined);
  assert.equal(find(validateMarkup(ld({ "@type": "Offer", price: 19.99, priceCurrency: "USD" })), /plain number/), undefined);
});

check("currency symbols in priceCurrency are flagged", () => {
  assert.ok(find(validateMarkup(ld({ "@type": "Offer", price: 1, priceCurrency: "$" })), /isn't an ISO 4217 code/));
});

check("ratings outside the scale are errors (default 5-point scale)", () => {
  assert.ok(find(validateMarkup(ld({ "@type": "Rating", ratingValue: "7" })), /outside the rating scale \(1–5, Google's default/));
  assert.ok(find(validateMarkup(ld({ "@type": "Rating", ratingValue: "7", bestRating: "5" })), /outside the rating scale/));
  assert.equal(find(validateMarkup(ld({ "@type": "Rating", ratingValue: "7", bestRating: "10" })), /outside the rating scale/), undefined);
  assert.equal(find(validateMarkup(ld({ "@type": "Rating", ratingValue: "60%" })), /outside the rating scale/), undefined);
});

check("BlogPosting isn't judged as a discussion forum post", () => {
  assert.equal(feature(validateMarkup(ld({ "@type": "BlogPosting", headline: "Hi" })), "discussion-forum"), undefined);
});

check("Recipe doesn't get the retired How-to note", () => {
  assert.equal(validateMarkup(ld({ "@type": "Recipe", name: "Pie", image: "https://example.com/p.jpg" })).features.find((item) => item.result === "retired"), undefined);
});

check("review-only products aren't judged as merchant listings", () => {
  const report = validateMarkup(ld({ "@type": "Product", name: "Shoe", aggregateRating: { "@type": "AggregateRating", ratingValue: 4, reviewCount: 3 } }));
  assert.equal(feature(report, "merchant-listing"), undefined);
  assert.equal(feature(report, "product-snippet").result, "eligible");
});

check("duplicate keys are reported (unique properties as errors)", () => {
  const dupContext = validateMarkup('{"@context":"https://schema.org","@context":"https://schema.org","@type":"Thing","name":"x"}');
  assert.equal(errors(dupContext).filter((issue) => /Duplicate unique property: "@context"/.test(issue.message)).length, 1);
  const dupName = validateMarkup('{"@context":"https://schema.org","@type":"Thing",\n"name":"a",\n"name":"b"}');
  const issue = find(dupName, /"name" appears twice/);
  assert.equal(issue.severity, "warning");
  assert.match(issue.path, /line 3/);
  assert.equal(find(validateMarkup(ld({ "@type": "Thing", a: { name: "x" }, b: { name: "y" } })), /appears twice/), undefined, "same key in different objects is fine");
});

check("a broken microdata itemref is reported", () => {
  assert.ok(find(validateMarkup('<div itemscope itemtype="https://schema.org/Person" itemref="nope"><span itemprop="name">A</span></div>'), /Reference to nonexistent item: itemref "nope"/));
});

check("syntax errors carry Search Console's names", () => {
  assert.ok(find(validateMarkup('{"@context":"https://schema.org","@type":"Thing","name":"x",}'), /Missing '}' or object member name — often a trailing comma/));
  assert.ok(find(validateMarkup('{"@context":"https://schema.org" "@type":"Thing"}'), /Missing ',' or '}'/));
});

check("LocalBusiness menu: Google still documents it, hasMenu also satisfies", () => {
  const withMenu = validateMarkup(ld({ "@type": "Restaurant", name: "Cafe", address: "1 Main St", menu: "https://example.com/menu" }));
  const note = find(withMenu, /superseded menu with hasMenu/);
  assert.equal(note.severity, "info");
  assert.ok(!feature(withMenu, "local-business").missingRecommended.includes("menu"));
  const withHasMenu = validateMarkup(ld({ "@type": "Restaurant", name: "Cafe", address: "1 Main St", hasMenu: "https://example.com/menu" }));
  assert.ok(!feature(withHasMenu, "local-business").missingRecommended.includes("menu"));
});

check("WebSite SearchAction gets the retired sitelinks search box note", () => {
  const report = validateMarkup(ld({ "@type": "WebSite", url: "https://example.com", potentialAction: { "@type": "SearchAction", target: "https://example.com/?q={q}", "query-input": "required name=q" } }));
  assert.equal(find(report, /sitelinks search box/).severity, "info");
});

check("parse error names don't depend on the JS engine's wording (Node 18, Safari, Firefox)", () => {
  const trailing = '{"a":1,}';
  assert.match(googleParseErrorName("Unexpected token } in JSON at position 7", trailing, 7), /trailing comma/);
  assert.match(googleParseErrorName("JSON.parse: expected double-quoted property name at line 1 column 8", trailing, 7), /trailing comma/);
  const missingComma = '{"a":1 "b":2}';
  assert.equal(googleParseErrorName("Unexpected string in JSON at position 7", missingComma, 7), "Parsing error: Missing ',' or '}'");
  const arrayComma = '["a" "b"]';
  assert.equal(googleParseErrorName("Unexpected string in JSON at position 5", arrayComma, 5), "Parsing error: Missing ',' or ']' in array declaration");
  assert.equal(googleParseErrorName("Unexpected end of JSON input", '{"a":'), "Invalid JSON document — the block ends early (missing a closing quote, brace, or bracket)");
});

console.log(`validator engine: ${checks} checks passed`);
