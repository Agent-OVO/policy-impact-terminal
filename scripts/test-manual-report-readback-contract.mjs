#!/usr/bin/env node
// Regression for two real reports: tested against the production normalizer and app mapper.
// No HTTP, credentials, or database access. Supabase creation is a fail-closed test stub.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { build } from 'esbuild';

const root = process.cwd();
const ids = ['5c3ef1ae-306a-492a-aa01-e94163f3b52a', '5d00751a-f47e-4cc7-8a04-5c8f921802a9'];
const mapperBundle = await build({entryPoints:[path.join(root,'src/lib/reportMappers.ts')],bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
const {mapPolicyReportPayloadForApp} = await import('data:text/javascript;base64,' + Buffer.from(mapperBundle.outputFiles[0].text).toString('base64'));
const sourceFile = path.join(root,'supabase/functions/analyze/index.ts');
const source = await fs.readFile(sourceFile,'utf8');
const functionBundle = await build({
  stdin:{contents:source+'\nexport { normalizeManualReportPayload };',resolveDir:path.dirname(sourceFile),loader:'ts'},
  bundle:true,platform:'node',format:'iife',globalName:'TestAnalyze',write:false,logLevel:'silent',
  plugins:[{name:'no-network',setup(b){
    b.onResolve({filter:/^https?:/}, a=>({path:a.path,namespace:'no-network'}));
    b.onLoad({filter:/.*/,namespace:'no-network'},()=>({contents:'export function createClient(){throw new Error("Database calls forbidden in normalizer regression")}'}));
  }}]
});
const context = vm.createContext({Deno:{serve(){}},console});
vm.runInContext(functionBundle.outputFiles[0].text,context,{timeout:2000});
const normalize = context.TestAnalyze.normalizeManualReportPayload;
const now = '2026-10-09T00:00:00.000Z';
let cases = 0;
for (const id of ids) {
  const r = JSON.parse(await fs.readFile(path.join(root,'manual-reports',id+'.json'),'utf8'));
  const app = mapPolicyReportPayloadForApp(r);
  assert.equal(app.industryChain.flatMap(c=>c.nodes).length,3);
  for (const node of app.industryChain.flatMap(c=>c.nodes)) {
    assert.ok(node.name.trim(),id+': blank industry-chain name');
    assert.ok(node.watchSignals.length>0,id+': missing node evidence gate');
  }
  assert.equal(app.investmentDirection.minimumEvidenceNeeded.length,3,id+': three bounded evidence gates');
  assert.ok(app.investmentDirection.keyRisks.length>=3,id+': risks lost in mapper');
  assert.ok(app.investmentDirection.doNotOverread.length>=3,id+': overreading warnings lost');
  assert.ok(app.compareInsights.similarityPoints.length>0,id+': comparison basis missing');
  assert.ok(app.compareInsights.differencePoints.length>0,id+': comparison boundary missing');
  assert.equal(app.companies.length,0);
  assert.equal(app.companyMap.length,0);
  assert.equal(app.summary.evidenceCount,r.evidence.length);
  const policy = {id,external_id:null,title:r.policy.title,status:'reviewing',issuer:id===ids[1]?'电子信息司':'国家发展改革委',publish_date:'2026-09-28',effective_date:null,source_name:'official',source_url:r.policy.sourceUrl,category:r.policy.category,policy_level:'policy',confidence:80,summary:'',full_text:'official text',metadata:{}};
  const normalized = normalize(policy,r,now);
  assert.equal(normalized.policy.effectiveDate,r.policy.effectiveDate,id+': reviewed effective date overwritten');
  assert.equal(normalized.policy.issuer,r.policy.issuer,id+': reviewed issuer overwritten');
  assert.equal(normalized.summary.issuer,r.policy.issuer,id+': summary issuer differs');
  assert.equal(normalized.summary.status,'published');
  assert.equal(normalized.policyId,id);
  assert.equal(normalized.generatedAt,now);
  cases += 1;
  console.log('[manual:readback-test] ok '+id+' canonical display, evidence gates, zero company, dates and issuer');
}
const fixture = {id:ids[0],external_id:null,title:'fixture',publish_date:'2026-09-28',effective_date:'2026-09-14',issuer:'official',category:'regulation',policy_level:'rule',source_name:'official',metadata:{}};
assert.equal(normalize(fixture,{policy:{}},now).policy.effectiveDate,'2026-09-14');
assert.equal(normalize({...fixture,effective_date:null},{policy:{}},now).policy.effectiveDate,'');
assert.equal(normalize(fixture,{policy:{effectiveDate:''}},now).policy.effectiveDate,'');
assert.equal(normalize(fixture,{policy:{effectiveDate:'2026-09-15'}},now).policy.effectiveDate,'2026-09-15');
assert.equal(normalize(fixture,{policy:{}},now).policy.issuer,'official');
console.log('[manual:readback-test] '+(cases+5)+' real-report and fallback cases passed; no publication-date substitution');
