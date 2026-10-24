# Release candidate — M4C Frame reader

Revision 3, 2026-10-24. 0.2.0 PRERELEASE / OVERALL ACCEPTANCE INCOMPLETE.

## Artifacts and licensing

Independent MIT source repository: https://github.com/17lang/mindraw4agent. Node.js>=20, no external runtime packages. Publish source, installation scripts, both skills, contract and handbooks; exclude App binaries, private documents/images, credentials, local evidence and caches. Companion App licensing and public distribution are separate.

## Evidence and remaining limits

- Paired scoped API checks: Mindraw 2.2.8 / Build202610240635, runtime source669f243, delivery record90ae265. Two original Frame copies returned full PNGs and matching revisions; screenshots and annotations were visually inspected privately.
- Native Agent actually invoked read_mindraw_frame; duplicate open identities correctly returned APP_DOCUMENT_AMBIGUOUS. Successful Agent image consumption, in-Frame dirty edits and real missing-image rejection remain unaccepted. Preserve unknown unsaved user windows.
- Eight focused tests pass, including missing revisions, truncated image and strict newline-delimited stdio checks. Independent review found two P2 issues; both were confirmed fixed by a second independent static review on319ec99, with no new P1/P2 found in the limited correction scope. Source patterns were inspected for private content; this is not a formal security audit.
- Fresh Codex app-server discovered all four tools without toolsError. Local uninstall/reinstall, repeat installation, portable path with spaces, 0.1.4 upgrade and direct MCP registration/removal were exercised. Different machines and other platforms remain untested.

## Publication and recovery

Owner authorized installation and GitHub publication. Publish v0.2.0 as a clearly labelled prerelease with the above limitations; never claim overall acceptance. Fetch before pushing; require public main to remain an ancestor. Push reviewed source without force, create the unused tag, then create a prerelease and attach the source archive and checksum. Re-read remote commit and download/unpack published assets before reporting completion. If main advances or tag exists, reconcile rather than overwrite.

Keep the prior plugin tag/archive and companion App. Reinstall the desired plugin version; do not rewrite/delete document packages. Plugin installation never installs/quits/replaces Mindraw. Historical experimental App2.3.0 and pending2.2.6 are superseded by the actual2.2.8 evidence and must not be distributed as current App releases.

Current distribution channel: publish reviewed source snapshot to release/frame-reader-0.2.0 through the authorized GitHub connector. Main is preserved until release coordination. The connector has no tag/Release creation operation and local Git credentials are unavailable; creation of v0.2.0 prerelease and attached assets remains explicitly incomplete until an authenticated release channel is available. Clone instructions use the actual candidate branch rather than an unavailable tag.

Publication attempt result: GitHub create-tree and create-branch both returned HTTP403 Resource not accessible by integration. No public branch, tag, Release or source upload was created. Repository account permission metadata does not prove connector write authorization. A write-enabled repository connection or authenticated local release channel is required; no repeated general approval is needed.

Authorization recovery: Owner completed organization installation174660950. The GitHub connector now lists the target repository and successfully created release/frame-reader-0.2.0. The previous403 is resolved. Candidate source publication may proceed; tag/Release status and final native image acceptance remain separate.
