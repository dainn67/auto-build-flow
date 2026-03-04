# Auto Build Flow — AI Context

## Purpose

Automated app build tool: **receive user message → infer intent → generate build command/script → execute**. Triggered via Discord in target channel(s). Uses Gemini for intent detection and script generation; runs against one or more Flutter projects (writes `apps.sh` for Easypass, runs `build.sh` in each project).

## Stack

- **Runtime:** Node (ESM)
- **Entry:** `index.js` — Discord bot + Express health server; routes messages by channel to handlers
- **AI:** Google Gemini (`@google/generative-ai`) for message → JSON (intent, script, command, branch, etc.)
- **Chat:** Discord.js; messages from non-bots in `EASYPASS_TARGET_CHANNEL_ID`, `WSZ_TARGET_CHANNEL_ID`, or `LESLIE_TARGET_CHANNEL_ID` are handled (each channel can use a different handler).
- **Build host:** Flutter project dir per handler (e.g. `EASYPASS_PROJECT_DIR`, `WSZ_PROJECT_DIR`, `LESLIE_PROJECT_DIR`); must have `apps.sh`, `build.sh`, credentials as required by each project.

## Architecture

- **index.js** registers a single `MessageCreate` listener: if the channel is Easypass, WSZ, or Leslie, it calls the corresponding handler and passes a per-flow build lock (`{ isBuilding: boolean }`). Handlers are in `handlers/` so different projects can plug in different flows.
- **Easypass flow:** `handlers/easypass-handler.js` — `handleAutoBuildMessage(discordMessage, options)`. Uses `EASYPASS_PROJECT_DIR`, `prompts/easypass-prompt.js`, and a shared Gemini service (via `getGeminiService()`); `options.buildState` is used to prevent concurrent builds.

## Core Flow (Easypass handler)

1. User sends message in target Discord channel (Easypass or WSZ).
2. **Branch list:** `getRemoteBranches(dir)` for AI branch matching (`dir` = `EASYPASS_PROJECT_DIR`).
3. **Single Gemini call:** `createMessagePrompt(metadata, branches)` → `geminiService.processMessage(prompt, { isJSON: true })` → one JSON object with `intent` and intent-specific fields.
4. **Intent handling:**
   - **none:** exit (no reply).
   - **check_version:** `checkVersionApps`, `checkVersionPlatform` → `getVersionsReport(apps, dir, platform)` → reply with store version report (Discord chunks ≤1900 chars).
   - **build:** then:
     - If build in progress: reply “please wait” and exit.
     - Validate `message`, `script`, `command`; optional `useLatestVersion`, `branch`.
     - If `useLatestVersion`: parse app names from script → `getLatestVersionForApps(...)` → `replaceVersionInScript(script, versionName, buildNumber)`.
     - Set build lock, reply with `message`, replace `dir/apps.sh` with `script`.
     - If `branch`: `checkoutBranch(branch, dir)`; on failure reply error and return.
     - Send “Đang bắt đầu build…”, run `cd ${dir} && ./${command}` (e.g. `./build.sh a` or `./build.sh i`).
     - In `finally`: clear build lock.

## Intents (Gemini JSON)

- **intent:** `"build"` | `"check_version"` | `"none"`.
- **build:** `message` (short Vietnamese reply), `script` (full `apps.sh` content), `command` (e.g. `build.sh a` / `build.sh i`), optional `useLatestVersion` (bool), optional `branch` (exact name from list or user input).
- **check_version:** `checkVersionApps` (array of app names; empty or “all” → all apps), `checkVersionPlatform`: `"android"` | `"ios"` | `"all"`. No script/command.

Prompt and example JSON shape: `prompts/easypass-prompt.js`. App list from `configs/app-configs.js`, script template from `configs/script-config.js`.

## WSZ Flow (WSZ handler)

1. User sends message in WSZ target Discord channel.
2. **Branch list:** `getRemoteBranches(dir)` for AI branch matching (`dir` = `WSZ_PROJECT_DIR`).
3. **Single Gemini call:** `createWszMessagePrompt(metadata, branches)` → `geminiService.processMessage(prompt, { isJSON: true })` → one JSON object with `intent` and fields: `message`, `command`, `version`, `buildNumber`, `useLatestVersion`, `branch`.
4. **Intent handling:**
   - **none:** exit (no reply).
   - **build:** then:
     - If build in progress: reply “please wait” and exit.
     - Validate `message`, `command`; `version`/`buildNumber` may be empty if `useLatestVersion=true`.
     - Set build lock.
     - If `useLatestVersion`: infer platform from `command` (`build.sh i` → iOS, else Android) → `getLatestVersionForPackageId(WSZ_APP_PACKAGE, dir, platform)` → use returned `versionName` and `buildNumber` and inform user.
     - If `branch`: `checkoutBranch(branch, dir)`; on failure reply error and return.
     - Reply with `message`, then send “Đang bắt đầu build…”, run `cd ${dir} && ./${command} <version> <buildNumber>`.
     - In `finally`: clear build lock.

## Leslie Flow (Leslie handler)

1. User sends message in Leslie target Discord channel (if configured).
2. **No branch or store-version lookup:** Leslie flow does not use branches or store APIs; it only needs a final shell command to run from the project root.
3. **Single Gemini call:** `createLesliePrompt(metadata)` → `geminiService.processMessage(prompt, { isJSON: true })` → one JSON object with an optional `command` field.
4. **Intent handling:**
   - If `command` is missing/empty → treat as `"none"` and exit without replying.
   - If a build is already in progress for Leslie: reply “please wait” and exit.
   - Otherwise:
     - Set build lock.
     - Reply that a Leslie build is starting and echo the command.
     - Run `cd ${LESLIE_PROJECT_DIR} && {command}` via `executeCommand`.
     - On success/failure: send a short success/error message and (truncated) stdout/stderr to Discord.
     - In `finally`: clear build lock.

## Key Files

- **index.js** — Entry point. Discord client, single `MessageCreate` listener that routes by `channelId` to handlers (Easypass, WSZ, Leslie). Express health routes. Does not contain build logic; owns per-flow build lock objects and passes them into handlers.

- **handlers/easypass-handler.js** — Easypass auto-build flow. Exports `handleAutoBuildMessage(discordMessage, options)`. Uses `EASYPASS_PROJECT_DIR`, intent dispatch (none / check_version / build), shared build lock (`options.buildState`), branch and version steps, writes `apps.sh`, runs build command. Contains `splitMessage`.

- **handlers/wsz-handler.js** — WSZ auto-build flow. Exports `handleAutoBuildMessage(discordMessage, options)`. Uses `WSZ_PROJECT_DIR`, intent dispatch (none / build), shared build lock (`options.buildState`), optional branch checkout, optional “latest version” lookup via `getLatestVersionForPackageId`, then runs `./build.sh ... <version> <buildNumber>`.

- **handlers/leslie-handler.js** — Leslie auto-build flow. Exports `handleAutoBuildMessage(discordMessage, options)`. Uses `LESLIE_PROJECT_DIR`, very simple intent: AI only decides whether the message is a build command; if yes it returns a single shell `command` (including version and build number, defaulting to `1.0.0` / `1` when omitted) and the handler runs `cd {LESLIE_PROJECT_DIR} && {command}` with a per-flow build lock.

- **prompts/easypass-prompt.js** — Builds the Easypass Gemini prompt: app list, branch list, intent rules (build vs check_version vs none), and JSON format example.

- **prompts/wsz-prompt.js** — Builds the WSZ Gemini prompt: branch list, intent rules (build vs none), version rules (manual vs latest), and JSON format example.

- **prompts/leslie-prompt.js** — Builds the Leslie Gemini prompt: only decides if the message is a build command and, if so, returns a single `command` string (including version and build number, defaulting to `1.0.0` / `1` when omitted).

- **services/gemini-service.js** — Gemini client. `processMessage(prompt, { isJSON, schema })`, plus `generate`, `generateJSON`, `generateWithSchema`.

- **services/git-service.js** — `getRemoteBranches(dir)`, `checkoutBranch(branch, dir)` (fetch, reset, checkout, pull).

- **services/store-version-service.js** — Store version: CMS app config, Google Play internal track, App Store Connect TestFlight. Exports `getLatestVersionForApps`, `getLatestVersionForPackageId`, `getVersionsReport`, `parseAppNamesFromScript`, `replaceVersionInScript`.

- **utils.js** — `replaceFileContent(path, content)`, `executeCommand(cmd)` (spawn, stream stdout/stderr, resolve with success, stdout, stderr, exitCode).

- **configs/app-configs.js** — List of app names (accuplacer, ase, asvab, etc.).

- **configs/script-config.js** — Example script snippet (VERSION, BUILD_NUMBER, LIST_APP) used in the prompt.

## Environment

- **Required:** `DISCORD_BOT_TOKEN`, `EASYPASS_TARGET_CHANNEL_ID`, `WSZ_TARGET_CHANNEL_ID`, `LESLIE_TARGET_CHANNEL_ID`, `GEMINI_API_KEY`
- **Optional:** `GEMINI_MODEL` (default `gemini-3-flash-preview`), `HOST` (default `0.0.0.0`), `PORT` (default `8000`)
- **Per-handler:** Easypass uses `EASYPASS_PROJECT_DIR`; WSZ uses `WSZ_PROJECT_DIR`; Leslie uses `LESLIE_PROJECT_DIR` (Flutter project paths; no defaults in code).

## Build Script and Command

- **Written file:** `{EASYPASS_PROJECT_DIR}/apps.sh` — overwritten each build with Gemini-generated script (VERSION, BUILD_NUMBER, LIST_APP block).
- **Executed:** `./build.sh a` (Android) or `./build.sh i` (iOS); command string from Gemini.

Platform for “latest version” is inferred from command: contains `build.sh i` → iOS, else Android.

## Version Handling

- **Next build version (Easypass, multiple apps):** `getLatestVersionForApps(appNames, dir, platform)` → fetches store versions (Google Play internal / TestFlight), takes max version/build across apps, returns `{ versionName, buildNumber }`. Then `replaceVersionInScript(script, versionName, buildNumber)` and run build.
- **Next build version (WSZ, single package):** `getLatestVersionForPackageId(packageId, dir, platform)` → fetches store version for the given package/bundle id and returns `{ versionName, buildNumber }`, which is passed as CLI args to `build.sh`.
- **Report only:** `getVersionsReport(appNames, dir, platform)` for check_version intent; no increment. Platform `"all"` queries both Android and iOS.
- **store-version-service.js** uses: CMS API (app config map), Google Play (service account JWT), App Store Connect (Apple JWT from `ios_api_key/`). Project dir(s) must have `service_account.json` and `ios_api_key/` for store lookups.

## Branch Handling

- Remote branches fetched once per message; passed into prompt so Gemini can return an exact branch name from the list.
- On build, if `branch` is set: `checkoutBranch` does `git reset --hard`, `checkout`, `pull origin branch`. Failure stops build and replies with error.

## HTTP Endpoints

- `GET /` — JSON: status, bot_connected, bot_user, easypass_target_channel_id, wsz_target_channel_id, leslie_target_channel_id
- `GET /health` — JSON: status (healthy/starting), bot_latency (ping), timestamp

## Conventions

- Only one build at a time per flow (build lock in handler).
- Long Discord replies are split with `splitMessage(text, 1900)` at newlines when possible.
- User-facing replies often mention the requesting user (`discordMessage.author`). Vietnamese used for user-facing messages. Some status messages (e.g. branch success, “Đang bắt đầu build…”) may omit the mention.
- New project flows: add a handler in `handlers/`, add env/channel routing in `index.js`, and call the handler with the right options (channel id, project dir, geminiService, buildState).
