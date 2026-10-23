import { experimental_evaluate as evaluate } from 'ai';

const DEFAULT_DEEPSEEK_MODEL='deepseek-flash';
const GATEWAY_MODELS=new Set(['typesafe-ai/jev','liquid/d1']);
// The live decision path uses DeepSeek Flash. Explicit legacy model IDs still go through the
// AI Gateway so frozen offline comparisons remain reproducible without changing this provider.
export const MODEL=process.env.DEEPSEEK_MODEL?.trim()||DEFAULT_DEEPSEEK_MODEL;

function deepSeekEndpoint(base=process.env.DEEPSEEK_BASE_URL??'https://api.deepseek.com'){
  const clean=base.trim().replace(/\/+$/,'');
  return /\/chat\/completions$/i.test(clean)?clean:`${clean}/chat/completions`;
}

export function parseJsonObject(text){
  let value=String(text??'').trim();
  if(value.startsWith('```')){
    value=value.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/i,'');
  }
  try{return JSON.parse(value)}
  catch{
    const start=value.indexOf('{'),end=value.lastIndexOf('}');
    if(start>=0&&end>start){
      try{return JSON.parse(value.slice(start,end+1))}catch{}
    }
    throw Error('DeepSeek returned text that is not a JSON object');
  }
}

function validateAnswers(parsed,questions){
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error('DeepSeek answer must be a JSON object');
  const answers={};
  for(const [id,question] of Object.entries(questions)){
    const raw=parsed[id]?.choice;
    const choice=Array.isArray(raw)&&raw.length===1?raw[0]:raw;
    const allowed=question?.criteria&&typeof question.criteria==='object'?Object.keys(question.criteria):[];
    if(typeof choice!=='string'||!choice)throw Error(`DeepSeek did not answer question ${id}`);
    if(allowed.length&&!allowed.includes(choice))throw Error(`DeepSeek chose ${choice}, which is outside question ${id}'s candidate menu`);
    answers[id]={choice};
  }
  return answers;
}

async function askDeepSeek(state,questions,{model,timeoutMs}){
  // Keep the legacy variable name usable for existing local files. It is sent only to the
  // DeepSeek endpoint selected by DEEPSEEK_BASE_URL, never to the AI Gateway.
  const apiKey=process.env.DEEPSEEK_API_KEY??process.env.DEEPSEEK_KEY??process.env.AI_GATEWAY_API_KEY;
  if(!apiKey)throw Error('Missing DEEPSEEK_API_KEY. Put it in local .env.local; never commit or print it.');
  const shape=Object.fromEntries(Object.entries(questions).map(([id,q])=>{
    const choices=Object.keys(q?.criteria??{});
    return [id,{choice:`<one of: ${choices.join(' | ')}>`}];
  }));
  const body={
    model,
    messages:[
      {role:'system',content:'You are a Hearthstone decision engine. Choose exactly one listed candidate for every question. choice must be one candidate-id string, never an array. Follow the supplied instructions and visible state. Return only one JSON object with the requested answer shape; do not add prose.'},
      {role:'user',content:`Required answer shape: ${JSON.stringify(shape)}\nDecision context: ${JSON.stringify({state,questions})}`},
    ],
    response_format:{type:'json_object'},
    reasoning_effort:process.env.DEEPSEEK_REASONING_EFFORT?.trim()||'none',
    temperature:0.2,
    max_tokens:512,
    stream:false,
  };
  const start=performance.now();
  const response=await fetch(deepSeekEndpoint(),{
    method:'POST',
    headers:{'content-type':'application/json',authorization:`Bearer ${apiKey}`},
    body:JSON.stringify(body),
    signal:AbortSignal.timeout(timeoutMs),
  });
  const raw=await response.text();
  if(!response.ok){
    const error=Error(`DeepSeek HTTP ${response.status}: ${raw.slice(0,500)}`);
    error.statusCode=response.status;error.status=response.status;
    throw error;
  }
  let payload;
  try{payload=JSON.parse(raw)}
  catch{throw Error('DeepSeek returned an invalid HTTP JSON response')}
  const content=payload.choices?.[0]?.message?.content;
  const answers=validateAnswers(parseJsonObject(content),questions);
  const usage=payload.usage??{};
  return {
    model:payload.model??model,
    latencyMs:Math.round(performance.now()-start),
    answers,
    usage:{
      inputTokens:usage.prompt_tokens,
      outputTokens:usage.completion_tokens,
      totalTokens:usage.total_tokens,
    },
    metadata:{deepseek:{model:payload.model??model,requestId:response.headers.get('x-request-id')??null}},
  };
}

export async function ask(state, questions, {
  model=MODEL,
  timeoutMs=Number(process.env.DEEPSEEK_TIMEOUT_MS??process.env.JEV_TIMEOUT_MS??8000),
}={}) {
  if(!GATEWAY_MODELS.has(model))return askDeepSeek(state,questions,{model,timeoutMs});
  if (!process.env.AI_GATEWAY_API_KEY) throw new Error('Missing AI_GATEWAY_API_KEY. Put it in local .env.local (never in the vault).');
  // Not the key's expiry: a cost stop. Vercel lists Jev as free until this date; past it every
  // call may bill. After rechecking the price, set JEV_PRICING_CHECKED_UNTIL in .env.local to the
  // next date worth rechecking -- no code change, and a fresh key or endpoint does not lift it.
  const until = process.env.JEV_PRICING_CHECKED_UNTIL ?? '2026-09-25T00:00:00Z';
  if (Date.now()>=Date.parse(until)) throw new Error(`Jev pricing was last checked for use until ${until}; recheck it, then set JEV_PRICING_CHECKED_UNTIL in .env.local.`);
  // Legacy offline comparisons can still use the Gateway and its provider failover.
  const start = performance.now();
  const r = await evaluate({model, state: JSON.parse(JSON.stringify(state)), questions: JSON.parse(JSON.stringify(questions)), maxRetries: 0, abortSignal: AbortSignal.timeout(timeoutMs), ...(model==='typesafe-ai/jev'&&{providerOptions:{gateway:{order:['typesafe-ai','digitalocean']}}})});
  return {model: r.response.modelId, latencyMs: Math.round(performance.now()-start), answers:r.answers, usage:r.usage, metadata:r.providerMetadata};
}
