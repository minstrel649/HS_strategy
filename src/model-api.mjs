import {readFile} from 'node:fs/promises';

const PROFILE_DIR = new URL('../config/models/', import.meta.url);
const PROFILE_ID = /^[a-z0-9][a-z0-9_-]*$/i;
const PROFILE_CACHE = new Map();

export function modelProfileName(){return process.env.MODEL_PROFILE?.trim()||'deepseek-flash'}

function envValue(names){
  for(const name of (Array.isArray(names)?names:[names])){
    if(!name)continue;
    const value=process.env[name]?.trim();
    if(value)return value;
  }
  return null;
}

export async function loadModelProfile(name=modelProfileName()){
  if(typeof name!=='string'||!PROFILE_ID.test(name))throw Error(`Invalid model profile name: ${name}`);
  if(PROFILE_CACHE.has(name))return PROFILE_CACHE.get(name);
  const path=new URL(`${name}.json`,PROFILE_DIR);
  let profile;
  try{profile=JSON.parse(await readFile(path,'utf8'))}
  catch(e){throw Error(`Cannot load model profile ${name} from ${path.pathname}`,{cause:e})}
  if(profile.id&&profile.id!==name)throw Error(`Model profile ${name} declares a different id: ${profile.id}`);
  if(profile.protocol!=='chat-completions')throw Error(`Unsupported model protocol in ${name}: ${profile.protocol}`);
  PROFILE_CACHE.set(name,profile);
  return profile;
}

function endpointFor(profile){
  const api=profile.api??{};
  const direct=envValue(api.endpointEnv)??api.endpoint;
  if(direct)return direct;
  const base=(envValue(api.baseUrlEnv)??api.baseUrl??'').replace(/\/+$/,'');
  if(!base)throw Error(`Model profile ${profile.id} has no API endpoint`);
  const path=String(api.path??'').trim();
  if(!path||base.endsWith(path))return base;
  return `${base}/${path.replace(/^\/+/,'')}`;
}

function authHeaders(profile){
  const auth=profile.api?.auth??{type:'none'};
  const headers={};
  if(auth.type==='none')return headers;
  const token=envValue(auth.tokenEnv);
  const names=(Array.isArray(auth.tokenEnv)?auth.tokenEnv:[auth.tokenEnv]).filter(Boolean);
  if(!token)throw Error(`Missing model API credential for ${profile.id}. Configure one of: ${names.join(', ')}`);
  if(auth.type==='bearer')headers.authorization=`Bearer ${token}`;
  else if(auth.type==='header')headers[String(auth.headerName??'x-api-key').toLowerCase()]=token;
  else throw Error(`Unsupported auth type in ${profile.id}: ${auth.type}`);
  return headers;
}

function readPath(value,path){
  if(!path)return undefined;
  return String(path).split('.').reduce((current,key)=>current?.[key],value);
}

function overrideNumber(value,raw){
  if(raw==null||raw==='')return value;
  const number=Number(raw);
  if(!Number.isFinite(number))throw Error(`Expected a numeric model request override, got ${raw}`);
  return number;
}

function applyBodyEnvironment(body,bodyEnv={}){
  const result=JSON.parse(JSON.stringify(body??{}));
  for(const [key,names] of Object.entries(bodyEnv)){
    const raw=envValue(names);
    if(raw==null)continue;
    result[key]=typeof result[key]==='number'?overrideNumber(result[key],raw):raw;
  }
  return result;
}

function requiredAnswerShape(questions){
  return Object.fromEntries(Object.entries(questions).map(([id,q])=>{
    const choices=Object.keys(q?.criteria??{});
    return [id,{choice:`<one of: ${choices.join(' | ')}>`}];
  }));
}

function validateAnswers(parsed,questions){
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error('Model answer must be a JSON object');
  const answers={};
  for(const [id,question] of Object.entries(questions)){
    const raw=parsed[id]?.choice;
    const choice=Array.isArray(raw)&&raw.length===1?raw[0]:raw;
    const allowed=question?.criteria&&typeof question.criteria==='object'?Object.keys(question.criteria):[];
    if(typeof choice!=='string'||!choice)throw Error(`Model did not answer question ${id}`);
    if(allowed.length&&!allowed.includes(choice))throw Error(`Model chose ${choice}, which is outside question ${id}'s candidate menu`);
    answers[id]={choice};
  }
  return answers;
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
    throw Error('Model returned text that is not a JSON object');
  }
}

export async function requestModel(state,questions,{
  profile:profileArg=modelProfileName(),
  model,
  timeoutMs,
}={}){
  const profile=typeof profileArg==='string'?await loadModelProfile(profileArg):profileArg;
  if(profile?.protocol!=='chat-completions')throw Error(`Unsupported model protocol: ${profile?.protocol}`);
  const endpoint=endpointFor(profile);
  const modelId=model??envValue(profile.model?.env)??profile.model?.id;
  if(!modelId)throw Error(`Model profile ${profile.id} has no model id`);
  const configuredTimeout=Number(envValue(profile.request?.timeoutMsEnv)??profile.request?.timeoutMs??8000);
  const requestTimeout=Number(timeoutMs??configuredTimeout);
  if(!Number.isFinite(requestTimeout)||requestTimeout<=0)throw Error(`Invalid model timeout: ${requestTimeout}`);
  const body={
    ...applyBodyEnvironment(profile.request?.body,profile.request?.bodyEnv),
    model:modelId,
    messages:[
      {role:'system',content:profile.request?.systemPrompt??'Return one JSON object with the requested answer shape.'},
      {role:'user',content:`Required answer shape: ${JSON.stringify(requiredAnswerShape(questions))}\nDecision context: ${JSON.stringify({state,questions})}`},
    ],
  };
  const start=performance.now();
  const response=await fetch(endpoint,{
    method:String(profile.api?.method??'POST').toUpperCase(),
    headers:{'content-type':'application/json',...(profile.api?.headers??{}),...authHeaders(profile)},
    body:JSON.stringify(body),
    signal:AbortSignal.timeout(requestTimeout),
  });
  const raw=await response.text();
  if(!response.ok){
    const error=Error(`Model API ${profile.id} returned HTTP ${response.status}: ${raw.slice(0,500)}`);
    error.statusCode=response.status;error.status=response.status;error.profile=profile.id;
    throw error;
  }
  let payload;
  try{payload=JSON.parse(raw)}
  catch{throw Error(`Model API ${profile.id} returned an invalid HTTP JSON response`)}
  const content=readPath(payload,profile.response?.contentPath??'choices.0.message.content');
  const usage=profile.response?.usage??{};
  return {
    profile:{id:profile.id,name:profile.name??profile.id},
    model:readPath(payload,profile.response?.modelPath??'model')??modelId,
    endpoint,
    content,
    payload,
    latencyMs:Math.round(performance.now()-start),
    usage:{
      inputTokens:readPath(payload,usage.inputTokens),
      outputTokens:readPath(payload,usage.outputTokens),
      totalTokens:readPath(payload,usage.totalTokens),
    },
    metadata:{
      modelProfile:profile.id,
      requestId:response.headers.get(profile.response?.requestIdHeader??'x-request-id')??null,
    },
  };
}

export async function askModel(state,questions,options={}){
  const result=await requestModel(state,questions,options);
  return {
    profile:result.profile,
    model:result.model,
    latencyMs:result.latencyMs,
    answers:validateAnswers(parseJsonObject(result.content),questions),
    usage:result.usage,
    metadata:result.metadata,
  };
}
