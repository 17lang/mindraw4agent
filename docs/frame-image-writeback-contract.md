# Generated image writeback contract

Revision1,2026-10-24. Plugin0.3.0 development candidate; App integration pending, not published or real-App accepted.

Tool write_mindraw_frame_image({link,imagePath,expectedWorkingRevision,writePlanId}) accepts a full source Frame URL and an explicitly approved local generated PNG. It adds a right-of-source result Frame through App APIs, never overwrites source requirements, handwrites packages, opens/closes documents or generates images. The user must authorize document modification. File inputs must be absolute regular PNG files (not final-component symlinks), no larger than6MiB, validated before any App mutation.

The shared runtime discovery authenticates to IPv4 loopback /rpc. A get_capabilities response must advertise features.productionFrameImageWriteback={version:1,idempotent:true}; this marker is proposed to the App developer and must be confirmed by paired integration. Old2.2.8 exposes similarly named methods with an incompatible production save path and must fail before lease acquisition.

Sequence: capabilities; unique open document state; require active/clean/not-saving and exact expectedWorkingRevision; frame-only context bound to the App-resolved packagePath; acquire bounded lease; commit createAiResultFrame with imageResult bytes and stable intent; verify full save receipt; read post-save state; always attempt lease release. No automatic commit retry. Revision/context changes must also be rejected by App transaction boundaries. Idempotence must be implemented by the App, not inferred from a plugin memory cache.

Success returns document/source/result IDs, resultLink, created image IDs, stable intent, saved=true, revisions, image metadata and warnings. It omits paths, credentials, endpoints, lease IDs and image bytes. Saved receipts prove the App reported persistence; normal reopen and visual comparison are separately tested. A later post-save read failure yields a warning without discarding an already verified receipt. A lost commit response or incomplete receipt yields WRITE_OUTCOME_UNKNOWN, never blind retry or false success. Save errors may leave dirty App state; do not discard it.

Focused mock tests and native stdio discovery do not prove production image-resource adoption, real save, reopen, crash recovery or undo. Test self-owned copies first. App version is owned by the designated App developer; no App source/version is changed by this plugin branch.

App handoff confirmed:2.2.9 source587eff3, features marker and existing receipt fields match this contract. Once commit starts, an error is not proof of no scene mutation: a failed save may retain a dirty result. Preserve it and inspect before any retry. Only the designated App developer changes App source/version.
