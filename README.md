# ReproPack

Build a reviewable package for a Node.js bug reproduction. Early development:
file capture and package integrity verification are implemented; execution and the Claude
Code skill are not yet implemented. A packaged artifact is not a reproduced bug.

Requires Node.js 22 or later. No runtime dependencies.

```sh
node src/cli.js create recipe.json
node src/cli.js verify ../bug-package
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
changes. Separate working directories are not a sandbox. Later execution
support must clearly distinguish setup failures, timeouts and signature matches.

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

- Implemented: explicit capture, portable path checks, digests, limits, manifest and package integrity verification.
- Pending: runner, repeated clean-directory verification, reports, skill,
  comparative evaluations, CI and first release.

This project is separate from Backup Coverage.
