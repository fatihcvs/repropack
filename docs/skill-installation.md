# Try the development skill

This is a development checkout, not a published npm release. Keep the complete
ReproPack checkout: the skill uses its CLI and Windows supervisor. Copying only
SKILL.md is insufficient. Requires Node 22+ and Claude Code.

1. Verify `node /absolute/repropack/src/cli.js --help` works.
2. Copy `skills/reproduce-bug/` from this checkout into your target project's
   `.claude/skills/reproduce-bug/`. Preserve its `references/` directory. Do not
   overwrite an existing skill without reviewing it first.
3. In a Claude Code session in that project, give the CLI's absolute path and ask:

   > /reproduce-bug Package the failing Node test into a minimal runnable example.
   > The ReproPack CLI is at /absolute/repropack/src/cli.js. You may execute this
   > project's reviewed local example. Leave the original source unchanged and
   > keep all artifacts local.

Automatic selection can also be tried by requesting a shareable Node bug
reproduction without the slash command. Test both before claiming reliable
triggering. Project skill discovery follows the
[official Claude Code documentation](https://code.claude.com/docs/en/skills).

For an offline demo, use `fixtures/assertion/bug.cjs`: it should account for item
quantity, but the included assertion fails with `TOTAL_IGNORES_QUANTITY` and exit
code 1. Select only bug.cjs, command `["node", "bug.cjs"]`, no setup. Put the
package outside that fixture directory. Run twice through the CLI and render the
saved JSON. This proves the local CLI workflow, not that Claude selected or
followed the skill correctly.

The skill has no embedded credentials, network uploads or automatic publishing.
Actual Claude behavior and comparative evaluation remain separate release gates.
