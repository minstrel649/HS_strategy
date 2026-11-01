// Compatibility module for older callers. Live decisions use model-api.mjs and a saved profile.
export {askModel as ask,askModel,loadModelProfile,modelProfileName,parseJsonObject,requestModel} from './model-api.mjs';
