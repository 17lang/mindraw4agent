import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { validateCanvasPng } from './png-integrity.mjs';

const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
export function parseFrameLink(link) {
  if (typeof link !== 'string' || link.length > 4096) fail('INVALID_FRAME_LINK', 'Provide one complete Mindraw Frame link.');
  let url;
  try { url = new URL(link.trim().replaceAll('&amp;', '&')); } catch { fail('INVALID_FRAME_LINK', 'Invalid Mindraw Frame link.'); }
  if (url.protocol !== 'mindraw:' || url.hostname !== 'localhost' || url.port || url.username || url.password || !['', '/'].includes(url.pathname) || url.hash) fail('INVALID_FRAME_LINK', 'Expected a mindraw://localhost Frame link.');
  for (const key of ['documentId', 'elementId']) if (url.searchParams.getAll(key).length !== 1 || !url.searchParams.get(key)?.trim()) fail('INVALID_FRAME_LINK', `Exactly one ${key} is required.`);
  if ([...url.searchParams.keys()].some(k => !['documentId', 'elementId', 'packageFormat'].includes(k)) || url.searchParams.getAll('packageFormat').length > 1) fail('INVALID_FRAME_LINK', 'Unsupported or duplicate link fields.');
  const format = url.searchParams.get('packageFormat');
  if (format && !['legacy', 'production'].includes(format)) fail('INVALID_FRAME_LINK', 'Unsupported package format.');
  return { documentId: url.searchParams.get('documentId'), sourceFrameId: url.searchParams.get('elementId') };
}

async function runtime() {
  let c;
  try { c = JSON.parse(await readFile(process.env.MINDRAW_RUNTIME_CAPABILITY_PATH || join(homedir(), 'Library/Application Support/com.mindraw.desktop/runtime/write-api.json'), 'utf8')); } catch { fail('MINDRAW_NOT_RUNNING', 'Open Mindraw and the linked document, then retry.'); }
  let endpoint;
  try { endpoint = new URL(c.endpoint); } catch { fail('INVALID_APP_CAPABILITY', 'Mindraw runtime discovery is invalid.'); }
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || !endpoint.port || endpoint.pathname !== '/rpc' || endpoint.search || endpoint.hash || endpoint.username || endpoint.password || typeof c.token !== 'string' || c.token.length < 16) fail('INVALID_APP_CAPABILITY', 'Mindraw runtime discovery is invalid.');
  for (const method of ['get_live_frame_context', 'get_target_frame_pixel_payload']) if (!c.methods?.includes(`mindraw.app.${method}`)) fail('APP_UPDATE_REQUIRED', 'This Mindraw App does not expose Frame reading.');
  return c;
}
async function rpc(c, method, params) {
  let response;
  try { response = await fetch(c.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: `mindraw.app.${method}`, params }), signal: AbortSignal.timeout(20000) }); } catch { fail('APP_UNAVAILABLE', 'Mindraw did not respond. Open the App and retry.'); }
  if (!response.ok) fail('APP_UNAVAILABLE', 'Mindraw rejected the read request.');
  const declared = Number(response.headers.get('content-length'));
  if (declared > 96 * 1024 * 1024) fail('FRAME_TOO_LARGE', 'Frame response exceeds the read budget.');
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  try { while (true) { const {done, value} = await reader.read(); if (done) break; size += value.length; if (size > 96 * 1024 * 1024) { await reader.cancel(); fail('FRAME_TOO_LARGE', 'Frame response exceeds the read budget.'); } chunks.push(Buffer.from(value)); } } finally { reader.releaseLock(); }
  let wire; try { wire = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail('INVALID_APP_RESPONSE', 'Mindraw returned an invalid response.'); }
  if (wire.error || wire.result?.ok !== true) {
    const code = wire.result?.error?.code || wire.error?.code;
    const known = ['APP_DOCUMENT_NOT_OPEN','APP_DOCUMENT_AMBIGUOUS','ACTIVE_EDITOR_UNAVAILABLE','TARGET_NOT_FRAME','TARGET_NOT_FOUND','FRAME_IMAGE_UNAVAILABLE','TARGET_FRAME_PIXEL_PAYLOAD_REQUIRED'];
    fail(known.includes(code) ? code : 'APP_READ_FAILED', known.includes(code) ? `Mindraw read blocked: ${code}.` : 'Mindraw could not read this Frame.');
  }
  return wire.result;
}
export async function readFrameLink(link) {
  const started = performance.now(); const selector = parseFrameLink(link); const c = await runtime();
  const context = await rpc(c, 'get_live_frame_context', { ...selector, includeFiles: true });
  if (context.documentId !== selector.documentId || context.sourceFrameId !== selector.sourceFrameId || context.readScope !== 'frame-only' || context.target?.kind !== 'frame' || context.target.elementId !== selector.sourceFrameId || context.scopeAudit?.outsideTextIncluded !== false || context.visualScopeAudit?.outsideImagesExcluded !== true || context.visualScopeAudit?.outsideFramePixelsExcluded !== true || context.visualScopeAudit?.documentVisualFallbackUsed !== false || !Array.isArray(context.elements)) fail('FRAME_SCOPE_UNPROVEN', 'The App did not prove target-only scope.');
  for (const element of context.elements) if (element.type === 'image' && (typeof context.files?.[element.fileId]?.dataURL !== 'string' || !context.files[element.fileId].dataURL.startsWith('data:image/'))) fail('APP_RESOURCE_ADAPTER_REQUIRED', 'The App returned unresolved Frame images. Update Mindraw; do not scan package files.');
  const revisionFields = [context.contextRevision, context.workingRevision, context.visualContext?.snapshot?.hash];
  if (revisionFields.some(value => typeof value !== 'string' || !value.trim())) fail('FRAME_CHANGED_OR_SCOPE_UNPROVEN', 'Mindraw did not provide complete revision evidence.');
  const pixel = await rpc(c, 'get_target_frame_pixel_payload', selector); const payload = pixel.payload; const audit = pixel.pixelScopeAudit;
  if (pixel.documentId !== selector.documentId || pixel.sourceFrameId !== selector.sourceFrameId || pixel.readScope !== 'frame-only' || audit?.targetFrameOnly !== true || audit.outsideTextIncluded !== false || audit.outsidePixelsIncluded !== false || audit.outsideImagesIncluded !== false || audit.documentVisualFallbackUsed !== false || audit.sourceSnapshotHash !== context.visualContext?.snapshot?.hash || pixel.contextRevision !== context.contextRevision || pixel.workingRevision !== context.workingRevision) fail('FRAME_CHANGED_OR_SCOPE_UNPROVEN', 'Frame content changed during reading or scope is unproven. Retry the read.');
  if (payload?.mimeType !== 'image/png' || payload.pixelsIncluded !== true || payload.bytesIncluded !== true || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(payload.dataURL || '')) fail('INVALID_FRAME_IMAGE', 'Mindraw did not return a complete PNG.');
  const data = payload.dataURL.split(',')[1]; const bytes = Buffer.from(data, 'base64');
  if (bytes.length > 32 * 1024 * 1024 || bytes.length < 24 || bytes.length !== payload.byteLength || !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || bytes.readUInt32BE(16) !== payload.width || bytes.readUInt32BE(20) !== payload.height || `sha256:${createHash('sha256').update(bytes).digest('hex')}` !== payload.sha256) fail('INVALID_FRAME_IMAGE', 'Frame PNG integrity verification failed.');
  try { validateCanvasPng(bytes, payload.width, payload.height); } catch { fail('INVALID_FRAME_IMAGE', 'Frame PNG structure or decoded pixels are invalid.'); }
  const result = { ok: true, documentId: selector.documentId, readScope: 'frame-only', target: context.target, workingRevision: context.workingRevision, contextRevision: context.contextRevision, isDirty: context.isDirty, elements: context.elements, warnings: context.scopeWarnings || [], image: { mimeType: payload.mimeType, width: payload.width, height: payload.height, byteLength: payload.byteLength, sha256: payload.sha256 }, durationMs: Math.round(performance.now() - started) };
  return { content: [{ type: 'text', text: JSON.stringify(result) }, { type: 'image', mimeType: 'image/png', data }], isError: false };
}
