# Planned: open a pull request with accepted fixes

Status: design only. Nothing in this version writes to a repository.

## Goal

Let a team turn accepted, verified fixes into a pull request against the repository that produced the audited source, so changes go through normal code review instead of being copied by hand.

## Flow

1. **Connect.** An organisation installs a GitHub App with `contents: write` and `pull_requests: write` on selected repositories only. A11y stores the installation id, never a personal token. Tokens are minted per request on the server and expire within an hour.
2. **Map the document to a file.** Source audits already know their file name. The user picks the repository, base branch and path; the server fetches that file at the base commit and checks it is byte-identical to the audited text. If it differs, the patch is re-based with `applyPatch` from the `diff` package, and any hunk that fails stops the flow with a message. URL snapshot audits are excluded: a DOM snapshot is not a source file.
3. **Require verification.** The button is enabled only when the current accepted set has a fresh, non-stale verification result with no validation errors. Findings still failing or introduced are listed in the PR body rather than hidden.
4. **Create the branch and commit.** Create `a11y/<audit-id>` from the base commit, write the patched file through the Git Data API, and commit with a message listing each fix and its WCAG criterion.
5. **Open the pull request.** The body includes the standard and engine versions, a table of fixes with confidence and verification status, any fixes that needed human-written text (so reviewers check the wording), the manual-review checklist, and the non-certification notice.

## Safeguards

- Explicit confirmation before any write, naming the repository, branch and file.
- Never push to the base branch; always a new branch and a pull request.
- Only files the user selected; one file per pull request in the first version.
- Rate limits per installation, and an audit log of every write.
- Instructions found inside scanned content are never used to choose repositories, branches or paths.

## Work required

A GitHub App registration, a server route for the OAuth installation callback, a small encrypted store for installation ids (the first persistent server state in the product), and an integration test against a throwaway repository.
