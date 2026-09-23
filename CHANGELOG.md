# Changelog

## Unreleased — development preview

- Explicit Node.js reproduction file selection with bounded capture, portable
  path validation, SHA-256 inventory and integrity verification.
- Two fresh execution attempts with separate setup results, exact failure
  matching, filtered target environments, time/output limits and cancellation.
- Windows Job Object and Linux PID namespace descendant cleanup, including
  owner termination. Windows helper initialization uses a separate environment
  from the target.
- Markdown reports with literal path masking and preserved execution evidence.
- Draft `reproduce-bug` skill, an offline CLI example and a twelve-case synthetic
  evaluation corpus. Actual Claude behavior and comparative scores remain pending.
- Hosted Node 22/24 tests on Windows and Ubuntu 22.04 passed at commit `8d6ccb9`.
- English and Turkish quickstarts, contribution guidelines and security boundaries.
- Draft 2020-12 JSON schemas for capture recipes, manifests and execution results,
  checked against actual CLI/core outputs with a development-only validator.
- Pinned MIT-licensed comparison skill and seeded preparation of 108 independent
  evaluation workspaces; model trials remain unexecuted.
- Bounded, nonexecuting evaluation-file inspection for source preservation,
  artifact inventories and known synthetic secret markers; replay/scoring stays separate.
- Opt-in replay of reviewed plain artifacts from any evaluation arm, with corpus
  expectations, fresh attempts and before/after inventories; scoring stays manual.
- Evaluation-ledger summaries with separate arm/category denominators, explicit
  unrun/infrastructure/pending counts and no automatic evidence or release approval.

There is no stable release or npm publication yet. Local CLI validation and CI
do not establish external-user adoption or safety for running hostile packages.
