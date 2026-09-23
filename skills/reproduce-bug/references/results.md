# Interpret evidence

`create` reports `packaged`: selected bytes and recipe exist, no code ran.
`verify` reports `verified` with `execution: not_run`: file integrity passed,
not trust or reproduction. Manifest hashes are not signatures of a trusted author.

Execution results:

| Status | Meaning |
| --- | --- |
| reproduced | Both fresh attempts had the expected nonzero exit code and literal signature. |
| intermittent | Only one attempt matched. Preserve both outputs; do not call this deterministic. |
| not_reproduced | Neither attempt matched, even if a different error occurred. |
| setup_failed | Installation/setup failed before the target could be evaluated. |
| timed_out / cancelled / output_limit | Execution was interrupted; the requested failure is not proved. |
| spawn_failed / startup_failed | The command or supervisor could not start/complete normally. |
| unsupported | The proposed command is outside the runner's supported command set. |

Inspect individual attempts and phases, not just the top-level label. CLI exit
0 means reproduced, 1 means another execution outcome, 2 means invalid input or
an operational error. Missing JSON is not a successful result. Setup output
matching the expected signature does not prove the target bug.

The report renderer checks consistency of reproduced claims but does not
authenticate the JSON. Keep original local evidence. Two attempts are a smoke
check, not a statistical estimate of flakiness. Describe the tested OS/runtime;
the manifest source commit is context and may include dirty working-tree bytes.
