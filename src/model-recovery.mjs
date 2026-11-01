// Access/configuration failures cannot recover by retrying every turn.
export function permanentModelFailure(error){
  return [401,402,403].includes(Number(error?.statusCode??error?.status)) ||
    /free tier users do not have access|missing (?:AI_GATEWAY|DEEPSEEK)_API_KEY|missing model api credential|pricing was last checked|invalid api key|insufficient (?:credits|quota)/i.test(error?.message??'');
}

export function modelRateLimited(error){
  return Number(error?.statusCode??error?.status)===429 ||
    /no access to this model at this time|rate limit|too many requests/i.test(error?.message??'');
}

const BACKOFF=[2000,4000,8000];
export function createModelRecovery({now=Date.now,budgetMs=5000,rateBudgetMs=30000,cooldownMs=60000}={}){
  let disabled=null,since=null,tries=0,gaveUp=-Infinity;
  return async (request,fallback)=>{
    if(disabled)return fallback(disabled);
    since??=now();
    try{const result=await request();since=null;tries=0;return result}
    catch(error){
      if(permanentModelFailure(error)){disabled=error;return fallback(error)}
      const throttled=modelRateLimited(error),budget=throttled&&now()-gaveUp>=cooldownMs?rateBudgetMs:budgetMs;
      if(now()-since<budget){if(throttled)error.retryAfterMs=BACKOFF[Math.min(tries++,BACKOFF.length-1)];throw error}
      if(throttled&&budget===rateBudgetMs)gaveUp=now();
      since=null;tries=0;return fallback(error);
    }
  };
}
