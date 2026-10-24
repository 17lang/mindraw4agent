# M4C Frame reader release notes

Revision 4, 2026-10-24. Version0.2.0, prerelease with limited platform coverage.

## Distribution

Independent MIT source repository: https://github.com/17lang/mindraw4agent. Node.js>=20, no external runtime packages. This release contains source, portable installation scripts, two skills, interface contract and handbooks. It excludes companion App binaries, private documents/screenshots, credentials, local evidence and caches. Mindraw App licensing/distribution remain separate.

## Verified

- Mindraw2.2.8 / Build202610240635, runtime source669f243, delivery record90ae265, macOS Apple Silicon.
- Owner used normal App Save As to create an independent document identity. A fresh native Codex Agent actually called read_mindraw_frame for both supplied Frame links. Both returned text+image, frame-only, dirty=false, warnings empty; the Agent accurately described screenshots, red outlines, arrows and annotation relationships. Existing-chat tool inventory refresh is not claimed.
- Two scoped API PNGs and matching revisions were also checked separately. Duplicate identities were correctly rejected before normal Save As; non-Frame and unopened-document rejection were verified in prior integration evidence.
- Eight focused tests pass, including missing revision evidence, truncated images and strict newline-delimited stdio. Independent review identified twoP2 gaps; a second independent static review confirmed the fixes with no new P1/P2 in the limited correction scope.
- Fresh Codex app-server discovers all four tools without toolsError. Local uninstall/reinstall, repeat installation, path with spaces,0.1.4-to-0.2.0 upgrade and direct MCP registration/removal were exercised. Installed cache matches source.

## Limits

In-Frame unsaved edit and real missing-image failure scenarios have unit coverage but incomplete real-App acceptance. Other platforms/machines remain untested. Canvas-exported PNGs are controlled scene snapshots, not OS screenshots; supported PNG encoding and budgets are defined in the contract. Do not treat a refused or text-only result as full visual success. Do not close/save unknown user drafts for QA.

## Installation and rollback

Use README-zh.md or README.md at the selected release. Choose plugin mode or direct MCP mode, not both. Keep the source folder available, start a new Codex session, and verify the actual tool. Reinstall a prior fixed release to roll back integration; do not rewrite/delete document packages. Installation never installs/quits/replaces Mindraw. Historical App2.3.0 trial packages are not distributed.

## Publication identity

Publish the reviewed source to release/frame-reader-0.2.0, create unused tagv0.2.0 and a prerelease with source archive and SHA256. Re-read remote commit, download assets and compare source trees. Main remains unchanged during candidate distribution. Owner authorized publication; authorization and installation174660950 are verified by actual GitHub writes. Publication completion must be recorded separately from this prepared release note.
