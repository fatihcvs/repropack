# Security boundaries and reporting

This repository is a development preview with no stable release yet. Only the
current development branch is maintained. Do not use ReproPack to execute hostile
code: it is not a sandbox. Targets can access the filesystem, network and other
resources with your permissions. npm installation and package scripts can also
execute code. Inspect commands and files before enabling execution.

The runner omits arbitrary inherited environment variables from the target, but
that does not prevent code from reading credentials available elsewhere on the
machine. Windows helpers use their host environment to initialize and pass a
separate filtered block to the target. Linux namespaces provide process cleanup,
not network or filesystem isolation. External brokers can escape the supervised
process tree. A forcibly terminated owner can leave temporary files.

Capture and verification need a stable trusted directory. They do not provide
an atomic snapshot or defend against a hostile process replacing filesystem
entries. SHA-256 checks detect changes relative to the manifest; they do not
authenticate its author. An attacker who changes both can replace the package.
Only the selected inventory inside `project/` is verified.

Common credential filenames are excluded, but source code and output can still
contain secrets or personal data. Literal report-path masking is not general
redaction. Review every artifact before sharing; no automatic upload is provided.

For a suspected vulnerability, use GitHub's private vulnerability reporting on
the repository Security tab **if that option is available**. Do not publish
credentials, private artifacts or a working exploit in a public issue. If private
reporting is unavailable, open a minimal issue asking for a private contact
channel, without sensitive details. No private email address or response SLA is
currently promised.

Useful reports identify the affected commit, OS/Node versions, the expected
boundary, and a minimal synthetic reproduction. Distinguish an actual boundary
violation from capabilities that this tool explicitly does not restrict.
