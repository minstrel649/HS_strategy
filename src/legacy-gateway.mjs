// Frozen offline comparison path for historical Jev/d1 evaluation only.
import {experimental_evaluate as evaluate} from 'ai';

export async function askGateway(state,questions,{
  model,
  timeoutMs=5000,
}={}){
  if(!process.env.AI_GATEWAY_API_KEY)throw Error('Missing AI_GATEWAY_API_KEY for legacy Gateway evaluation');
  const until=process.env.JEV_PRICING_CHECKED_UNTIL??'2026-09-25T00:00:00Z';
  if(Date.now()>=Date.parse(until))throw Error(`Jev pricing was last checked for use until ${until}; recheck it, then set JEV_PRICING_CHECKED_UNTIL`);
  const start=performance.now();
  const result=await evaluate({
    model,
    state:JSON.parse(JSON.stringify(state)),
    questions:JSON.parse(JSON.stringify(questions)),
    maxRetries:0,
    abortSignal:AbortSignal.timeout(timeoutMs),
    ...(model==='typesafe-ai/jev'&&{providerOptions:{gateway:{order:['typesafe-ai','digitalocean']}}}),
  });
  return {
    model:result.response.modelId,
    latencyMs:Math.round(performance.now()-start),
    answers:result.answers,
    usage:result.usage,
    metadata:result.providerMetadata,
  };
}
