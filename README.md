# ReproPack

Build a reviewable package for a Node.js bug reproduction. Early development:
the file capture command is implemented; execution, verification and the Claude
Code skill are not yet implemented. A packaged artifact is not a reproduced bug.

Requires Node.js 22 or later. No runtime dependencies.

```sh
node src/cli.js create recipe.json
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

## Development status

- Implemented: explicit capture, portable path checks, digests, limits and manifest.
- Pending: runner, repeated clean-directory verification, reports, skill,
  comparative evaluations, CI and first release.

This project is separate from Backup Coverage.
