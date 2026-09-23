# JSON contracts (development, schema version 1)

The schemas use JSON Schema draft 2020-12. Register all four files with your
validator so their `$ref` links resolve locally; validation does not need a
network request. `common.schema.json` contains shared definitions. The other
three schemas are entry points:

| Document | Schema | Producer |
| --- | --- | --- |
| Capture recipe | `schemas/recipe.schema.json` | User or skill; input to `create` |
| Captured manifest | `schemas/manifest.schema.json` | `create`, saved as `repropack.json` |
| Execution result | `schemas/result.schema.json` | `run` stdout |

Recipes require explicit `root`, `output`, `files`, `command` and `signature`.
Optional defaults are exit code 1, cwd `.`, timeout 10000 ms, 5 MiB per file and
20 MiB total. Setup is omitted unless requested. Schema validators do not apply
these defaults; `create` does. Paths resolve from the caller's working directory.

Captured manifests record `schemaVersion: 1`, `status: packaged`, source commit
context, capture environment, normalized recipe, selected file metadata and
lockfile digests. This schema describes complete generated manifests; the
runtime verifier may accept older hand-written manifests without descriptive
source/environment metadata. It still requires execution and integrity fields.

Results contain the execution environment, recipe, selected files, and zero to
two attempts. `source` is optional when it was absent in the input manifest.
An attempt has a number, optional setup, and a target plus `matched` when the
target was reached. Each phase records status, nullable exit code, stdout/stderr,
and optional signal/error. Windows exit codes are not restricted to 0–255.

| Result status | Meaning |
| --- | --- |
| `reproduced` | Both targets exited with the expected code and signature |
| `not_reproduced` | Both targets exited, neither matched |
| `intermittent` | Both targets exited, exactly one matched |
| `setup_failed` | Setup failed or was stopped; inspect its phase status |
| `cancelled` | Execution was cancelled, possibly before any attempt |
| `timed_out` | Target exceeded the recipe phase timeout |
| `output_limit` | Target exceeded the combined output limit |
| `spawn_failed` | Target/supervisor could not start or report completion |
| `startup_failed` | Supervisor exceeded its independent startup timeout |
| `unsupported` | Command resolution failed before execution; includes reason |

Top-level status distinguishes setup failure from target failure. A setup timeout
is `setup_failed` with a `timed_out` setup phase. Cancellation remains `cancelled`.
CLI exit codes are 0 for reproduced, 1 for other execution outcomes, and 2 for
invalid input/operational errors that prevent returning a result document.

Additional fields are allowed for annotations. A schema match is **structural**:
it does not authenticate data or prove a bug. Schemas cannot compare each output
to the recipe's dynamic signature, recompute file hashes, sum selected byte
counts, compare lockfile inventories, enforce normalized path uniqueness or
inspect filesystem links. Portable path/exclusion checks and UTF-16 signature
length limits are also enforced by the CLI. Run `verify` on a stable directory
for package integrity; use the runner for actual observations. `report` rejects
a reproduced claim without two matching recorded failures, but is not an
authenticator or a complete validator for every possible hand-edited result.

Tests compile these schemas with the locked development-only Ajv dependency,
validate actual capture/reproduction/setup-failure/cancellation/unsupported
outputs, and reject malformed recipes, metadata and reproduced structures.
Ajv is not imported by the CLI; using the tool needs no runtime dependencies.
