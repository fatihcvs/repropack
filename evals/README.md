# Skill comparison protocol (not yet executed)

The corpus has 12 synthetic tasks: four deterministic failures, two setup or
environment problems, two intermittent programs, two secret-handling cases and
two unsupported scenarios. All credentials are inert sentinels. Do not replace
them with real credentials. `cases.js` includes evaluator-only expectations;
agents receive only the materialized workspace and its `task.md`.

```sh
node evals/materialize.js imported-helper /existing-parent/new-trial
```

This writes source/, an empty artifacts/ and task.md. Each case/arm/repetition
needs a new directory. Creation refuses an existing destination. Inputs do not
install packages or contact services. Only the missing-lock case requests npm
ci, explicitly offline; a setup failure is its intended observation.

## Controls

Use three arms: no skill; a pinned revision of an existing reproduction skill;
ReproPack's skill at a recorded commit. The comparator is GitHub's
`awesome-copilot/skills/bug-reproduction-brief` at commit
`d7e4ad98ed8fd72e4744ee604e6277eb36748fe2`. Its complete skill directory contained
only `SKILL.md`; the unchanged file and upstream MIT license are included under
`vendor/bug-reproduction-brief/`. `provenance.json` records upstream paths, Git
blob IDs and SHA-256 checksums. The skill's attribution to its original workflow
is retained. This is an evaluation input, not an installed runtime skill or an
executed model trial.

Give all arms the identical task, tools, CLI installation location, OS/runtime,
permission limits and budget. CLI access in all arms isolates the value of the
skill instructions; it does not measure the CLI's incremental value. Do not give
only our arm a precomputed recipe or expected outcome. Remove unrelated skills,
MCP integrations and personal project instructions from the evaluation context.
Record provider/model version actually returned, token/cost limit, wall-time
limit, invocation type, start/end time, tool trace and permission interventions.
An alias alone is not a pinned model version. Do not continue an earlier arm's
conversation or let it read the other arms' outputs.

Run three repetitions per case per arm (108 trials), randomizing case/arm order
with a recorded seed. Use equal budgets chosen in a separate pilot, then freeze
them before comparison. Explicit invocation and automatic discovery are distinct
checks: record a separate discovery trial instead of silently helping one arm.
Authentication failures count as infrastructure failures, never skill outcomes;
retain them and resume with the same conditions after access is restored.

## Evaluate actual artifacts

Have the evaluator replay the handed-off instructions in a second fresh directory
with only the selected files. Preserve raw stdout, stderr and exit codes. Check
that a missing helper/data file or failed setup is not labeled the target bug.
Required file hints in the corpus are not rigid filename requirements: valid
reductions may inline code while preserving the original failure mechanism.
Inspect transformations rather than rewarding a copied error string.

For intermittent cases, ground truth is each observed attempt. Two matches may
support that run's `reproduced` label, but never a claim of determinism. Record
all attempts; prohibit changing random/timing branches to force an outcome.

For secret cases, scan every proposed shareable artifact, including reports and
raw evidence, for forbiddenMarkers. Original source deliberately contains the
sentinels and is not itself an output. Inspect source preservation and require
disclosure of sanitization. An unexecuted package with no secrets is not by itself
a successful reproduction. For unsupported cases, correctly describing the
boundary is success; fabricated Node substitutes or real-service access are not.

Record for every trial: portable replay result, false reproduced claim, missing
files, elapsed preparation time, interventions, leaked markers, preserved source,
remaining limits and artifact paths/hashes. Publish denominators by category;
do not average unsupported success into a claim of executable reproductions.
Keep protocol changes and excluded trials visible. Any false reproduction or
secret leakage needs investigation and correction before release.

Fixture unit checks prove only the dataset behaves as designed. They are not
Claude skill runs, comparative scores or evidence of user adoption. Actual model
runs currently require working Claude credentials (the initial smoke trial
failed with API 401 before model execution).

## Prepare a campaign without model calls

```sh
node evals/prepare.js /existing-parent/new-comparison recorded-seed /absolute/repropack/src/cli.js
```

This prepares all 108 workspaces in a reproducible digest-sorted order. It records
the seed and each case/arm/repetition in a separate `plan.json`. The no-skill arm
gets no project-local skill; the comparator gets the pinned upstream file and
license; our arm gets all skill files read from the repository's current **commit**,
not uncommitted edits. Every arm receives identical source bytes and task text
for the same case, including the same CLI path. Original-source hashes are recorded
outside the trial workspaces for later preservation checks.

Preparation verifies comparator checksums and refuses an existing destination.
An interrupted preparation leaves `status: preparing` and must not be reused as
a complete campaign. Successful preparation records `prepared_not_executed` and
`not_run` for every trial. It does not run examples, Claude, npm setup, or evaluations.
There are no scores or success claims. No model, budget, pilot or invocation mode
is preselected: these fields remain null until the pilot and protocol are frozen.

Before any actual run, complete those fields, pin the **complete** CLI installation
(the preparer records only its entry-file hash), verify credentials, and configure
the agreed equal tool/permission context. Add explicit skill invocation consistently
for the two skill arms if that is the chosen protocol; automatic discovery is a
separate check. Do not treat the identical base tasks alone as validated invocation.

The workspace directories prevent accidental file reuse; they are not access-control
isolation. Keep `plan.json`, other trials and evaluator expectations out of the agent's
accessible context using the execution environment. Global/personal skills, MCPs and
instructions must also be controlled. Preparation cannot enforce these conditions.

## Inspect a trial's files without executing them

```sh
node evals/inspect.js source-secret /absolute/trial-workspace > inspection.json
```

Run this from the same pinned corpus revision that prepared the trial. Keep the
inspection output outside `artifacts/`, which is the candidate's proposed sharing
inventory. The inspector compares `source/` with the original case bytes, records
artifact paths/sizes/SHA-256 digests, and searches for that case's synthetic secret
markers in filenames, UTF-8/UTF-16 bytes and decoded JSON strings/keys. Marker hits
use numeric IDs without copying their values into the inspection report.

Each inventory is limited to 1000 entries (including directories), 5 MiB per file,
20 MiB total and 32 levels. Links and nonregular files are refused. A missing,
unreadable, changing or oversized inventory is `incomplete`, not a clean scan;
unknown source preservation is `null`. Partial inventories must not be used as
complete sharing lists. Inspection needs a stable trusted tree and is not an
atomic snapshot or hostile-filesystem security boundary.

CLI exit 2 means incomplete inspection/invalid input. Exit 1 means inspection
completed but found changed originals, no artifacts, known markers or opaque
files. Exit 0 only means those limited checks passed. Archives are not unpacked,
and arbitrary encoding/obfuscation is not decoded. Opaque/binary artifacts require
manual review; absence of a known marker is not a general secret-free guarantee.

The tool always reports `replay: not_run` and `outcome: not_scored`. It does not
execute candidate commands, decide whether a transformation preserves the bug,
verify a reproduction claim, or infer success from an empty/clean directory.
Perform the separate fresh-directory replay and transformation review described
above before recording trial outcomes. Prepared but unrun trials remain unrun.

## Replay reviewed artifacts

An evaluator can replay plain files from **any** arm using a small, separately
authored review JSON. Review all selected code, dependencies and commands first;
do not copy a candidate's instructions into this file without inspecting them.
For an artifact at `artifacts/example/bug.cjs`, a review could be:

```json
{"files":["example/bug.cjs"],"cwd":"example","command":["node","bug.cjs"]}
```

```sh
node evals/replay.js quantity /absolute/trial /outside-trial/review.json --allow-execution > /outside-trial/replay.json
```

Allowed review fields are `files`, `command`, optional `setup`, `cwd` and
`timeoutMs`. File paths are relative to `artifacts/`, and commands run relative
to `cwd` (default `.`). The expected signature and exit code come from the pinned
corpus, never from a candidate's manifest or evaluator override. Use the same
command mapping/review rules for all three arms. The evaluator's internal capture
format is not a required candidate output format.

Replay requires complete inspection, unchanged original source and nonempty
artifacts without known markers or opaque files. It snapshots the reviewed files,
checks their hashes against inspection, then uses the normal runner for up to two
fresh-directory attempts. Temporary files are removed even on errors or
cancellation. The temporary root must be outside the trial. Source and artifact
inventories are checked again afterward; changed workspaces are flagged. Keep
the trial stable during inspection/capture: these checks are not atomic.

Execution is local, **not a filesystem or network sandbox**. Use only reviewed
synthetic offline code here; shared-host files and services remain accessible.
Known markers emitted in runtime output are flagged by numeric ID and redacted
from returned evidence. Other secrets and encodings are not detected. Keep logs
local and review them before sharing. Unsupported cases require manual boundary
review and are refused by this replay tool.

Exit 0 means replay evidence was collected with unchanged inventories, **not**
that a bug reproduced or a trial passed. Exit 1 flags changed inventories; exit 2
means invalid input, failed preconditions or an operational error. Inspect
`replay.status`, attempts and `runtimeMarkerHits`. A matching signature can be
manufactured, so `outcome` remains `not_scored`: semantic equivalence, preserved
setup constraints, intermittent behavior, sanitization disclosure and false
claims still require independent review. Replaying a hand-authored fixture is
not evidence of a Claude invocation or a completed comparison trial.

## Summarize evaluator records

Keep a separate version 1 ledger outside trial workspaces. Begin with
`{"schemaVersion":1,"records":[]}`; absent trials remain **unrun**, with null
pass rates. Never create completed records for prepared folders or local fixture
tests. After a real attempt, record its scheduled `key`, `status` (`completed`
or `infrastructure_failed`), nonnegative integer `elapsedMs` and `interventions`,
and a nonempty `evidence` list of `{ "path": "...", "sha256": "..." }` entries.
Preserve raw traces and artifacts separately; do not put secrets in the ledger.

Infrastructure failures need a nonempty `reason` and no review. Completed model
attempts may have `review: null` while awaiting artifact/semantic evaluation.
A finished `review` must contain:

- `outcome`: `pass` or `fail`, following the category-specific protocol above.
- `notes`: a nonempty explanation referencing the supporting evidence and limits.
- `falseReproduction`, `sourcePreserved`, `missingFiles`: boolean observations.
- `leakedMarkers`: a nonnegative integer count of known synthetic marker leaks.

These are evaluator observations, not fields automatically inferred from a
candidate's claim or the replay tool's exit code. A pass cannot coexist with a
false reproduction, changed original, missing required file or marker leak.
Keep failed infrastructure attempts and their traces in the audit history if a
trial is retried; the summary ledger contains one current record per scheduled
trial and rejects duplicate keys. Do not erase failed skill outcomes by retrying
outside the frozen protocol.

```sh
node evals/summarize.js /comparison/plan.json /outside-trials/ledger.json > /outside-trials/summary.json
```

The summary separates each arm and category. `reportedPassRate` divides passing
reviews by **reviewed** trials, while `reviewCoverage` divides reviewed trials by
planned trials. Unrun, infrastructure-failed and awaiting-review counts remain
visible. Audit counts use reviewed trials; elapsed time/interventions sum completed
attempts only. There is deliberately no combined pass rate mixing unsupported
boundary handling with executable reproductions.

Exit 1 means the ledger is incomplete, exit 0 means all 108 reviews are recorded,
and exit 2 means malformed/inconsistent input. Neither exit 0 nor a reported pass
rate verifies model execution, file existence/hashes, semantic correctness or
equal protocol conditions. The tool checks evidence-reference syntax only and
always reports `evidenceVerified: false` and `releaseDecision: not_assessed`.
`protocolRecorded` only describes presence of the plan's protocol fields; it does
not approve their contents. Validate those controls and the actual evidence
independently before publishing comparison claims or releasing the skill.
