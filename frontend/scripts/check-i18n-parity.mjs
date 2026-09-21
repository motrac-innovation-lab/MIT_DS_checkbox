#!/usr/bin/env node
// check-i18n-parity.mjs -- copy this into your own project as scripts/check-i18n-parity.mjs.
// Companion to docs/i18n-language-switcher.md.
//
// Exits 1 when the locale directories under src/i18n/locales have drifted:
//   - a namespace file present in one language and not another,
//   - a key present in one language and not another (including array elements,
//     addressed by index as "list.0", and empty objects),
//   - a plural key missing one of that language's own CLDR categories, or
//   - a plural sub-key (including a non-CLDR one such as `_zero`) present in one
//     language and absent from another.
//
// Not covered: value-level checks. A key whose value was never actually translated
// (still holding the source language's text) looks identical to a correct one here.
//
// A key is only read as a plural when its `_<category>` suffix is a real CLDR
// category FOR THAT LANGUAGE (or the non-CLDR `_zero` i18next honours as an exact
// match) AND a sibling `<base>_other` exists in the same file. That keeps ordinary
// keys like `step_one` or `tier_two` from being mistaken for plurals.
//
// Run:  node scripts/check-i18n-parity.mjs
// Reference language: I18N_REFERENCE env var, defaults to "nl".
// Locales directory:  I18N_LOCALES_DIR env var, defaults to ../src/i18n/locales
//                     relative to THIS FILE (so the script works from any cwd,
//                     assuming it lives in scripts/ one level below the package root).

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = process.env.I18N_LOCALES_DIR
  ? path.resolve(process.env.I18N_LOCALES_DIR)
  : path.resolve(HERE, "../src/i18n/locales");
const REFERENCE = process.env.I18N_REFERENCE ?? "nl";

/**
 * Flattens nested JSON into dotted leaf paths. Arrays are walked with the index as
 * a path segment, because i18next addresses their elements as real keys:
 *   { a: { b: "x" }, list: ["p", "q"], empty: {} } -> ["a.b", "list.0", "list.1", "empty"]
 * An empty object/array contributes its own prefix, so one existing in a single
 * language is still a reportable difference.
 */
function collectLeafKeys(value, prefix, out) {
  if (value !== null && typeof value === "object") {
    const entries = Array.isArray(value)
      ? value.map((child, index) => [String(index), child])
      : Object.entries(value);
    if (entries.length === 0) {
      out.push(prefix);
      return out;
    }
    for (const [key, child] of entries) {
      collectLeafKeys(child, prefix ? `${prefix}.${key}` : key, out);
    }
    return out;
  }
  out.push(prefix);
  return out;
}

/** The `_<suffix>` values this language may legitimately use, and which it must have. */
function pluralSuffixes(language) {
  const cardinal = new Intl.PluralRules(language).resolvedOptions().pluralCategories;
  const ordinal = new Intl.PluralRules(language, { type: "ordinal" }).resolvedOptions()
    .pluralCategories;
  const required = new Set([...cardinal, ...ordinal.map((c) => `ordinal_${c}`)]);
  // `zero` is not a CLDR category for nl/en, but i18next honours an explicit
  // `<base>_zero` key as an exact-match special case, so it is recognised (never required).
  return { required, recognised: new Set([...required, "zero"]) };
}

/** "n_one" -> { base: "n", category: "one" }; "n_ordinal_two" -> { base: "n", category: "ordinal_two" }. */
function splitPluralSuffix(key, recognised) {
  const parts = key.split("_");
  if (parts.length < 2) return { base: key, category: null };
  const last = parts[parts.length - 1];
  const rest = parts.slice(0, -1);
  if (rest.length >= 2 && rest[rest.length - 1] === "ordinal") {
    const category = `ordinal_${last}`;
    if (!recognised.has(category)) return { base: key, category: null };
    return { base: rest.slice(0, -1).join("_"), category };
  }
  if (!recognised.has(last)) return { base: key, category: null };
  return { base: rest.join("_"), category: last };
}

function indexNamespace(json, suffixes) {
  const leaves = collectLeafKeys(json, "", []);
  const leafSet = new Set(leaves);
  const plain = new Set();
  const plurals = new Map(); // base key -> Set of categories present

  for (const leaf of leaves) {
    const { base, category } = splitPluralSuffix(leaf, suffixes.recognised);
    // CLDR guarantees an `other` category for every language, so a real plural group
    // always has one. Without a sibling `<base>_other`, this is an ordinary key that
    // merely happens to end in a category word (`step_one`, `tier_two`).
    const sibling = category?.startsWith("ordinal_") ? `${base}_ordinal_other` : `${base}_other`;
    if (category === null || !leafSet.has(sibling)) {
      plain.add(leaf);
      continue;
    }
    let present = plurals.get(base);
    if (!present) {
      present = new Set();
      plurals.set(base, present);
    }
    present.add(category);
  }
  return { plain, plurals };
}

async function readLocale(language, suffixes) {
  const dir = path.join(LOCALES_DIR, language);
  const namespaces = new Map();
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const file = path.join(dir, entry.name);
    const raw = await readFile(file, "utf8");
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(`${file}: invalid JSON -- ${err.message}`);
    }
    namespaces.set(entry.name.slice(0, -".json".length), indexNamespace(parsed, suffixes));
  }
  return namespaces;
}

/**
 * True when `key` -- an ordinary key on this side -- is really one orphaned member of a
 * plural group the other side has in full (`i_one` alone here; `i_one` + `i_other` there).
 * `indexNamespace` only reads a key as a plural when a sibling `<base>_other` exists, so a
 * half-written group degrades to a plain key and would otherwise be reported twice: once
 * correctly as a missing/extra *plural* key, and once misleadingly as a missing/extra
 * *plain* key ("extra key i_one (not in nl)" when `i_one` is in fact present in nl, just
 * as part of the group). The plural-level report is the accurate one, so suppress this.
 */
function belongsToPluralGroup(key, recognised, otherPlurals) {
  const { base, category } = splitPluralSuffix(key, recognised);
  return category !== null && otherPlurals.has(base);
}

function checkRequiredCategories(language, namespace, base, present, required, problems) {
  const categories = [...present];
  const wanted = [...required].filter((c) =>
    categories.some((p) => p.startsWith("ordinal_") === c.startsWith("ordinal_")),
  );
  for (const category of wanted) {
    if (!present.has(category)) {
      problems.push(`${language}/${namespace}: plural "${base}" is missing "${base}_${category}"`);
    }
  }
}

async function main() {
  const entries = await readdir(LOCALES_DIR, { withFileTypes: true });
  const directories = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  const problems = [];
  const languages = [];
  const suffixesByLanguage = new Map();
  for (const name of directories) {
    try {
      suffixesByLanguage.set(name, pluralSuffixes(name));
      languages.push(name);
    } catch {
      problems.push(
        `"${name}" is not a valid language tag -- unexpected directory under ${LOCALES_DIR}`,
      );
    }
  }

  if (!languages.includes(REFERENCE)) {
    console.error(`Reference language "${REFERENCE}" not found in ${LOCALES_DIR}`);
    process.exitCode = 1;
    return;
  }

  const locales = new Map();
  for (const language of languages) {
    locales.set(language, await readLocale(language, suffixesByLanguage.get(language)));
  }

  const reference = locales.get(REFERENCE);
  const referenceRequired = suffixesByLanguage.get(REFERENCE).required;
  const referenceRecognised = suffixesByLanguage.get(REFERENCE).recognised;

  // The reference language must satisfy its own plural categories.
  for (const [namespace, index] of reference) {
    for (const [base, present] of index.plurals) {
      checkRequiredCategories(REFERENCE, namespace, base, present, referenceRequired, problems);
    }
  }

  for (const language of languages) {
    if (language === REFERENCE) continue;
    const target = locales.get(language);
    const required = suffixesByLanguage.get(language).required;
    const recognised = suffixesByLanguage.get(language).recognised;

    for (const namespace of reference.keys()) {
      if (!target.has(namespace)) {
        problems.push(`${language}: missing namespace file "${namespace}.json"`);
      }
    }
    for (const namespace of target.keys()) {
      if (!reference.has(namespace)) {
        problems.push(`${language}: extra namespace file "${namespace}.json" (not in ${REFERENCE})`);
      }
    }

    for (const [namespace, referenceIndex] of reference) {
      const targetIndex = target.get(namespace);
      if (!targetIndex) continue;

      for (const key of referenceIndex.plain) {
        if (targetIndex.plain.has(key)) continue;
        if (belongsToPluralGroup(key, referenceRecognised, targetIndex.plurals)) continue;
        problems.push(`${language}/${namespace}: missing key "${key}"`);
      }
      for (const key of targetIndex.plain) {
        if (referenceIndex.plain.has(key)) continue;
        if (belongsToPluralGroup(key, recognised, referenceIndex.plurals)) continue;
        problems.push(`${language}/${namespace}: extra key "${key}" (not in ${REFERENCE})`);
      }
      for (const base of referenceIndex.plurals.keys()) {
        if (!targetIndex.plurals.has(base)) {
          problems.push(`${language}/${namespace}: missing plural key "${base}_*"`);
        }
      }
      for (const [base, present] of targetIndex.plurals) {
        const referencePresent = referenceIndex.plurals.get(base);
        if (!referencePresent) {
          problems.push(
            `${language}/${namespace}: extra plural key "${base}_*" (not in ${REFERENCE})`,
          );
          continue;
        }
        checkRequiredCategories(language, namespace, base, present, required, problems);

        // Cross-language category diff. Skips a category that is genuinely required by
        // one language's CLDR set and not the other's (nl has one ordinal category, en
        // has four) and one already reported by the required-category check above --
        // what's left is a non-CLDR category like `_zero` existing on only one side.
        for (const category of referencePresent) {
          if (present.has(category) || required.has(category) || referenceRequired.has(category)) {
            continue;
          }
          problems.push(
            `${language}/${namespace}: plural "${base}" is missing "${base}_${category}" (present in ${REFERENCE})`,
          );
        }
        for (const category of present) {
          if (
            referencePresent.has(category) ||
            referenceRequired.has(category) ||
            required.has(category)
          ) {
            continue;
          }
          problems.push(
            `${language}/${namespace}: plural "${base}" has "${base}_${category}", which ${REFERENCE} does not`,
          );
        }
      }
    }
  }

  if (problems.length > 0) {
    console.error(`i18n parity check FAILED (${problems.length} problem(s)):\n`);
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error(`\nReference language: ${REFERENCE}. Fix the files above, then re-run.`);
    // process.exitCode, never process.exit() -- Node's stderr writes to a pipe are
    // asynchronous on macOS, so exiting immediately can truncate the list above on CI.
    process.exitCode = 1;
    return;
  }

  console.log(`i18n parity OK -- ${languages.join(", ")} all match "${REFERENCE}".`);
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exitCode = 1;
});
