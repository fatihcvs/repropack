# ReproPack

Build a reviewable package for a Node.js bug reproduction. Early development:
file capture, integrity verification and local repeated execution are implemented.
The Claude Code skill and release evaluation are pending. A packaged artifact is not a reproduced bug.

Requires Node.js 22 or later. No runtime dependencies.

```sh
node src/cli.js create recipe.json
node src/cli.js verify ../bug-package
node src/cli.js run ../bug-package --allow-execution
npm test
```

Example recipe (paths resolve from the invoking working directory):

```json
{
  "root": "../broken-project",
  "output": "../bug-package",
  "files": ["package.json", "package-lock.json", "bug.js"],
  "command": ["node", "bug.js"],
  "signature": "KNOWN_FAILURE",
  "exitCode": 1,
  "timeoutMs": 10000
}
```

The output parent must exist; the output must not exist and must be separate
from the source. Selected files go into `project/`; `repropack.json` records
SHA-256 digests, runtime information and the proposed execution recipe. No
command in that recipe is executed by `create`. Source files are not modified.

Only explicit regular files are collected. Relative paths use forward slashes,
including on Windows. Links, junctions, traversal, case collisions, generated
dependency folders and common credential paths are rejected. Defaults limit
individual files to 5 MiB, the package to 20 MiB and selection to 1000 files.
The implementation reads selected bytes into bounded memory before writing.

Capture a stable, trusted source directory. This is not an atomic filesystem
snapshot or a defense against a hostile process replacing files during capture.
Metadata changes during individual reads are rejected. Credentials inside
ordinary source files are not automatically detected: inspect every selected
file before sharing. No uploads or environment-variable collection occur.

The recorded commit is context only; selected files can contain uncommitted
changes. Separate working directories are not a sandbox.

`verify` checks the recipe, selected file sizes and SHA-256 digests, lockfile
inventory, and unexpected files inside `project/`. It rejects links and reads
files within the same 5 MiB/20 MiB limits. Capture limits may be lowered, never
raised above those ceilings. The verifier retains checked bytes for the future
runner instead of requiring it to reopen mutable files. Verification still
requires a stable directory; it is not a hostile-filesystem snapshot.

The CLI reports `status: verified` with `execution: not_run`. This is an integrity
check, not a reproduced failure or a trust/signature check: someone who can edit
both files and the manifest can replace their contents. Review the recipe and
files before executing or sharing them. Files outside `project/` are not part
of the selected inventory and are not covered by this command.

## Development status

- Implemented: explicit capture, portable path checks, digests, limits, manifest, integrity verification and two-run local execution.
- Pending: stronger process containment, skill,
  comparative evaluations, CI and first release.

This project is separate from Backup Coverage.

## Local execution (development preview)

Review all selected source files and commands before using `run --allow-execution`.
This executes code with your operating-system permissions; files, network and
other local resources remain accessible. Only use trusted examples. No sandbox
or safe execution of hostile packages is provided.

Commands begin with `node` or `npm`, followed by individual arguments. Node uses
the current runtime; npm uses its CLI script from a standard installation on
PATH without constructing a shell command. npm scripts may themselves use a
shell. Optional `setup` is a separate argument array, for example
`["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"]`.
Dependency installation may access the network; omitting `--ignore-scripts`
allows package installation scripts. Nothing installs automatically unless
the recipe includes setup and execution is explicitly enabled.

Each of two attempts gets fresh project and home/cache directories. Arbitrary
parent environment variables are omitted (including tokens and NODE_OPTIONS);
OS/PATH/locale essentials are retained. Environment-dependent failures may
therefore differ from the original project. Each phase has the recipe timeout
and a combined 1 MiB stdout/stderr limit. Outputs are returned locally as JSON
and can contain sensitive application data; review before sharing.

`reproduced` requires the exact nonzero exit code and literal signature in
stdout or stderr in both attempts. Mixed matches are `intermittent`; two misses
are `not_reproduced`. Setup failure is `setup_failed`, with its own phase details.
Target timeout, cancellation, output overflow, spawn failure and unsupported
commands are distinct outcomes. A match proves this failure signature on this
machine, not its root cause or portability to another OS. CLI exit codes are
0 for reproduced, 1 for other execution outcomes, and 2 for invalid input or
operational errors.

On Windows, each phase runs under `src/windows-job.ps1`, which creates a
Job Object before starting the target. Ordinary descendants, including detached
children, are terminated when the target finishes or the supervisor is stopped.
The supervisor uses Windows PowerShell/.NET and runtime C# compilation. Startup
has a separate 20-second bound; the recipe timeout starts when the supervisor
is ready. A status record distinguishes target exit codes (including 125) from
supervisor launch failures. Startup adds several seconds per phase.

On POSIX, timeout/cancellation currently uses a process group; detached processes
are not yet reliably contained there. Neither implementation is a security
sandbox or protection against out-of-job brokers. The parent ReproPack process
being forcibly killed still needs an explicit supervisor watchdog; this remains
a release gate. Temporary files are removed on normal completion and handled
cancellation, but forceful parent termination can leave files. Only Windows
execution has been tested. See Microsoft's [Job Object lifecycle documentation](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects).

## Shareable report

Save the execution JSON, then render it as Markdown:

```sh
node src/cli.js run ../bug-package --allow-execution > result.json
node src/cli.js report result.json --mask-path "C:\Users\Example" > report.md
```

Use a UTF-8 result file (older Windows PowerShell redirection may use UTF-16;
use PowerShell 7 or save stdout as UTF-8). `report` accepts repeated `--mask-path`
options. Each replaces the exact supplied string and its forward-slash variant
in report text, including arguments and process output. It does not change the
saved evidence or package and does not detect arbitrary secrets or path variants.

Reports include the expected failure/command, actual phase outcomes, runtime
version/platform, selected file hashes and available source commit, with separate
stdout/stderr for each attempt. Fenced output remains literal Markdown even when
the application prints backticks or headings. Review all content before sharing.
Rendering does not execute a package, authenticate evidence or upload anything.
Failed/unsupported runs retain their recipe and environment too; unexecuted
phases are identified. A claimed `reproduced` result is rejected if the recorded
attempts do not contain two matching failures with successful setup.
