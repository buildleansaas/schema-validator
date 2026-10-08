# Chrome Web Store listing

Upload `extension/schema-validator-extension-<version>.zip` (built by `node extension/build.mjs`).

## Store listing

- **Name:** SwiftSchema – Schema Markup Validator
- **Summary (132 chars max):** Check the structured data on any page: JSON-LD, microdata, and RDFa against schema.org and Google's rich result requirements.
- **Category:** Developer Tools
- **Language:** English
- **Screenshots:** `store/screenshot-1.png`, `store/screenshot-2.png` (1280×800)
- **Small promo tile:** `store/promo-small-440x280.png`
- **Website:** https://www.swiftschema.com/tools/schema-validator
- **Support:** https://github.com/buildleansaas/schema-validator/issues

**Description:**

Click the icon on any page to check its structured data.

What it checks:
• Syntax: JSON-LD parse errors and missing @context or @type
• The schema.org vocabulary: unknown types and properties (with "did you mean" suggestions), properties used on the wrong type, and values in the wrong form (dates, prices, currency codes, rating scales)
• Google rich result requirements for 29 features, including Product snippet, Merchant listing, Recipe, Event, Review snippet, Article, Breadcrumb, Job posting, and Video. Each item is marked eligible or not eligible, with exactly what's missing.
• Retired rich results such as FAQ and How-to are flagged as notes, so you don't chase results Google no longer shows.

It reads the page as your browser rendered it, so JSON-LD added by JavaScript, a CMS, or a tag manager is included.

Everything runs locally in the extension. "Full report" and "Rich results preview" open the free tools on swiftschema.com.

This is an independent tool, not affiliated with Google. Confirm the final result in Google's Rich Results Test.

Open source: https://github.com/buildleansaas/schema-validator

## Privacy practices

- **Single purpose:** Validate the structured data (schema.org markup) on the page the user is viewing.
- **activeTab justification:** Lets the extension read the current page only when the user clicks the extension icon.
- **scripting justification:** Runs one function in the current tab to read the rendered HTML (document.documentElement.outerHTML), which is then validated inside the extension.
- **Remote code:** No. All code ships in the package.
- **Data usage:** The extension doesn't collect or transmit user data. The page HTML is processed locally and discarded when the popup closes. The only network activity happens if the user clicks a link to swiftschema.com, which opens in a normal tab with the page URL as a parameter.
- Certify: no sale of data, no use unrelated to the single purpose, no creditworthiness use.
