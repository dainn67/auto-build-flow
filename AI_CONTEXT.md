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

- **index.js** registers a single `MessageCreate` listener: if the channel is Easypass, WSZ, or Leslie, it calls the corresponding handler and passes a per-flow build lock (`{ isBuilding: boolean }`). Handlers are in **build_handlers/** so different projects can plug in different flows.
- **Easypass flow:** `build_handlers/easypass-handler.js` — `handleAutoBuildMessage(discordMessage, options)`. Uses `EASYPASS_PROJECT_DIR`, `prompts/easypass-build-prompt.js`, and shared Gemini (via `getGeminiService()`); `options.buildState` prevents concurrent builds.

## Core Flow (Easypass handler)

1. User sends message in Easypass target Discord channel.
2. **Branch list:** `getRemoteBranches(dir)` for AI branch matching (`dir` = `EASYPASS_PROJECT_DIR`).
3. **Single Gemini call:** `createMessagePrompt(metadata, branches)` from `prompts/easypass-build-prompt.js` → `geminiService.processMessage(prompt, { isJSON: true })` → one JSON object with `intent` and intent-specific fields.
4. **Intent handling:** Handler implements **build** and **none** only. (Prompt still defines `check_version`; not implemented in handler.)
   - **none:** exit (no reply).
   - **build:** then:
     - If build in progress: reply “please wait” and exit.
     - Validate `message`, `script`, `command`; optional `useLatestVersion`, `branch`.
     - If `useLatestVersion`: `parseAppNamesFromScript(script)` → `getLatestVersionForApps(appNames, dir, platform)` → `replaceVersionInScript(script, versionName, buildNumber)`.
     - Set build lock, reply with `message`, replace `dir/apps.sh` with `script`.
     - If `branch`: `checkoutBranch(branch, dir)`; on failure reply error and return.
     - Send “Đang bắt đầu build…”, run `cd ${dir} && ./${command}` (e.g. `./build.sh a` or `./build.sh i`).
     - In `finally`: clear build lock.

## Intents (Gemini JSON)

- **intent:** `"build"` | `"check_version"` | `"none"` (Easypass prompt; handler only implements build / none).
- **build:** `message` (short Vietnamese reply), `script` (full `apps.sh` content), `command` (e.g. `build.sh a` / `build.sh i`), optional `useLatestVersion` (bool), optional `branch` (exact name from list or user input).
- **check_version:** Defined in prompt only; `checkVersionApps`, `checkVersionPlatform`. Not handled in handler.

Prompt and JSON shape: `prompts/easypass-build-prompt.js`. App list from `configs/app-configs.js`, script template from `configs/script-config.js`.

## WSZ Flow (WSZ handler)

1. User sends message in WSZ target Discord channel.
2. **Branch list:** `getRemoteBranches(dir)` for AI branch matching (`dir` = `WSZ_PROJECT_DIR`).
3. **Single Gemini call:** `createWszMessagePrompt(metadata, branches)` from `prompts/wsz-build-prompt.js` → `geminiService.processMessage(prompt, { isJSON: true })` → one JSON object with `intent`, `message`, `command`, `version`, `buildNumber`, `useLatestVersion`, `branch`.
4. **Intent handling:** build / none only.
   - **none:** exit (no reply).
   - **build:** then:
     - If build in progress: reply “please wait” and exit.
     - Validate `message`, `command`; `version`/`buildNumber` may be empty if `useLatestVersion=true`.
     - Set build lock, reply with `message`.
     - If `useLatestVersion`: infer platform from `command` (`build.sh i` → iOS, else Android) → `getLatestVersionForPackageId(WSZ_APP_PACKAGE, dir, platform)` → use returned `versionName` and `buildNumber`, inform user.
     - If `branch`: `checkoutBranch(branch, dir)`; on failure reply error and return.
     - Send “Đang bắt đầu build…”, run `cd ${dir} && ./${command} ${version} ${buildNumber}`.
     - In `finally`: clear build lock.

## Leslie Flow (Leslie handler)

1. User sends message in Leslie target Discord channel (if configured).
2. **No branch or store-version lookup:** Leslie flow does not use branches or store APIs; it only needs a final shell command to run from the project root.
3. **Single Gemini call:** `createLesliePrompt(metadata)` from `prompts/leslie-build-prompt.js` → `geminiService.processMessage(prompt, { isJSON: true })` → one JSON object with optional `message` and `command`.
4. **Intent handling:**
   - If `command` is missing/empty → exit without replying.
   - If a build is already in progress: reply “please wait” and exit.
   - Otherwise: set build lock; reply with `message` and command; run `cd ${dir} && {command}` via `executeCommand` (dir = `LESLIE_PROJECT_DIR` or `options.flutterProjectDir`); on success/failure send result and (truncated) stdout/stderr to Discord; in `finally` clear build lock.

## Key Files

- **index.js** — Entry point. Discord client, single `MessageCreate` listener that routes by `channelId` to build handlers. Express health routes. Owns per-flow build lock objects and passes `{ buildState }` into each handler.

- **build_handlers/easypass-handler.js** — Easypass auto-build flow. Exports `handleAutoBuildMessage(discordMessage, options)`. Uses `EASYPASS_PROJECT_DIR` (or `options.flutterProjectDir`), intent dispatch (none / build only), `options.buildState`, branch and version steps, writes `apps.sh`, runs build command.

- **build_handlers/wsz-handler.js** — WSZ auto-build flow. Exports `handleAutoBuildMessage(discordMessage, options)`. Uses `WSZ_PROJECT_DIR` (or `options.flutterProjectDir`), intent (none / build), `options.buildState`, optional branch checkout, optional “latest version” via `getLatestVersionForPackageId(WSZ_APP_PACKAGE, dir, platform)`, runs `./build.sh ... <version> <buildNumber>`.

- **build_handlers/leslie-handler.js** — Leslie auto-build flow. Exports `handleAutoBuildMessage(discordMessage, options)`. Uses `LESLIE_PROJECT_DIR` (or `options.flutterProjectDir`). AI returns `message` and `command`; if `command` present, handler runs `cd {dir} && {command}` with `options.buildState`; sends success/error and truncated stdout/stderr to Discord.

- **prompts/easypass-build-prompt.js** — Exports `createMessagePrompt(messageData, branches)`. Easypass Gemini prompt: app list, branch list, intent rules (build / check_version / none), JSON format.

- **prompts/wsz-build-prompt.js** — Exports `createWszMessagePrompt(messageData, branches)`. WSZ Gemini prompt: branch list, intent (build / none), version rules, JSON format.

- **prompts/leslie-build-prompt.js** — Exports `createLesliePrompt(messageData)`. Leslie Gemini prompt: decides if message is a build request; returns `message` and `command` (e.g. `python3 build.py <version> <buildNumber> <platform>`).

- **services/gemini-service.js** — Gemini client. `processMessage(prompt, { isJSON, schema })`, plus `generate`, `generateJSON`, `generateWithSchema`.

- **services/git-service.js** — `getRemoteBranches(dir)`, `checkoutBranch(branch, dir)` (fetch, reset, checkout, pull).

- **services/store-service.js** — Store version: CMS app config, Google Play internal track, App Store Connect TestFlight. Exports: `getLatestVersionForApps`, `getLatestVersionForPackageId`, `getAllAndroidPackageNames`, `parseAppNamesFromScript`, `replaceVersionInScript`, `getVersionsReport`.

- **utils.js** — `replaceFileContent(path, content)`, `executeCommand(cmd)` (spawn, stream stdout/stderr, resolve with success, stdout, stderr, exitCode).

- **configs/app-configs.js** — List of app names (accuplacer, ase, asvab, etc.).

- **configs/script-config.js** — Example script snippet (VERSION, BUILD_NUMBER, LIST_APP) used in Easypass prompt.

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
- **Report only:** `getVersionsReport(appNames, flutterDir, platform)` is exported by store-service; not currently used by handlers (check_version not implemented). Platform `"all"` queries both Android and iOS.
- **store-service.js** uses: CMS API (app config map), Google Play (service account JWT), App Store Connect (Apple JWT from `ios_api_key/`). Project dir(s) must have `service_account.json` and `ios_api_key/` for store lookups.

## Branch Handling

- Remote branches fetched once per message; passed into prompt so Gemini can return an exact branch name from the list.
- On build, if `branch` is set: `checkoutBranch` does `git reset --hard`, `checkout`, `pull origin branch`. Failure stops build and replies with error.

## HTTP Endpoints

- `GET /` — JSON: status, bot_connected, bot_user, easypass_target_channel_id, wsz_target_channel_id, leslie_target_channel_id
- `GET /health` — JSON: status (healthy/starting), bot_latency (ping), timestamp

## Conventions

- Only one build at a time per flow (build lock passed as `options.buildState`).
- User-facing replies often mention the requesting user (`discordMessage.author`). Vietnamese used for user-facing messages. Some status messages (e.g. branch success, “Đang bắt đầu build…”) may omit the mention.
- New project flows: add a handler in **build_handlers/**, add env/channel routing in `index.js`, and call the handler with `{ buildState }` (handlers use `getGeminiService()` and env for project dir).
