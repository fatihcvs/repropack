# Offline CLI quickstart

This is a development preview, not the completed skill release. Install Node.js
22 or later and clone this repository. Run the following commands from its root.
Windows execution needs Windows PowerShell and .NET; Linux needs util-linux
`unshare` and permission to create user/PID/mount namespaces. macOS execution has
not been validated. No npm install is needed to run this dependency-free CLI.

Read `fixtures/assertion/bug.cjs` first. It is a synthetic quantity-calculation
bug, with no network or package dependencies. Create `recipe.json` in the
repository root:

```json
{
  "root": "fixtures/assertion",
  "output": "../repropack-assertion-package",
  "files": ["bug.cjs"],
  "command": ["node", "bug.cjs"],
  "signature": "TOTAL_IGNORES_QUANTITY",
  "exitCode": 1,
  "timeoutMs": 10000
}
```

The output directory must not already exist. Choose another output name if it
does; do not delete an existing reproduction to rerun this example. Paths in a
recipe resolve from your current working directory, not the recipe's location.

```sh
node src/cli.js create recipe.json
node src/cli.js verify ../repropack-assertion-package
node src/cli.js run ../repropack-assertion-package --allow-execution > result.json
node src/cli.js report result.json > report.md
```

Use a UTF-8 terminal redirection (for example PowerShell 7 or a POSIX shell).
In Windows PowerShell 5, replace the last two commands with:

```powershell
$runOutput = node src/cli.js run ../repropack-assertion-package --allow-execution
[IO.File]::WriteAllLines((Join-Path $PWD 'result.json'), $runOutput, [Text.UTF8Encoding]::new($false))
$reportOutput = node src/cli.js report result.json
[IO.File]::WriteAllLines((Join-Path $PWD 'report.md'), $reportOutput, [Text.UTF8Encoding]::new($false))
```

`create` should report `packaged`, and `verify` should report `verified` with
`execution: not_run`. Inspect the package's manifest and selected file before
running. `run` deliberately executes the reviewed code with your permissions;
separate directories and process cleanup are not a security sandbox.

The expected run status is `reproduced`: two fresh attempts exit with code 1 and
print `TOTAL_IGNORES_QUANTITY`. The CLI itself exits 0 for this matched failure.
The report records the expected command, runtime, file hash and actual output.
It does not fix the bug or establish its root cause. A failed supervisor startup
or unavailable namespace is an operational failure, not the expected example.

For another project, explicitly select the files needed to reproduce it. If npm
dependencies are required, include `package.json` and `package-lock.json`, and
review an optional setup command such as
`["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"]`. This can use the
network. Allow enough phase time for setup; a missing dependency or failed
installation must not be counted as the original bug.

Review every file and all output before sharing. Common credential filenames
are excluded, but credentials embedded in source or logs are not detected.
`report --mask-path` masks supplied literal paths only, without changing the
original evidence. Nothing is uploaded automatically.

For the separate draft skill workflow, see [skill installation](skill-installation.md).
CLI success is not evidence that Claude loaded or followed the skill.
