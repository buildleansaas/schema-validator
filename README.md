# @buildleansaas/schema-validator

Validate structured data the way search engines read it. Give it JSON-LD, or an HTML page with JSON-LD, microdata, or RDFa, and it checks:

- **Syntax**: JSON parse errors with line and column, named the way Search Console names them ("Missing ',' or '}'"), plus duplicate keys and missing `@context` / `@type`.
- **The schema.org vocabulary** (bundled, version 30.1): unknown types and properties with "did you mean" suggestions, properties used on a type they don't belong to (inheritance-aware), values in the wrong form (dates, durations, prices, currency codes, rating scales, enumeration URLs), and superseded or pending terms.
- **Google rich result requirements** for 29 features (Product snippet, Merchant listing, Recipe, Event, Review snippet, Article, Breadcrumb, Job posting, Video, and more), transcribed from Google Search Central's documentation. It marks each item eligible or not eligible and lists exactly what's missing, including "one of" rules (a product snippet needs a review, a rating, *or* an offer). Retired rich results such as FAQ and How-to are reported as notes, not errors: the markup is still valid.

There's a hosted version with a UI at **[swiftschema.com/tools/schema-validator](https://www.swiftschema.com/tools/schema-validator)**, and a [Rich Results Test tool](https://www.swiftschema.com/tools/rich-results-test) built on the same engine.

## Install

```sh
npm install @buildleansaas/schema-validator   # once published to npm
npm install github:buildleansaas/schema-validator   # works today
```

## CLI

```sh
# Validate a built site (exits 1 if any page has errors, so it works in CI)
npx @buildleansaas/schema-validator ./out
# or, straight from GitHub:
npx github:buildleansaas/schema-validator ./out

# A single file or a live URL
npx @buildleansaas/schema-validator ./public/index.html
npx @buildleansaas/schema-validator https://example.com/products/trail-shoe

# Options
--json              full reports as JSON
--fail-on <level>   error (default), warning, or never
--quiet             only print files with issues at or above --fail-on
```

Directories are scanned for `.html`, `.htm`, `.json`, and `.jsonld` files.

```
out/products/trail-shoe.html  1 error, 3 warnings, 0 notes
  ✓ Product snippet [Product]
  ✗ Merchant listing [Product] (missing image)
  error   Merchant listing: missing required image.  (JSON-LD block 1 › $)
          fix: Add image. Without it, this Product isn't eligible for the Merchant listing rich result.
  warning Product snippet: 4 recommended properties are missing (aggregateRating, review, Offer: availability, Offer: priceValidUntil).  (JSON-LD block 1 › $)
          fix: Add the ones that are true and visible on the page. They're optional, but they make the result more complete.
  warning Merchant listing: 17 recommended properties are missing (aggregateRating, brand.name, color, description, gtin (or isbn), material, mpn, pattern, review, size, sku, Offer: availability, Offer: hasMerchantReturnPolicy, Offer: itemCondition, Offer: priceValidUntil, Offer: shippingDetails, Offer: url).  (JSON-LD block 1 › $)
          fix: Add the ones that are true and visible on the page. They're optional, but they make the result more complete.
  warning price "$129.00" should be a plain number.  (JSON-LD block 1 › $.offers)
          fix: Use digits with a "." for decimals and no currency symbol or thousands separator (for example "1299.99"). Put the currency in priceCurrency.
```

### GitHub Actions

```yaml
- run: npm run build
- run: npx @buildleansaas/schema-validator ./out --quiet
```

## Library

```js
import { validateMarkup } from "@buildleansaas/schema-validator";

const report = validateMarkup(htmlOrJsonLd);

report.totals;    // { errors, warnings, infos }
report.issues;    // [{ severity, category, message, fix, path, docsUrl }]
report.features;  // [{ name: "Product snippet", result: "eligible" | "missing-required" | "retired", missingRequired, missingRecommended }]
report.nodes;     // the extracted items, as a tree
```

`extractStructuredData(input)` returns just the extracted items (JSON-LD, microdata, and RDFa in one model). `GOOGLE_FEATURES` and `RETIRED_FEATURES` expose the rule tables. CommonJS (`require`) works too.

## Chrome extension

`extension/` contains a Chrome extension (Manifest V3) built on the same engine. It validates the page you're looking at, including JSON-LD added by JavaScript, because it reads the rendered DOM. It only asks for `activeTab` and `scripting` and sends nothing anywhere. Build it with `node extension/build.mjs`.

## What it doesn't do

- **Run JavaScript.** It reads the HTML you give it. If a page adds JSON-LD in the browser, validate the rendered HTML (for example from a headless browser or Chrome DevTools).
- **Replace Google's Rich Results Test.** Google's test is the final word on what Google shows. This package checks against Google's published requirements and the full schema.org vocabulary, and it explains the fixes.
- **Guarantee rich results.** Google [doesn't guarantee](https://developers.google.com/search/docs/appearance/structured-data/sd-policies) a rich result even for valid markup.

## Updating the vocabulary

```sh
curl -sL -o /tmp/schemaorg.jsonld https://schema.org/version/latest/schemaorg-current-https.jsonld
npm run vocab -- /tmp/schemaorg.jsonld <version>
```

The Google rules live in `src/google-features.ts`, with the date they were last verified against Google's docs.

## License

MIT © [Build Lean SaaS](https://www.buildleansaas.com)
