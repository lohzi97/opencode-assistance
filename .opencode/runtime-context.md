# Runtime Context

These values are rendered at prompt-build time by `.opencode/plugins/system-files.ts`.
Blank values mean the runtime field was unavailable for this turn.

## Session

- Current date: `{{OPENCODE_CURRENT_DATE}}`
- Current datetime: `{{OPENCODE_CURRENT_DATETIME}}`
- Current session id: `{{OPENCODE_SESSION_ID}}`
- Server URL: `{{OPENCODE_SERVER_URL}}`

## Workspace

- Directory: `{{OPENCODE_DIRECTORY}}`
- Worktree: `{{OPENCODE_WORKTREE}}`
- Project id: `{{OPENCODE_PROJECT_ID}}`
- Project worktree: `{{OPENCODE_PROJECT_WORKTREE}}`
- Project VCS: `{{OPENCODE_PROJECT_VCS}}`
- Project VCS dir: `{{OPENCODE_PROJECT_VCS_DIR}}`
- Project created at: `{{OPENCODE_PROJECT_CREATED_AT}}`
- Project initialized at: `{{OPENCODE_PROJECT_INITIALIZED_AT}}`

## Model Identity

- Provider id: `{{OPENCODE_PROVIDER_ID}}`
- Model id: `{{OPENCODE_MODEL_ID}}`
- Model name: `{{OPENCODE_MODEL_NAME}}`
- Model family: `{{OPENCODE_MODEL_FAMILY}}`
- Model status: `{{OPENCODE_MODEL_STATUS}}`
- Model release date: `{{OPENCODE_MODEL_RELEASE_DATE}}`
- Model API id: `{{OPENCODE_MODEL_API_ID}}`
- Model API URL: `{{OPENCODE_MODEL_API_URL}}`
- Model API npm package: `{{OPENCODE_MODEL_API_NPM}}`

## Model Limits

- Context limit: `{{OPENCODE_MODEL_LIMIT_CONTEXT}}`
- Input limit: `{{OPENCODE_MODEL_LIMIT_INPUT}}`
- Output limit: `{{OPENCODE_MODEL_LIMIT_OUTPUT}}`

## Model Cost

- Input cost: `{{OPENCODE_MODEL_COST_INPUT}}`
- Output cost: `{{OPENCODE_MODEL_COST_OUTPUT}}`
- Cache read cost: `{{OPENCODE_MODEL_COST_CACHE_READ}}`
- Cache write cost: `{{OPENCODE_MODEL_COST_CACHE_WRITE}}`
- Over-200k input cost: `{{OPENCODE_MODEL_COST_OVER_200K_INPUT}}`
- Over-200k output cost: `{{OPENCODE_MODEL_COST_OVER_200K_OUTPUT}}`
- Over-200k cache read cost: `{{OPENCODE_MODEL_COST_OVER_200K_CACHE_READ}}`
- Over-200k cache write cost: `{{OPENCODE_MODEL_COST_OVER_200K_CACHE_WRITE}}`

## Model Capabilities

- Supports temperature: `{{OPENCODE_MODEL_CAPABILITY_TEMPERATURE}}`
- Supports reasoning: `{{OPENCODE_MODEL_CAPABILITY_REASONING}}`
- Supports attachments: `{{OPENCODE_MODEL_CAPABILITY_ATTACHMENT}}`
- Supports tool calls: `{{OPENCODE_MODEL_CAPABILITY_TOOLCALL}}`
- Interleaved mode: `{{OPENCODE_MODEL_CAPABILITY_INTERLEAVED}}`
- Input text: `{{OPENCODE_MODEL_CAPABILITY_INPUT_TEXT}}`
- Input audio: `{{OPENCODE_MODEL_CAPABILITY_INPUT_AUDIO}}`
- Input image: `{{OPENCODE_MODEL_CAPABILITY_INPUT_IMAGE}}`
- Input video: `{{OPENCODE_MODEL_CAPABILITY_INPUT_VIDEO}}`
- Input PDF: `{{OPENCODE_MODEL_CAPABILITY_INPUT_PDF}}`
- Output text: `{{OPENCODE_MODEL_CAPABILITY_OUTPUT_TEXT}}`
- Output audio: `{{OPENCODE_MODEL_CAPABILITY_OUTPUT_AUDIO}}`
- Output image: `{{OPENCODE_MODEL_CAPABILITY_OUTPUT_IMAGE}}`
- Output video: `{{OPENCODE_MODEL_CAPABILITY_OUTPUT_VIDEO}}`
- Output PDF: `{{OPENCODE_MODEL_CAPABILITY_OUTPUT_PDF}}`
