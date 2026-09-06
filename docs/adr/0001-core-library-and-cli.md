# Keep worktree rules in a core library and make the CLI an adapter

`git-wt` exposes one typed core library as the source of truth for discovery, validation, planning, and mutation; the human CLI only parses input, asks questions, and renders results. This costs more structure than command functions calling Git directly, but it gives programmatic callers and CLI users the same safety rules and prevents output formatting from becoming part of repository logic.
