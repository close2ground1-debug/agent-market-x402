import test from 'node:test';
import assert from 'node:assert/strict';
import {eligibleLicense,domainStatus,scout,reportMarkdown} from './digital-asset-scout.js';
test('rights evidence required; unknown or restrictive licenses not promoted',()=>{
 assert.equal(eligibleLicense({license:{spdx_id:'MIT'},content:'bGljZW5zZQ==',encoding:'base64'}),true);
 assert.equal(eligibleLicense({license:{spdx_id:'NOASSERTION'},content:'bGljZW5zZQ==',encoding:'base64'}),false);
 assert.equal(eligibleLicense({license:{spdx_id:'MIT'}}),false);
 assert.match(domainStatus(404),/unverified/);
 assert.match(domainStatus(200),/Registered; skip/);
});
test('exact order retained, concrete access steps and failed sources reported',async()=>{
 const saved=globalThis.fetch;globalThis.fetch=async()=>({status:404});
 const mission='Exact user order unchanged.';
 try{
 const r=await scout(mission,{clock:new Date('2026-10-13T18:00:00Z'),request:async(url,gh)=>{
 if(gh&&url.includes('/search/'))return {items:[{full_name:'example/project',html_url:'https://github.com/example/project',description:'Document tool'}]};
 if(gh)return {license:{spdx_id:'MIT'},content:'TUlUIExpY2Vuc2U=',encoding:'base64',html_url:'https://github.com/example/project/blob/main/LICENSE'};
 return 'CC0 CC BY-SA 3.0';
 }});
 assert.equal(r.mission,mission);assert.equal(r.findings.length,1);assert.equal(r.receivedUsd,0);
 assert.ok(r.findings.every(x=>x.access&&x.rightsEvidence));assert.match(reportMarkdown(r),/Exact user order unchanged/);
 assert.deepEqual(r.domains,[]);
 }finally{globalThis.fetch=saved;}
});

test('no seeded assets, catalog lookups or fixed domain checks',async()=>{
 const saved=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Unexpected fixed-domain request')};
 const calls=[];
 try{
 const r=await scout('Exact order',{request:async(url)=>{calls.push(url);return {items:[]}}});
 assert.deepEqual(r.findings,[]);
 assert.deepEqual(r.domains,[]);
 assert.equal(calls.length,1);
 assert.match(calls[0],/^https:\/\/api\.github\.com\/search\/repositories\?/);
 }finally{globalThis.fetch=saved}
});
