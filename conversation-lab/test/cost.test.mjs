import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeLive } from '../lib/cost.mjs';
const base = { model: 'gemini-3.8-live', createdAt:'2026-10-11T03:06:16.937Z', endedAt:'2026-10-11T03:07:10.807Z', recording:{durationMs:52536} };
const row = {atMs:19165,source:'google-live',value:{promptTokenCount:849,responseTokenCount:50,thoughtsTokenCount:58,promptTokensDetails:[{modality:'TEXT',tokenCount:357},{modality:'AUDIO',tokenCount:441}],responseTokensDetails:[{modality:'AUDIO',tokenCount:50}]}};
test('observed token subtotal preserves unknown session cost and mismatches',()=>{
 const s=summarizeLive({...base,usage:[row]});
 assert.equal(s.elapsedSeconds,53.87); assert.equal(s.recordingSeconds,52.536);
 assert.ok(Math.abs(s.observations[0].knownDetailsUsd-.00219075)<1e-12);
 assert.equal(s.observations[0].inputUnclassified,51);
 assert.equal(s.observations[0].thoughtsTokens,58);
 assert.equal(s.sessionUsd,null); assert.equal(s.finalUsageConfirmed,false);
});
test('repeated or cumulative notifications never get summed',()=>{
 const s=summarizeLive({...base,usage:[row,row]});
 assert.equal(s.observations.length,2); assert.equal(s.sessionUsd,null); assert.equal(s.aggregation,'none');
});
test('missing usage, counts, times and unsupported modalities stay unknown',()=>{
 const s=summarizeLive({model:base.model,usage:[{source:'google-live',value:{promptTokensDetails:[{modality:'AUDIO'},{modality:'UNKNOWN',tokenCount:42}]}}]});
 assert.equal(s.elapsedSeconds,null);assert.equal(s.recordingSeconds,null);
 assert.equal(s.observations[0].knownDetailsUsd,null);assert.equal(s.observations[0].promptTokens,null);
 assert.equal(s.observations[0].lines[0].tokens,null);
 assert.equal(summarizeLive({...base,mock:true}),null);
 assert.equal(summarizeLive({...base,model:'other'}),null);
});
