# Security Policy

## Supported Versions

The first public source candidate supports `mindraw4agent` `0.1.3` with Mindraw App `>= 1.2.4` on macOS Apple Silicon.

## Reporting A Vulnerability

Please report security issues through GitHub private vulnerability reporting for `17lang/mindraw4agent` if it is enabled. If private reporting is not available, open a GitHub issue with a minimal description and do not include credentials, local tokens, private documents, or sensitive project files.

## Scope

This repository covers the Codex plugin, skill, MCP server, local sidebar preview service, and helper scripts in `mindraw4agent`.

Mindraw App binaries, DMG distribution, product branding, and any private backend or signing infrastructure are outside this repository and use separate handling.

## Local Data Boundary

The plugin is designed to work with the active project workspace and `MindrawCanvas/`. It must not handwrite `.mindraw` package internals, expose runtime bearer tokens, or reuse a sidebar service from another project context.
