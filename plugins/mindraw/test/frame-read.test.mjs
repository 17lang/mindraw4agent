import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseFrameLink, readFrameLink } from '../lib/frame-read.mjs';
const link = 'mindraw://localhost?documentId=board&elementId=frame&packageFormat=production';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64');
const dataURL = `data:image/png;base64,${png.toString('base64')}`;
const context = () => ({ ok: true, documentId: 'board', sourceFrameId: 'frame', target: {kind:'frame',elementId:'frame'}, readScope:'frame-only', workingRevision:'sha256:live', contextRevision:'sha256:context', isDirty:true, elements:[{id:'inside',type:'text',text:'用户未保存标注'},{id:'picture',type:'image',fileId:'img'}],files:{img:{dataURL}},scopeAudit:{outsideTextIncluded:false},visualScopeAudit:{outsideImagesExcluded:true,outsideFramePixelsExcluded:true,documentVisualFallbackUsed:false},visualContext:{snapshot:{hash:'sha256:visual'}} });
const pixel = () => ({ok:true,documentId:'board',sourceFrameId:'frame',readScope:'frame-only',contextRevision:'sha256:context',workingRevision:'sha256:live',pixelScopeAudit:{targetFrameOnly:true,outsideTextIncluded:false,outsidePixelsIncluded:false,outsideImagesIncluded:false,documentVisualFallbackUsed:false,sourceSnapshotHash:'sha256:visual'},payload:{mimeType:'image/png',pixelsIncluded:true,bytesIncluded:true,dataURL,width:1,height:1,byteLength:png.length,sha256:`sha256:${createHash('sha256').update(png).digest('hex')}`}});
async function fixture(run) {
 const root = await mkdtemp(join(tmpdir(),'m4c-frame-read-')); const calls=[]; let resultContext=context(),resultPixel=pixel();
 const server=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const q=JSON.parse(raw);calls.push(q);assert.equal(req.headers.authorization,'Bearer fixture-secret-token');res.setHeader('content-type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:q.id,result:q.method.endsWith('get_live_frame_context')?resultContext:resultPixel}));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); const capability=join(root,'runtime.json');
 await writeFile(capability,JSON.stringify({endpoint:`http://127.0.0.1:${server.address().port}/rpc`,token:'fixture-secret-token',methods:['mindraw.app.get_live_frame_context','mindraw.app.get_target_frame_pixel_payload']}));const old=process.env.MINDRAW_RUNTIME_CAPABILITY_PATH;process.env.MINDRAW_RUNTIME_CAPABILITY_PATH=capability;
 try { await run({calls,capability,setContext:v=>resultContext=v,setPixel:v=>resultPixel=v}); } finally { if(old===undefined) delete process.env.MINDRAW_RUNTIME_CAPABILITY_PATH;else process.env.MINDRAW_RUNTIME_CAPABILITY_PATH=old;await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true}); }
}
test('strict link parser supports copied HTML separators and rejects ambiguous fields',()=>{
 assert.deepEqual(parseFrameLink(link.replaceAll('&','&amp;')),{documentId:'board',sourceFrameId:'frame'});
 for(const bad of ['https://localhost?documentId=a&elementId=b',link+'&elementId=other',link+'&packageFormat=legacy',link+'&path=/secret',link.replace('localhost','remote'),link.replace('production','future')])assert.throws(()=>parseFrameLink(bad),{code:'INVALID_FRAME_LINK'});
});
test('real stdio MCP lists and invokes read-only Frame tool with image content',()=>fixture(async({capability,calls})=>{
 const child=spawn(process.execPath,[fileURLToPath(new URL('../mcp/server.mjs', import.meta.url))],{env:{...process.env,MINDRAW_RUNTIME_CAPABILITY_PATH:capability},stdio:['pipe','pipe','pipe']});let out='',err='';child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>err+=c);const timer=setTimeout(()=>child.kill(),10000);
 const messages=[{jsonrpc:'2.0',id:1,method:'initialize'},{jsonrpc:'2.0',id:2,method:'tools/list'},{jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'read_mindraw_frame',arguments:{link}}}];child.stdin.end(messages.map(q=>JSON.stringify(q)).join('\n')+'\n');
 const code=await new Promise(resolve=>child.once('close',resolve));clearTimeout(timer);assert.equal(code,0,err);const responses=out.trim().split(/\r?\n/).map(line=>JSON.parse(line));assert.equal(responses.length,3,'stdio must emit exactly one JSON object per line');assert(responses[1].result.tools.some(t=>t.name==='read_mindraw_frame'&&t.annotations.readOnlyHint));const result=responses[2].result;assert.equal(result.isError,false);assert.equal(result.content[1].type,'image');assert.equal(result.content[1].data,png.toString('base64'));const text=JSON.parse(result.content[0].text);assert.equal(text.isDirty,true);assert.equal(text.elements[0].text,'用户未保存标注');assert(!out.includes('fixture-secret-token'));assert(!out.includes(capability));assert.equal(calls.length,2);assert(calls.every(q=>['mindraw.app.get_live_frame_context','mindraw.app.get_target_frame_pixel_payload'].includes(q.method)));
}));
test('old App unresolved references fail before PNG request',()=>fixture(async({setContext,calls})=>{const c=context();c.files.img={reference:{sha256:'old'}};setContext(c);await assert.rejects(readFrameLink(link),{code:'APP_RESOURCE_ADAPTER_REQUIRED'});assert.equal(calls.length,1);}));
test('outside-scope and changed-snapshot results are rejected',()=>fixture(async({setContext,setPixel})=>{const c=context();c.scopeAudit.outsideTextIncluded=true;setContext(c);await assert.rejects(readFrameLink(link),{code:'FRAME_SCOPE_UNPROVEN'});setContext(context());const p=pixel();p.pixelScopeAudit.sourceSnapshotHash='sha256:changed';setPixel(p);await assert.rejects(readFrameLink(link),{code:'FRAME_CHANGED_OR_SCOPE_UNPROVEN'});}));
test('non-Frame, unopened document and missing images preserve actionable errors',()=>fixture(async({setContext})=>{for(const code of ['TARGET_NOT_FRAME','APP_DOCUMENT_NOT_OPEN','FRAME_IMAGE_UNAVAILABLE']){setContext({ok:false,error:{code,message:'private-path'}});await assert.rejects(readFrameLink(link),e=>e.code===code&&!e.message.includes('private-path'));}}));
test('corrupt pixel bytes fail integrity verification',()=>fixture(async({setPixel})=>{const p=pixel();p.payload.sha256='sha256:bad';setPixel(p);await assert.rejects(readFrameLink(link),{code:'INVALID_FRAME_IMAGE'});}));

test('missing revision evidence never counts as a matching snapshot',()=>fixture(async({setContext,setPixel})=>{for(const key of ['contextRevision','workingRevision']){const c=context(),p=pixel();delete c[key];delete p[key];setContext(c);setPixel(p);await assert.rejects(readFrameLink(link),{code:'FRAME_CHANGED_OR_SCOPE_UNPROVEN'});}const c=context(),p=pixel();c.visualContext.snapshot.hash='';p.pixelScopeAudit.sourceSnapshotHash='';setContext(c);setPixel(p);await assert.rejects(readFrameLink(link),{code:'FRAME_CHANGED_OR_SCOPE_UNPROVEN'});}));
test('truncated PNG with matching hash and dimensions is rejected',()=>fixture(async({setPixel})=>{for(const bytes of [png.subarray(0,24),png.subarray(0,png.length-12)]){const p=pixel();p.payload.dataURL='data:image/png;base64,'+bytes.toString('base64');p.payload.byteLength=bytes.length;p.payload.sha256='sha256:'+createHash('sha256').update(bytes).digest('hex');setPixel(p);await assert.rejects(readFrameLink(link),{code:'INVALID_FRAME_IMAGE'});}}));
