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

There is no stable release or npm publication yet. Local CLI validation and CI
do not establish external-user adoption or safety for running hostile packages.
