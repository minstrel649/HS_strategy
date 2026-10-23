import test from 'node:test';
import assert from 'node:assert/strict';
import {ask,parseJsonObject} from '../src/jev.mjs';

const questions={move:{type:'choice',instructions:'Attack for lethal.',criteria:{attack:'Attack face.',end:'End turn.'}}};

test('parses a fenced JSON answer',()=>{
  assert.deepEqual(parseJsonObject('```json\n{"move":{"choice":"attack"}}\n```'),{move:{choice:'attack'}});
});

test('calls the configured DeepSeek endpoint and validates its choice',async t=>{
  const previous={key:process.env.DEEPSEEK_API_KEY,base:process.env.DEEPSEEK_BASE_URL};
  const previousFetch=globalThis.fetch;
  t.after(()=>{
    if(previous.key===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=previous.key;
    if(previous.base===undefined)delete process.env.DEEPSEEK_BASE_URL;else process.env.DEEPSEEK_BASE_URL=previous.base;
    globalThis.fetch=previousFetch;
  });
  process.env.DEEPSEEK_API_KEY='test-key';
  process.env.DEEPSEEK_BASE_URL='https://deepseek.example.test/v1';
  let request;
  globalThis.fetch=async(url,init)=>{
    request={url,init,body:JSON.parse(init.body)};
    return new Response(JSON.stringify({
      model:'deepseek-flash',
      choices:[{message:{content:'{"move":{"choice":["attack"]}}'}}],
      usage:{prompt_tokens:20,completion_tokens:4,total_tokens:24},
    }),{status:200,headers:{'content-type':'application/json','x-request-id':'request-1'}});
  };
  const result=await ask({enemyHealth:4},questions);
  assert.equal(request.url,'https://deepseek.example.test/v1/chat/completions');
  assert.equal(request.body.model,'deepseek-flash');
  assert.equal(request.body.response_format.type,'json_object');
  assert.equal(request.body.reasoning_effort,'none');
  assert.equal(result.answers.move.choice,'attack');
  assert.equal(result.usage.totalTokens,24);
});

test('rejects a choice outside the candidate menu',async t=>{
  const previousKey=process.env.DEEPSEEK_API_KEY;
  const previousFetch=globalThis.fetch;
  t.after(()=>{
    if(previousKey===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=previousKey;
    globalThis.fetch=previousFetch;
  });
  process.env.DEEPSEEK_API_KEY='test-key';
  globalThis.fetch=async()=>new Response(JSON.stringify({
    model:'deepseek-flash',
    choices:[{message:{content:'{"move":{"choice":"invented"}}'}}],
  }),{status:200,headers:{'content-type':'application/json'}});
  await assert.rejects(()=>ask({},questions),/outside question move's candidate menu/);
});
