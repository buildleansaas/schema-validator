// Builds src/schemaorg-vocab.json from the official schema.org release file.
//
//   curl -sL -o /tmp/schemaorg.jsonld https://schema.org/version/latest/schemaorg-current-https.jsonld
//   node scripts/build-schemaorg-vocab.mjs /tmp/schemaorg.jsonld 30.1
//
// The output is compact: types with their parents, properties with domains/ranges, and
// enumeration members. Pending terms are flagged; superseded terms carry their replacement.
import fs from "node:fs";

const [source, version] = process.argv.slice(2);
if (!source || !version) {
  console.error("usage: node scripts/build-schemaorg-vocab.mjs <schemaorg-current-https.jsonld> <version>");
  process.exit(1);
}

const graph = JSON.parse(fs.readFileSync(source, "utf8"))["@graph"];
const local = (id) => String(id).replace(/^schema:/, "");
const ids = (value) => (value == null ? [] : Array.isArray(value) ? value : [value]).map((item) => local(item["@id"]));
const asTypes = (value) => (Array.isArray(value) ? value : [value]).map(String);
const isPending = (term) => ids(term["schema:isPartOf"]).some((id) => id.includes("pending.schema.org"));

const types = {};
const properties = {};
const enumerationMembers = {};

for (const term of graph) {
  const termTypes = asTypes(term["@type"]);
  const name = local(term["@id"]);
  if (termTypes.includes("rdfs:Class")) {
    types[name] = {
      parents: ids(term["rdfs:subClassOf"]).filter((id) => !id.includes(":")),
      ...(termTypes.includes("schema:DataType") ? { dataType: true } : {}),
      ...(isPending(term) ? { pending: true } : {}),
      ...(term["schema:supersededBy"] ? { supersededBy: ids(term["schema:supersededBy"])[0] } : {}),
    };
  } else if (termTypes.includes("rdf:Property")) {
    properties[name] = {
      domains: ids(term["schema:domainIncludes"]),
      ranges: ids(term["schema:rangeIncludes"]),
      ...(isPending(term) ? { pending: true } : {}),
      ...(term["schema:supersededBy"] ? { supersededBy: ids(term["schema:supersededBy"])[0] } : {}),
    };
  } else {
    // Enumeration members (InStock, EventScheduled, ...) are typed by their enumeration class.
    enumerationMembers[name] = termTypes.map(local).filter((type) => !type.includes(":"));
  }
}

// DataType subclasses such as URL (subclass of Text) and Integer (subclass of Number) are not
// tagged schema:DataType themselves; inherit the flag so range checks treat them as literals.
const isDataType = (name, seen = new Set()) => {
  const type = types[name];
  if (!type || seen.has(name)) return false;
  seen.add(name);
  return Boolean(type.dataType) || type.parents.some((parent) => isDataType(parent, seen));
};
for (const name of Object.keys(types)) if (isDataType(name)) types[name].dataType = true;

const out = { version, source: "https://schema.org/version/latest/schemaorg-current-https.jsonld", types, properties, enumerationMembers };
const target = "src/schemaorg-vocab.json";
fs.writeFileSync(target, JSON.stringify(out));
console.log(`wrote ${target}: ${Object.keys(types).length} types, ${Object.keys(properties).length} properties, ${Object.keys(enumerationMembers).length} enumeration members (schema.org ${version})`);
