---
name: reproduce-bug
description: Build and verify a small, shareable reproduction package for a Node.js or npm CLI/test failure using ReproPack. Use when asked to produce a runnable bug example or reduce a failing project; not for merely explaining an error or fixing the original application.
---

# Reproduce a bug

Produce a reviewed package, two fresh execution attempts, and a report that
distinguishes observed evidence from assumptions. Preserve the original source.

## Establish the failure

Read the user's failing command, expected behavior and observed error. Inspect
the relevant source and dependency files before executing code. Resolve the
installed `repropack` command or a user-provided checkout's `src/cli.js`; check
`--help`. Do not download a similarly named package or implement a substitute
runner if the CLI is missing. Report the missing installation instead.

Choose a literal, specific error signature and the expected nonzero exit code
from evidence. Do not change these criteria merely to make a run pass. If they
are unknown, establish them with an authorized local trial or ask for the missing
failure output. Do not inject a fake error into the example.

Use [the Node/npm recipe guide](references/node-npm.md) when selecting files or
writing the recipe. Browser interactions, external services, secrets, native
toolchains and commands other than Node/npm may prevent a standalone example;
describe that boundary rather than claiming a local substitute proves the issue.

## Package, run, reduce

Select explicit files needed by the command, including imported local modules,
runtime data and the dependency lockfile. Inspect their contents for credentials
and private data. If sanitized copies are needed, make them in a separate staging
tree and disclose the transformation. Do not collect the entire repository,
environment, home directory or generated dependencies.

Write the recipe with a new output directory outside the source tree. Use the
CLI's `create` then `verify`; neither executes the example. Inspect the selected
inventory and proposed setup/target commands. Execute `run --allow-execution`
when the user's scope authorizes running that reviewed code. Existing explicit
authorization suffices; packaging-only requests do not authorize execution.
Fresh directories are not a sandbox: code retains OS permissions and network
access. Do not execute untrusted submissions as though verification made them safe.

Save the complete JSON result as UTF-8, including nonzero CLI outcomes. Keep the
first package that reproduces the target failure. To reduce it, remove or simplify
one dependency group in a separate candidate tree/package, then verify and run
again. Retain a candidate only if both attempts still match the original failure.
Never overwrite the known-good baseline. Stop when further reduction is not
worth the work or the agreed time budget is reached; state what remains.

## Hand off evidence

Use `report` to render the saved result. Read [result interpretation](references/results.md)
before calling a run successful. Include the expected behavior supplied by the
user, exact commands, selected file list, outcome, and remaining dependencies.
Mask private local paths in the report where appropriate, then review the raw
package, JSON and report independently for sensitive data. Report masking does
not sanitize the package or raw evidence.

Leave artifacts locally with clear paths. Publishing an issue, comment, PR or
upload needs a separate user request; a request for a reproduction is not one.
Do not claim root cause, portability, real-user validation or a fixed bug based
on two local matching failures.
