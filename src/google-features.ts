// Google Search rich-result requirements, transcribed from Google Search Central's
// "Structured data type definitions" tables. Re-verify against the docs when updating.
//
// Requirement syntax:
//   "a.b"         property path (nested objects and @id references are followed)
//   "a+b"         all of these paths (used inside anyOf for "Option A / Option B" rules)
//   "^name"       the parent node's property (Google allows the parent's name for nested reviews)
import type { FeatureStatus } from "./types";

export const GOOGLE_RULES_VERIFIED = "2026-10-07";

export interface Requirement {
  anyOf: string[];
  /** Shown instead of the paths, e.g. "review, aggregateRating, or offers". */
  label?: string;
  /** Not required when the node is nested under one of these parent properties. */
  unlessNestedVia?: string[];
}

export interface NestedRule {
  via: string;
  /** Only nodes of these types are checked (subtypes included). */
  types?: string[];
  excludeTypes?: string[];
  /** The feature needs at least one nested node matching this rule. */
  requireOne?: boolean;
  required?: Requirement[];
  recommended?: Requirement[];
  /** Requirements skipped for the last item in the list (breadcrumb item URLs). */
  notForLast?: string[];
  label: string;
}

export interface FeatureDefinition {
  id: string;
  name: string;
  docsUrl: string;
  status: FeatureStatus;
  statusNote?: string;
  types: string[];
  excludeTypes?: string[];
  /**
   * By default a feature is only checked on items Google reads as standalone results: top-level
   * items, @graph members, ListItem.item (carousels), and mainEntity. Set this for features that
   * are normally nested (reviews, videos, breadcrumbs, policies).
   */
  matchNested?: boolean;
  /** Only check nodes that have at least one of these properties (signals the feature is intended). */
  detectWhenAny?: string[];
  required: Requirement[];
  recommended: Requirement[];
  nested?: NestedRule[];
  note?: string;
}

const req = (...paths: string[]): Requirement => ({ anyOf: paths });
const list = (...paths: string[]): Requirement[] => paths.map((path) => req(path));
const DOCS = "https://developers.google.com/search/docs/appearance/structured-data/";

export const REVIEWABLE_TYPES = [
  "Book", "Course", "CreativeWorkSeason", "CreativeWorkSeries", "Episode", "Event", "Game", "HowTo", "LocalBusiness",
  "MediaObject", "Movie", "MusicPlaylist", "MusicRecording", "Organization", "Product", "Recipe", "SoftwareApplication",
];

// A product or app is only eligible through its rating or review if that nested item is valid too.
const NESTED_RATING: NestedRule = { via: "aggregateRating", label: "AggregateRating", types: ["AggregateRating"], required: [req("ratingValue"), { anyOf: ["ratingCount", "reviewCount"], label: "ratingCount or reviewCount" }] };
const NESTED_REVIEW: NestedRule = { via: "review", label: "Review", types: ["Review"], required: [req("author"), req("reviewRating.ratingValue")] };

export const GOOGLE_FEATURES: FeatureDefinition[] = [
  {
    id: "article", name: "Article", docsUrl: `${DOCS}article`, status: "supported",
    types: ["Article"],
    note: "Article has no required properties; Google recommends these so it can show the title, image, and date.",
    required: [],
    recommended: list("author", "author.name", "author.url", "dateModified", "datePublished", "headline", "image"),
  },
  {
    id: "breadcrumb", name: "Breadcrumb", docsUrl: `${DOCS}breadcrumb`, status: "supported",
    matchNested: true, types: ["BreadcrumbList"],
    required: list("itemListElement"),
    recommended: [],
    nested: [{
      via: "itemListElement", label: "ListItem", types: ["ListItem"],
      required: [req("position"), { anyOf: ["name", "item.name"], label: "name" }, req("item")],
      notForLast: ["item"],
    }],
  },
  {
    id: "dataset", name: "Dataset", docsUrl: `${DOCS}dataset`, status: "limited",
    statusNote: "Used by Google Dataset Search, not Google Search results.",
    types: ["Dataset"],
    required: list("description", "name"),
    recommended: list("alternateName", "creator", "citation", "funder", "hasPart", "identifier", "isAccessibleForFree", "keywords", "license", "measurementTechnique", "sameAs", "spatialCoverage", "temporalCoverage", "variableMeasured", "version", "url"),
  },
  {
    id: "discussion-forum", name: "Discussion forum", docsUrl: `${DOCS}discussion-forum`, status: "supported",
    types: ["DiscussionForumPosting", "SocialMediaPosting"], excludeTypes: ["BlogPosting"],
    required: [req("author"), req("author.name"), req("datePublished"), { anyOf: ["text", "image", "video"], label: "text, image, or video" }],
    recommended: list("author.url", "comment", "commentCount", "creativeWorkStatus", "dateModified", "digitalSourceType", "headline", "image", "interactionStatistic", "isPartOf", "sharedContent", "url", "video"),
  },
  {
    id: "education-qa", name: "Education Q&A", docsUrl: `${DOCS}education-qa`, status: "supported",
    types: ["Quiz"],
    required: list("hasPart"),
    recommended: list("about", "about.name", "educationalAlignment"),
    nested: [{ via: "hasPart", label: "Question", types: ["Question"], required: list("acceptedAnswer", "eduQuestionType", "text") }],
  },
  {
    id: "employer-rating", name: "Employer aggregate rating", docsUrl: `${DOCS}employer-rating`, status: "supported",
    types: ["EmployerAggregateRating"],
    required: [req("itemReviewed"), req("ratingValue"), { anyOf: ["ratingCount", "reviewCount"], label: "ratingCount or reviewCount" }],
    recommended: list("bestRating", "worstRating"),
  },
  {
    id: "event", name: "Event", docsUrl: `${DOCS}event`, status: "supported",
    types: ["Event"],
    required: list("location", "location.address", "name", "startDate"),
    recommended: list("description", "endDate", "eventStatus", "image", "offers", "organizer", "performer"),
  },
  {
    id: "image-metadata", name: "Image metadata", docsUrl: `${DOCS}image-license-metadata`, status: "supported",
    types: ["ImageObject"], detectWhenAny: ["creator", "creditText", "copyrightNotice", "license", "acquireLicensePage"],
    required: [{ anyOf: ["contentUrl", "url"], label: "contentUrl" }, { anyOf: ["creator", "creditText", "copyrightNotice", "license"], label: "creator, creditText, copyrightNotice, or license" }],
    recommended: list("acquireLicensePage", "creator", "creditText", "copyrightNotice", "license"),
  },
  {
    id: "job-posting", name: "Job posting", docsUrl: `${DOCS}job-posting`, status: "supported",
    types: ["JobPosting"],
    note: "Fully remote jobs can use jobLocationType TELECOMMUTE with applicantLocationRequirements instead of jobLocation.",
    required: [req("datePosted"), req("description"), req("hiringOrganization"), { anyOf: ["jobLocation", "jobLocationType+applicantLocationRequirements"], label: "jobLocation" }, req("title")],
    recommended: list("applicantLocationRequirements", "baseSalary", "directApply", "employmentType", "identifier", "jobLocationType", "validThrough"),
  },
  {
    id: "local-business", name: "Local business", docsUrl: `${DOCS}local-business`, status: "supported",
    types: ["LocalBusiness"],
    required: list("address", "name"),
    recommended: [...list("aggregateRating", "department", "geo", "geo.latitude", "geo.longitude"), { anyOf: ["menu", "hasMenu"], label: "menu" }, ...list("openingHoursSpecification", "priceRange", "review", "servesCuisine", "telephone", "url")],
  },
  {
    id: "math-solver", name: "Math solver", docsUrl: `${DOCS}math-solvers`, status: "supported",
    types: ["MathSolver"],
    required: list("potentialAction", "potentialAction.mathExpression-input", "potentialAction.target", "url", "usageInfo"),
    recommended: list("inLanguage", "assesses", "potentialAction.eduQuestionType"),
  },
  {
    id: "movie", name: "Movie carousel", docsUrl: `${DOCS}movie`, status: "supported",
    types: ["Movie"],
    note: "Movies appear in a carousel when the page also has an ItemList of movies, or on a single movie page.",
    required: list("image", "name"),
    recommended: list("aggregateRating", "dateCreated", "director", "review"),
  },
  {
    id: "organization", name: "Organization", docsUrl: `${DOCS}organization`, status: "supported",
    types: ["Organization"], excludeTypes: ["LocalBusiness"],
    note: "Organization has no required properties. Google uses it for knowledge panel and logo details.",
    required: [],
    recommended: list("address", "contactPoint", "description", "email", "legalName", "logo", "name", "sameAs", "telephone", "url"),
  },
  {
    id: "profile-page", name: "Profile page", docsUrl: `${DOCS}profile-page`, status: "supported",
    types: ["ProfilePage"],
    required: [req("mainEntity"), { anyOf: ["mainEntity.name", "mainEntity.alternateName"], label: "mainEntity.name" }],
    recommended: list("dateCreated", "dateModified", "mainEntity.description", "mainEntity.identifier", "mainEntity.image", "mainEntity.sameAs"),
  },
  {
    id: "qa-page", name: "Q&A", docsUrl: `${DOCS}qapage`, status: "supported",
    types: ["QAPage"],
    required: list("mainEntity"),
    recommended: [],
    nested: [{
      via: "mainEntity", label: "Question", types: ["Question"],
      required: [req("answerCount"), { anyOf: ["acceptedAnswer", "suggestedAnswer"], label: "acceptedAnswer or suggestedAnswer" }, req("name")],
      recommended: list("author", "datePublished", "text", "upvoteCount"),
    }],
  },
  {
    id: "recipe", name: "Recipe", docsUrl: `${DOCS}recipe`, status: "supported",
    types: ["Recipe"],
    required: list("image", "name"),
    recommended: list("aggregateRating", "author", "cookTime", "datePublished", "description", "keywords", "nutrition.calories", "prepTime", "recipeCategory", "recipeCuisine", "recipeIngredient", "recipeInstructions", "recipeYield", "totalTime", "video"),
  },
  {
    id: "review-snippet", name: "Review snippet", docsUrl: `${DOCS}review-snippet`, status: "supported",
    matchNested: true, types: ["Review"], excludeTypes: ["CriticReview"],
    required: [
      req("author"),
      { anyOf: ["itemReviewed"], unlessNestedVia: ["review", "reviews"] },
      { anyOf: ["itemReviewed.name", "^name"], label: "itemReviewed.name" },
      req("reviewRating"),
      req("reviewRating.ratingValue"),
    ],
    recommended: list("datePublished", "reviewRating.bestRating", "reviewRating.worstRating"),
  },
  {
    id: "aggregate-rating", name: "Review snippet (aggregate rating)", docsUrl: `${DOCS}review-snippet`, status: "supported",
    matchNested: true, types: ["AggregateRating"], excludeTypes: ["EmployerAggregateRating"],
    required: [
      { anyOf: ["itemReviewed"], unlessNestedVia: ["aggregateRating"] },
      { anyOf: ["itemReviewed.name", "^name"], label: "itemReviewed.name" },
      { anyOf: ["ratingCount", "reviewCount"], label: "ratingCount or reviewCount" },
      req("ratingValue"),
    ],
    recommended: list("bestRating", "worstRating"),
  },
  {
    id: "product-snippet", name: "Product snippet", docsUrl: `${DOCS}product-snippet`, status: "supported",
    types: ["Product"], excludeTypes: ["ProductGroup"],
    required: [req("name"), { anyOf: ["review", "aggregateRating", "offers"], label: "review, aggregateRating, or offers" }],
    recommended: list("aggregateRating", "offers", "review"),
    nested: [
      { via: "offers", label: "Offer", types: ["Offer"], excludeTypes: ["AggregateOffer"], required: [{ anyOf: ["price", "priceSpecification.price"], label: "price" }], recommended: list("availability", "priceCurrency", "priceValidUntil") },
      { via: "offers", label: "AggregateOffer", types: ["AggregateOffer"], required: list("lowPrice", "priceCurrency"), recommended: list("highPrice", "offerCount") },
      NESTED_RATING,
      NESTED_REVIEW,
    ],
  },
  {
    id: "merchant-listing", name: "Merchant listing", docsUrl: `${DOCS}merchant-listing`, status: "supported",
    types: ["Product"], excludeTypes: ["ProductGroup"], detectWhenAny: ["offers"],
    note: "Only for pages where customers can buy the product from you. Merchant listings need an Offer; an AggregateOffer alone isn't enough.",
    required: list("name", "image", "offers"),
    recommended: [req("aggregateRating"), req("brand.name"), req("color"), req("description"), { anyOf: ["gtin", "gtin8", "gtin12", "gtin13", "gtin14", "isbn"], label: "gtin (or isbn)" }, req("material"), req("mpn"), req("pattern"), req("review"), req("size"), req("sku")],
    nested: [{
      via: "offers", label: "Offer", types: ["Offer"], excludeTypes: ["AggregateOffer"], requireOne: true,
      required: [{ anyOf: ["price", "priceSpecification.price"], label: "price" }, { anyOf: ["priceCurrency", "priceSpecification.priceCurrency"], label: "priceCurrency" }],
      recommended: list("availability", "hasMerchantReturnPolicy", "itemCondition", "priceValidUntil", "shippingDetails", "url"),
    }],
  },
  {
    id: "product-variants", name: "Product variants", docsUrl: `${DOCS}product-variants`, status: "supported",
    types: ["ProductGroup"],
    required: list("name"),
    recommended: list("aggregateRating", "brand", "description", "hasVariant", "productGroupID", "review", "url", "variesBy"),
  },
  {
    id: "software-app", name: "Software app", docsUrl: `${DOCS}software-app`, status: "supported",
    types: ["SoftwareApplication"],
    required: [req("name"), req("offers.price"), { anyOf: ["aggregateRating", "review"], label: "aggregateRating or review" }],
    recommended: list("applicationCategory", "operatingSystem"),
    nested: [NESTED_RATING, NESTED_REVIEW],
  },
  {
    id: "vacation-rental", name: "Vacation rental", docsUrl: `${DOCS}vacation-rental`, status: "supported",
    types: ["VacationRental"],
    required: [req("containsPlace"), req("containsPlace.occupancy"), req("containsPlace.occupancy.value"), req("identifier"), req("image"), { anyOf: ["latitude", "geo.latitude"], label: "latitude" }, { anyOf: ["longitude", "geo.longitude"], label: "longitude" }, req("name")],
    recommended: list("additionalType", "address", "aggregateRating", "brand", "checkinTime", "checkoutTime", "containsPlace.additionalType", "containsPlace.amenityFeature", "description", "review"),
  },
  {
    id: "video", name: "Video", docsUrl: `${DOCS}video`, status: "supported",
    matchNested: true, types: ["VideoObject"],
    required: list("name", "thumbnailUrl", "uploadDate"),
    recommended: list("contentUrl", "description", "duration", "embedUrl", "expires", "hasPart", "interactionStatistic", "regionsAllowed"),
  },
  {
    id: "course", name: "Course list", docsUrl: `${DOCS}course`, status: "supported",
    types: ["Course"],
    note: "Course list results need an ItemList of courses on the page as well.",
    required: list("description", "name"),
    recommended: list("provider"),
  },
  {
    id: "loyalty-program", name: "Loyalty program", docsUrl: `${DOCS}loyalty-program`, status: "supported",
    matchNested: true, types: ["MemberProgram"],
    required: list("description", "hasTiers", "name"),
    recommended: list("url"),
    nested: [{ via: "hasTiers", label: "MemberProgramTier", types: ["MemberProgramTier"], required: list("hasTierBenefit", "name"), recommended: list("hasTierRequirement", "membershipPointsEarned", "url") }],
  },
  {
    id: "return-policy", name: "Return policy", docsUrl: `${DOCS}return-policy`, status: "supported",
    matchNested: true, types: ["MerchantReturnPolicy"],
    required: [{ anyOf: ["applicableCountry+returnPolicyCategory", "merchantReturnLink"], label: "applicableCountry and returnPolicyCategory (or merchantReturnLink)" }],
    recommended: list("merchantReturnDays", "returnFees", "returnMethod", "returnShippingFeesAmount"),
  },
  {
    id: "shipping-policy", name: "Shipping policy", docsUrl: `${DOCS}shipping-policy`, status: "supported",
    matchNested: true, types: ["ShippingService"],
    required: list("shippingConditions"),
    recommended: list("name", "description", "fulfillmentType", "handlingTime"),
  },
  {
    id: "speakable", name: "Speakable", docsUrl: `${DOCS}speakable`, status: "limited",
    statusNote: "Beta: news publishers, English (US), Google Assistant.",
    matchNested: true, types: ["SpeakableSpecification"],
    required: [{ anyOf: ["cssSelector", "xPath"], label: "cssSelector or xPath" }],
    recommended: [],
  },
];

/** Google rich results that are retired or being phased out. The type is still valid schema.org. */
export interface RetiredFeature {
  /** Types that trigger the note (subtypes included unless listed in excludeTypes). Empty: table only. */
  types: string[];
  excludeTypes?: string[];
  /** Shown in the table when types is empty. */
  typesLabel?: string;
  name: string;
  status: Exclude<FeatureStatus, "supported">;
  note: string;
  source: string;
}

const UPDATES = "https://developers.google.com/search/updates";

// Verified 2026-10-07 against Google's Search Central updates page and feature docs.
export const RETIRED_FEATURES: RetiredFeature[] = [
  { types: ["FAQPage"], name: "FAQ", status: "retired", note: "Google stopped showing FAQ rich results on May 7, 2026 and removed the documentation.", source: `${UPDATES}#removing-faq-rich-result` },
  { types: ["HowTo"], excludeTypes: ["Recipe"], name: "How-to", status: "retired", note: "Removed from Google Search in September 2023.", source: `${UPDATES}#how-to-deprecation` },
  { types: ["ClaimReview"], name: "Fact check", status: "limited", note: "Google is phasing out ClaimReview in Search (announced June 12, 2025); Fact Check Explorer still uses it.", source: "https://developers.google.com/search/docs/appearance/structured-data/factcheck" },
  { types: ["SpecialAnnouncement"], name: "Special announcement", status: "retired", note: "Phased out from July 31, 2025; documentation removed September 9, 2025.", source: "https://developers.google.com/search/blog/2025/06/simplifying-search-results" },
  { types: ["EstimatedSalary"], name: "Estimated salary", status: "retired", note: "Phased out from June 2025; documentation removed September 9, 2025.", source: `${UPDATES}#simplification` },
  { types: ["Vehicle"], name: "Vehicle listing", status: "retired", note: "Phased out from June 2025; documentation removed September 9, 2025.", source: `${UPDATES}#simplification` },
  { types: ["CourseInstance"], name: "Course info", status: "retired", note: "Phased out from June 2025; documentation removed September 9, 2025. Course list (Course) is still supported.", source: `${UPDATES}#simplification` },
  { types: [], typesLabel: "VideoObject + LearningResource", name: "Learning video", status: "retired", note: "Phased out from June 2025; documentation removed September 9, 2025.", source: `${UPDATES}#simplification` },
  { types: [], typesLabel: "WebSite › SearchAction", name: "Sitelinks search box", status: "retired", note: "No longer shown in Google Search; documentation removed November 29, 2024.", source: UPDATES },
  { types: ["PracticeProblem"], name: "Practice problem", status: "retired", note: "Removed from Google Search in January 2026.", source: `${UPDATES}#removing-practice-problems` },
  { types: ["HomeActivity"], name: "Home activity", status: "retired", note: "No longer appears in Google Search (June 2024).", source: `${UPDATES}#home-activities` },
  { types: ["CriticReview"], name: "Critic review", status: "retired", note: "Deprecated by Google in June 2021; regular review snippets are unaffected.", source: `${UPDATES}#critic-review` },
];
