# Contributing

Thank you for considering a contribution to `mindraw4agent`.

## Development Setup

```bash
npm run check
npm run smoke
npm run smoke:http
npm run smoke:lifecycle
npm run smoke:mcp
```

Optional sidebar smoke requires Playwright:

```bash
PLAYWRIGHT_NODE_MODULES=/path/to/node_modules npm run smoke:sidebar
```

## Boundaries

- Keep changes scoped to the Codex plugin, skill, MCP server, sidebar preview service, and repository docs.
- Do not add Mindraw App source code to this repository.
- Do not commit DMG files, private QA evidence, local paths, credentials, runtime capability files, or project-specific canvas content.
- Do not handwrite `.mindraw` package internals. Use Mindraw App APIs where required.
- Keep macOS Apple Silicon as the first public support target unless compatibility is explicitly expanded.

## Pull Request Checklist

- `npm run check` passes.
- Relevant smoke commands pass or skipped items are explained.
- Public docs stay repository-relative.
- No local home-directory absolute paths, private remotes, credentials, internal planning records, or private evidence paths are introduced.
- Skill or MCP behavior changes include SkillSpector `--no-llm` evidence.
