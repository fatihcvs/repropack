# Contributing

Use Node.js 22 or later. There are no npm runtime dependencies. Run
`npm ci --ignore-scripts` to install the locked development-only JSON Schema
validator, then `npm test` from the checkout root. Linux execution tests require util-linux `unshare` and
user/PID/mount namespace permissions; Windows tests use Windows PowerShell/.NET.
Platform-specific tests skip on the other OS. Tests use disposable synthetic
projects; do not point fixtures at personal or production data.

Keep changes focused and explain the observed problem, resulting behavior and
validation in your pull request. Include a regression for changes to capture,
verification, execution or reporting that could misclassify a failure, lose
evidence or expose data. Documentation corrections do not need redundant tests.

Preserve the original source tree. A package being created or verified must not
be presented as a reproduced bug. Setup failures, mismatched signatures,
timeouts and cancellation must remain distinct. Do not relax timeouts or skip
failing tests just to get a passing result; record the environment and investigate.

Do not include real credentials or private logs in issues, fixtures or reports.
Use inert synthetic examples and inspect generated packages before sharing.
See [SECURITY.md](SECURITY.md) for reporting security problems.

Changes to skill instructions must retain review before execution and sharing,
re-check the same failure after reduction, and distinguish CLI tests from actual
agent behavior. Record model/version, task, budget and repetitions for model
evaluations using the [evaluation protocol](evals/README.md). Do not infer user
adoption or skill quality from fixture tests.
