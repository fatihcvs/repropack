# Node/npm recipes

Invoke either an installed `repropack` binary or `node /absolute/checkout/src/cli.js`.
The checkout path must come from the installation/user context. Node 22+ is required.

Example recipe, using absolute source and output paths for predictable invocation:

```json
{
  "root": "/work/staging-example",
  "output": "/work/artifacts/repro-01",
  "files": ["package.json", "package-lock.json", "src/failure.js"],
  "setup": ["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"],
  "command": ["node", "src/failure.js"],
  "signature": "EXPECTED_SPECIFIC_ERROR",
  "exitCode": 1,
  "cwd": ".",
  "timeoutMs": 10000
}
```

Omit setup and npm files for an example with no dependencies. For dependencies,
retain package.json and the matching package-lock.json; do not regenerate a lock
silently. `npm ci` can use the network. `--ignore-scripts` avoids installation
scripts but can prevent native packages from working; disclose that limitation.
An npm target such as `["npm", "test", "--", "--runInBand"]` can run arbitrary
package scripts. Review them as well as the selected test.

Paths in `files` and `cwd` use forward slashes, including on Windows. Root/output
resolve relative to the CLI's current directory, not the recipe file. The output
parent must already exist, and output must be new and separate from root.
Commands are argument arrays; do not put a shell pipeline into one string.

```sh
repropack create recipe.json
repropack verify /work/artifacts/repro-01
repropack run /work/artifacts/repro-01 --allow-execution > result.json
repropack report result.json --mask-path /work > report.md
```

Preserve run stdout even when exit status is 1. Do not chain report with `&&`
when you need a report of an unsuccessful run. Windows PowerShell 5 redirection
can produce UTF-16: save stdout as UTF-8 using an explicit encoder or use
PowerShell 7. Keep stderr separate so diagnostics cannot corrupt JSON.

The runner omits arbitrary parent environment variables. It does not inherit
API tokens, NODE_OPTIONS or app-specific flags. Each attempt installs into its
own project/home/cache directories. A failure that needs a credential or service
is not automatically reproducible there; do not copy credentials to make it work.

Windows Job Object and Linux PID namespace supervision have local lifecycle
tests, but they are not security sandboxes. Linux needs util-linux `unshare` and
permission to create user/PID/mount namespaces; denial is a startup failure, not
the target bug. Linux changes visible PIDs and `/proc`. Hosted CI and other POSIX
systems remain unverified. Do not advertise an untested OS as supported.

Choose a realistic setup timeout. npm startup can exceed the default 10 seconds
on WSL-mounted drives; the included npm fixtures allow 60 seconds per phase.
