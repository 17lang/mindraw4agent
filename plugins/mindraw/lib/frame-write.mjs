import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { parseFrameLink, runtime, rpc } from './frame-read.mjs';
import { validateCanvasPng } from './png-integrity.mjs';

const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const actor = Object.freeze({ id: 'mindraw4agent' });
const maxImageBytes = 6 * 1024 * 1024;
async function loadImage(imagePath) {
  if (typeof imagePath !== 'string' || !isAbsolute(imagePath) || imagePath.includes('\0')) fail('INVALID_IMAGE_INPUT', 'Provide the absolute path of the generated PNG.');
  let file;
  try {
    file = await open(imagePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await file.stat();
    if (!stat.isFile() || stat.size < 57 || stat.size > maxImageBytes) fail('INVALID_IMAGE_INPUT', 'Generated PNG must be a regular file no larger than 6 MiB.');
    const buffer = Buffer.alloc(stat.size + 1);
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await file.read(buffer, total, buffer.length - total, total);
      if (!bytesRead) break;
      total += bytesRead;
    }
    const bytes = buffer.subarray(0, total);
    if (bytes.length !== stat.size || bytes.length > maxImageBytes || !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) fail('INVALID_IMAGE_INPUT', 'PNG bytes changed or are invalid.');
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    validateCanvasPng(bytes, width, height);
    return { kind: 'external-image-result', mimeType: 'image/png', dataURL: `data:image/png;base64,${bytes.toString('base64')}`, width, height, byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  } catch (error) {
    if (error.code === 'INVALID_IMAGE_INPUT') throw error;
    fail('INVALID_IMAGE_INPUT', 'The generated PNG could not be safely read or decoded.');
  } finally { await file?.close(); }
}

// No retry loop: a lost commit response may mean the image was already saved.
export async function writeFrameImage(input = {}) {
  const selector = parseFrameLink(input.link);
  if (typeof input.expectedWorkingRevision !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(input.expectedWorkingRevision)) fail('INVALID_WRITE_INPUT', 'Use the workingRevision returned when reading the source Frame.');
  if (typeof input.writePlanId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(input.writePlanId)) fail('INVALID_WRITE_INPUT', 'Provide a stable unique writePlanId; reuse it only for the same write intent.');
  const imageResult = await loadImage(input.imagePath);
  const c = await runtime();
  for (const name of ['get_capabilities','get_open_document_state','acquire_write_lease','commit_write_result','release_write_lease']) if (!c.methods?.includes(`mindraw.app.${name}`)) fail('APP_WRITEBACK_UPDATE_REQUIRED', 'The App does not expose the required controlled writeback methods.');
  const capabilities = await rpc(c, 'get_capabilities', {});
  const feature = capabilities.features?.productionFrameImageWriteback;
  if (feature?.version !== 1 || feature.idempotent !== true) fail('APP_WRITEBACK_UPDATE_REQUIRED', 'Use the paired App with verified production image writeback; legacy write APIs are insufficient.');
  const state = await rpc(c, 'get_open_document_state', { documentId: selector.documentId });
  if (state.documentId !== selector.documentId || state.isOpen !== true || typeof state.packagePath !== 'string' || !isAbsolute(state.packagePath)) fail('WRITE_SCOPE_UNPROVEN', 'The App did not prove the open target document.');
  if (state.isActive !== true) fail('DOCUMENT_NOT_ACTIVE', 'The source document must already be active; no tab was switched.');
  if (state.isDirty !== false || state.isSaving !== false) fail('DOCUMENT_NOT_CLEAN', 'Save the intended test document yourself before writing; existing drafts are preserved.');
  if (state.workingRevision !== input.expectedWorkingRevision) fail('WORKING_REVISION_MISMATCH', 'The document changed after the source Frame was read. Read it again before creating a new intent.');
  const bound = { ...selector, packagePath: state.packagePath };
  const context = await rpc(c, 'get_live_frame_context', { ...bound, includeFiles: false });
  if (context.documentId !== selector.documentId || context.sourceFrameId !== selector.sourceFrameId || context.target?.kind !== 'frame' || context.target.elementId !== selector.sourceFrameId || context.readScope !== 'frame-only' || context.isDirty !== false || context.workingRevision !== input.expectedWorkingRevision || !Array.isArray(context.elements) || context.scopeAudit?.outsideTextIncluded !== false) fail('WRITE_SCOPE_UNPROVEN', 'The App could not prove an unchanged source Frame.');
  const prompt = context.elements.filter(e => e.type === 'text' && typeof e.text === 'string').map(e => e.text).join('\n').slice(0,16000) || 'Generated image for the selected Frame.';
  const base = { ...bound, actor, writePlanId: input.writePlanId, expectedWorkingRevision: input.expectedWorkingRevision };
  let lease, committing = false;
  const warnings = [];
  try {
    lease = await rpc(c, 'acquire_write_lease', { ...base, mutationKind: 'createAiResultFrame', ttlMs: 30000 });
    if (lease.documentId !== selector.documentId || lease.sourceFrameId !== selector.sourceFrameId || lease.packagePath !== state.packagePath || lease.actor?.id !== actor.id || lease.writePlanId !== input.writePlanId || lease.expectedWorkingRevision !== input.expectedWorkingRevision || typeof lease.leaseId !== 'string' || !lease.leaseId.startsWith('lease_')) fail('WRITE_SCOPE_UNPROVEN', 'The App returned an unbound write lease.');
    committing = true;
    const result = await rpc(c, 'commit_write_result', { ...base, leaseId: lease.leaseId, mutation: { kind: 'createAiResultFrame', jobId: input.writePlanId, title: 'AI image result', status: 'completed', promptSummary: prompt.slice(0,300), promptFullText: prompt, resultText: 'Generated image attached. Source Frame preserved.', layout: { strategy: 'right-of-source-frame' }, imageResult } });
    if (result.documentId !== selector.documentId || result.sourceFrameId !== selector.sourceFrameId || result.saved !== true || !result.resultFrameId || result.resultFrameId === selector.sourceFrameId || !Array.isArray(result.createdFileIds) || !result.createdFileIds.length || result.revisionBefore !== input.expectedWorkingRevision || !/^sha256:[a-f0-9]{64}$/.test(result.revisionAfter || '')) fail('WRITE_OUTCOME_UNKNOWN', 'The App did not provide a complete save receipt. Inspect the document before retrying.');
    try {
      const after = await rpc(c, 'get_open_document_state', { documentId: selector.documentId, packagePath: state.packagePath });
      if (after.isDirty !== false || after.isSaving !== false || after.workingRevision !== result.revisionAfter) warnings.push('POST_SAVE_STATE_CHANGED_OR_UNCONFIRMED');
    } catch { warnings.push('POST_SAVE_STATE_CHANGED_OR_UNCONFIRMED'); }
    return { ok: true, documentId: selector.documentId, sourceFrameId: selector.sourceFrameId, resultFrameId: result.resultFrameId, createdFileIds: result.createdFileIds, resultLink: `mindraw://localhost?documentId=${encodeURIComponent(selector.documentId)}&elementId=${encodeURIComponent(result.resultFrameId)}&packageFormat=production`, writePlanId: input.writePlanId, saved: true, revisionBefore: result.revisionBefore, revisionAfter: result.revisionAfter, image: { mimeType: imageResult.mimeType, width: imageResult.width, height: imageResult.height, byteLength: imageResult.byteLength, sha256: `sha256:${imageResult.sha256}` }, warnings };
  } catch (error) {
    const definiteRejections = ['WORKING_REVISION_MISMATCH','SAVE_FAILED','SOURCE_PRESERVATION_FAILED','MUTATION_SCHEMA_INVALID','WRITE_LEASE_CONFLICT','WRITE_LEASE_EXPIRED','WRITE_LEASE_NOT_FOUND','DOCUMENT_IS_DIRTY','DOCUMENT_IS_SAVING','LEASE_ACTOR_MISMATCH','LEASE_ALREADY_HELD','LEASE_EXPIRED','LEASE_NOT_FOUND','MUTATION_NOT_ALLOWED','WRITE_PLAN_MISMATCH'];
    if (committing && error.code !== 'WRITE_OUTCOME_UNKNOWN' && !definiteRejections.includes(error.code)) fail('WRITE_OUTCOME_UNKNOWN', 'Commit outcome is unknown. Inspect the document and keep the same writePlanId; never retry with a new ID automatically.');
    throw error;
  } finally {
    if (lease?.leaseId) {
      try { await rpc(c, 'release_write_lease', { leaseId: lease.leaseId, documentId: selector.documentId, actor, writePlanId: input.writePlanId }); }
      catch { warnings.push('LEASE_RELEASE_UNCONFIRMED'); }
    }
  }
}
