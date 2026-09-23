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
