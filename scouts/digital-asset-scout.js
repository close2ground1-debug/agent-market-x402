import {writeFile} from 'node:fs/promises';
const allowed=new Set(['MIT','Apache-2.0','BSD-2-Clause','BSD-3-Clause','ISC','0BSD','Unlicense','CC0-1.0','Zlib']);
export function eligibleLicense(x){return Boolean(x?.license?.spdx_id&&allowed.has(x.license.spdx_id)&&x.content&&x.encoding==='base64');}
export function domainStatus(status){return status===404?'No registration record returned; registrar availability still unverified':status===200?'Registered; skip':'Lookup unavailable; ownership unknown';}
async function get(url,github=false){
 const headers={accept:github?'application/vnd.github+json':'application/json,text/html','user-agent':'Indiana-Digital-Asset-Scout'};
 if(github&&process.env.GITHUB_TOKEN)headers.authorization='Bearer '+process.env.GITHUB_TOKEN;
 const r=await fetch(url,{headers,signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error('HTTP '+r.status);
 const text=await r.text();return github?JSON.parse(text):text;
}
export async function scout(mission,{request=get,clock=new Date()}={}){
 const findings=[],errors=[],queries=[];
 const topic=['document parser','education learning','dataset data quality','developer automation'][Math.floor(clock.getTime()/900000)%4];
 const q=topic+' archived:false fork:false stars:>=5 '+['license:mit','license:apache-2.0','license:bsd-3-clause'][Math.floor(clock.getTime()/3600000)%3];
 queries.push(q);
 try{
  const results=await request('https://api.github.com/search/repositories?q='+encodeURIComponent(q)+'&sort=updated&order=desc&per_page=10',true);
  for(const r of results.items||[]){
   try{
    const l=await request('https://api.github.com/repos/'+r.full_name+'/license',true);
    if(!eligibleLicense(l))continue;
    const licenseText=Buffer.from(l.content.replace(/\s/g,''),'base64').toString('utf8');
    findings.push({type:'open-source project',name:r.full_name,source:r.html_url,description:r.description||'No description supplied by maintainer.',rights:l.license.spdx_id,rightsEvidence:l.html_url,licenseText,ownership:'Maintainer-owned; documented reuse license, not exclusive ownership',access:'Open the repository, select Code → Download ZIP or clone it. Read LICENSE and dependency/model licenses; preserve notices and comply with the applicable license.',contact:r.html_url+'/issues',potential:'Potential building block for a specialized product or service; no buyer or valuation verified.',lastUpdated:r.updated_at,accessCost:'No code purchase required; compute and maintenance costs not assessed'});
   }catch(e){errors.push({source:r.html_url,error:e.message});}
  }
 }catch(e){errors.push({source:'GitHub repository discovery',error:e.message});}
 const domains=[];
 return {scout:'Indiana',mode:'digital-asset-scout',mission,ranAt:clock.toISOString(),queries,findings,domains,errors,receivedUsd:0,actions:'Read-only discovery; no purchases, registrations or claims performed'};
}
export function reportMarkdown(r){
 const out=['# Indiana — Digital Asset Scout',r.ranAt,'','## Exact mission',r.mission,'','## Additional user context (mission unchanged)',r.assetContext||'None supplied','','## Findings'];
 for(const f of r.findings)out.push('','### '+f.name,'- Source: '+(f.source||f.url),'- Description: '+f.description,'- Rights: '+f.rights,'- Rights evidence: '+f.rightsEvidence,'- Access: '+f.access,'- Commercial potential (unverified): '+f.potential,...(f.contact?['- Contact: '+f.contact]:[]));
 out.push('','## Domain checks',...r.domains.map(d=>'- '+d.name+': '+d.status+'. '+(d.access||'No availability established.')), '', '## Collection errors',...r.errors.map(e=>'- '+e.source+': '+e.error),'',r.actions);
 return out.join('\n')+'\n';
}
export async function run(mission,assetContext='') {
 const r=await scout(mission);r.assetContext=assetContext;const md=reportMarkdown(r);
 await writeFile('indy-digital-assets.json',JSON.stringify(r,null,2));
 await writeFile('indy-digital-assets.md',md);
 if(process.env.GITHUB_STEP_SUMMARY)await writeFile(process.env.GITHUB_STEP_SUMMARY,md,{flag:'a'});
 console.log(JSON.stringify(r,null,2));
 if(!r.findings.length)throw Error('No rights-verified findings collected; inspect source errors');
}
