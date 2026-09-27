// Fails when a live repository ruleset differs from its committed definition in this directory.
//
// GitHub does not apply rulesets from files, so the JSON here is the reviewed source of truth and
// someone with admin rights applies it (see docs/internals/conventions.md). This check is what
// notices when the two disagree — a change made in the UI, or a committed change not yet applied.
//
// Runs with a read-only token. A read-only caller is not shown `bypass_actors`, so those are
// compared by no one; everything else a ruleset enforces is.
//
// Usage: node .github/rulesets/check.mjs   (GITHUB_REPOSITORY and GITHUB_TOKEN from the env)

import { readdir, readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";

const repository = process.env.GITHUB_REPOSITORY ?? "slsdotdev/dsqlbase";
const token = process.env.GITHUB_TOKEN;
const directory = new URL(".", import.meta.url);

/** What the check compares: every field a read-only caller can see and an admin can set. */
const COMPARED = ["name", "target", "enforcement", "conditions", "rules"];

async function api(path) {
  const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });

  if (!response.ok) {
    throw new Error(`GET ${path}: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

/** Stable form: compared fields only, rules sorted by type, object keys sorted everywhere. */
function normalize(ruleset) {
  const picked = Object.fromEntries(COMPARED.map((key) => [key, ruleset[key]]));
  picked.rules = [...(picked.rules ?? [])].sort((a, b) => a.type.localeCompare(b.type));

  return sortKeys(picked);
}

function sortKeys(value) {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys(value[key])])
    );
  }

  return value;
}

const files = (await readdir(directory)).filter((file) => file.endsWith(".json"));
const committed = await Promise.all(
  files.map(async (file) => ({
    file,
    ruleset: JSON.parse(await readFile(new URL(file, directory), "utf8")),
  }))
);
const live = await api("/rulesets?includes_parents=false");
let drift = false;

for (const { file, ruleset } of committed) {
  const summary = live.find((candidate) => candidate.name === ruleset.name);

  if (!summary) {
    console.log(`✗ ${file}: no live ruleset named "${ruleset.name}".`);
    drift = true;
    continue;
  }

  const expected = normalize(ruleset);
  const actual = normalize(await api(`/rulesets/${summary.id}`));

  if (isDeepStrictEqual(expected, actual)) {
    console.log(`✓ ${file}: matches live ruleset "${ruleset.name}" (${summary.id}).`);
    continue;
  }

  drift = true;
  console.log(`✗ ${file}: live ruleset "${ruleset.name}" (${summary.id}) differs.`);
  console.log(`--- committed\n${JSON.stringify(expected, null, 2)}`);
  console.log(`--- live\n${JSON.stringify(actual, null, 2)}`);
}

// A ruleset created in the UI with no file here is drift too.
for (const { name, id } of live) {
  if (!committed.some(({ ruleset }) => ruleset.name === name)) {
    console.log(`✗ live ruleset "${name}" (${id}) has no file here.`);
    drift = true;
  }
}

if (drift) {
  console.log(
    "\nRulesets have drifted. Apply the committed file (docs/internals/conventions.md), or " +
      "commit the live change if it was intended."
  );
  process.exit(1);
}
