// Commits changed Storybook visual regression snapshots back to the PR branch
// via GitHub's GraphQL createCommitOnBranch mutation. API-created commits are
// signed by GitHub, which the repo's "Require signed commits" ruleset demands
// (a plain `git push` from CI would be rejected).
//
// Required env: GITHUB_TOKEN, REPO ("owner/name"), BRANCH, EXPECTED_HEAD_OID.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const SNAPSHOTS_DIR = "apps/code/.storybook/__snapshots__";
const COMMIT_MESSAGE = "chore(storybook): update visual regression snapshots";
// createCommitOnBranch payloads carry base64 file contents inline, so batch
// commits to stay well under GitHub's request size limit.
const MAX_BATCH_BYTES = 20 * 1024 * 1024;
const MAX_BATCH_FILES = 100;

const { GITHUB_TOKEN, REPO, BRANCH, EXPECTED_HEAD_OID } = process.env;
for (const [name, value] of Object.entries({
  GITHUB_TOKEN,
  REPO,
  BRANCH,
  EXPECTED_HEAD_OID,
})) {
  if (!value) {
    console.error(`Missing required env var ${name}`);
    process.exit(1);
  }
}

const status = execFileSync(
  "git",
  ["status", "--porcelain", "--", SNAPSHOTS_DIR],
  {
    encoding: "utf8",
  },
);
const additions = [];
const deletions = [];
for (const line of status.split("\n").filter(Boolean)) {
  const state = line.slice(0, 2).trim();
  const file = line.slice(3);
  if (state.startsWith("R")) {
    const [from, to] = file.split(" -> ");
    deletions.push(from);
    additions.push(to);
  } else if (state === "D") {
    deletions.push(file);
  } else {
    additions.push(file);
  }
}

if (additions.length === 0 && deletions.length === 0) {
  console.log("No snapshot changes to commit");
  process.exit(0);
}
console.log(
  `Committing ${additions.length} changed and ${deletions.length} deleted snapshots`,
);

const batches = [];
let batch = { additions: [], deletions: [...deletions], bytes: 0 };
for (const file of additions) {
  const contents = readFileSync(file).toString("base64");
  if (
    batch.additions.length >= MAX_BATCH_FILES ||
    (batch.bytes + contents.length > MAX_BATCH_BYTES &&
      batch.additions.length > 0)
  ) {
    batches.push(batch);
    batch = { additions: [], deletions: [], bytes: 0 };
  }
  batch.additions.push({ path: file, contents });
  batch.bytes += contents.length;
}
batches.push(batch);

async function graphql(query, variables) {
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      authorization: `Bearer ${GITHUB_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = await response.json();
  if (!response.ok || body.errors) {
    throw new Error(
      `GraphQL request failed: ${JSON.stringify(body.errors ?? body)}`,
    );
  }
  return body.data;
}

let headOid = EXPECTED_HEAD_OID;
for (const [
  index,
  { additions: batchAdditions, deletions: batchDeletions },
] of batches.entries()) {
  const message =
    batches.length === 1
      ? COMMIT_MESSAGE
      : `${COMMIT_MESSAGE} (${index + 1}/${batches.length})`;
  const data = await graphql(
    `mutation ($input: CreateCommitOnBranchInput!) {
      createCommitOnBranch(input: $input) { commit { oid } }
    }`,
    {
      input: {
        branch: { repositoryNameWithOwner: REPO, branchName: BRANCH },
        expectedHeadOid: headOid,
        message: { headline: message },
        fileChanges: {
          additions: batchAdditions,
          deletions: batchDeletions.map((path) => ({ path })),
        },
      },
    },
  );
  headOid = data.createCommitOnBranch.commit.oid;
  console.log(`Created commit ${headOid} (${message})`);
}
