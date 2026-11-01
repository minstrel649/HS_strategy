# Model profiles

Each JSON file is one saved model configuration. `MODEL_PROFILE` selects the profile used by the
game, and `MODEL_BACKUP_PROFILE` optionally selects a second profile after a transient failure.
Keep credentials in `.env.local`; profiles refer to environment-variable names and never contain
the secret itself.

The included `deepseek-flash.json` is the default instance. To add another chat-completions model:

1. Copy the file to a new lowercase profile name, for example `my-model.json`.
2. Change `id`, `name`, API URL/path, model id, credential environment names, request defaults, and
   response field paths to match that API.
3. Put the credential in `.env.local`, then set `MODEL_PROFILE=my-model`.
4. Run `npm run smoke` before starting a game.

Both single environment-variable names and arrays of fallback names are accepted by `*Env` fields.
The generic client currently implements the `chat-completions` protocol, which covers services
exposing OpenAI-compatible chat-completions endpoints. A different wire protocol should be added as
a new adapter rather than hard-coded into game logic.
