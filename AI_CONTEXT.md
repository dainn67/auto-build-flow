# Auto Build Flow — AI Context

## Purpose

Automated app build tool: **receive user message → infer intent → generate build command/script → execute**. Triggered via Discord in target channel(s). Uses Gemini for intent detection and script generation; runs against a Flutter project (writes `apps.sh`, runs `build.sh`).

## Stack

- **Runtime:** Node (ESM)
- **Entry:** `index.js` — Discord bot + Express health server; routes messages by channel to handlers
- **AI:** Google Gemini (`@google/generative-ai`) for message → JSON (intent, script, command, branch, etc.)
- **Chat:** Discord.js; messages from non-bots in `EASYPASS_TARGET_CHANNEL_ID` or `WSZ_TARGET_CHANNEL_ID` are handled (each channel can use a different handler later)
- **Build host:** Flutter project dir per handler (e.g. `EASYPASS_PROJECT_DIR`); must have `apps.sh`, `build.sh`, credentials

## Architecture

- **index.js** registers a single `MessageCreate` listener: if channel is Easypass or WSZ, it calls the corresponding handler (currently both use the same Easypass handler). Handlers are in `handlers/` so different projects can plug in different flows.
- **Easypass flow:** `handlers/auto-build-easypass-handler.js` — `handleAutoBuildMessage(discordMessage)`. Uses `EASYPASS_PROJECT_DIR`, `prompts/auto-build-easypass-prompt.js`, and a shared Gemini service (injected via options when called; index currently passes only `discordMessage`).

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
     - Reply with `message`, replace `dir/apps.sh` with `script`, set build lock.
     - If `branch`: `checkoutBranch(branch, dir)`; on failure reply error, clear lock, return; on success reply “Đã chuyển sang nhánh”.
     - Send “Đang bắt đầu build…”, run `cd ${dir} && ./${command}` (e.g. `./build.sh a` or `./build.sh i`).
     - In `finally`: clear build lock.

## Intents (Gemini JSON)

- **intent:** `"build"` | `"check_version"` | `"none"`.
- **build:** `message` (short Vietnamese reply), `script` (full `apps.sh` content), `command` (e.g. `build.sh a` / `build.sh i`), optional `useLatestVersion` (bool), optional `branch` (exact name from list or user input).
- **check_version:** `checkVersionApps` (array of app names; empty or “all” → all apps), `checkVersionPlatform`: `"android"` | `"ios"` | `"all"`. No script/command.

Prompt and example JSON shape: `prompts/auto-build-easypass-prompt.js`. App list from `configs/app-configs.js`, script template from `configs/script-config.js`.

## Key Files

- **index.js** — Entry point. Discord client, single `MessageCreate` listener that routes by `channelId` to handlers (e.g. `handleAutoBuildEasypass`). Express health routes. Does not contain build logic.

- **handlers/auto-build-easypass-handler.js** — Easypass auto-build flow. Exports `handleAutoBuildMessage(discordMessage)`. Uses `EASYPASS_PROJECT_DIR`, intent dispatch (none / check_version / build), build lock, branch and version steps, writes `apps.sh`, runs build command. Contains `splitMessage`. Expects `geminiService` to be available (currently must be passed via options or global for correctness).

- **prompts/auto-build-easypass-prompt.js** — Builds the Gemini prompt: app list, branch list, intent rules, and JSON format example.

- **services/gemini-service.js** — Gemini client. `processMessage(prompt, { isJSON, schema })`, plus `generate`, `generateJSON`, `generateWithSchema`.

- **services/git-service.js** — `getRemoteBranches(dir)`, `checkoutBranch(branch, dir)` (fetch, reset, checkout, pull).

- **services/store-version-service.js** — Store version: CMS app config, Google Play internal track, App Store Connect TestFlight. Exports `getLatestVersionForApps`, `getVersionsReport`, `parseAppNamesFromScript`, `replaceVersionInScript`.

- **utils.js** — `replaceFileContent(path, content)`, `executeCommand(cmd)` (spawn, stream stdout/stderr, resolve with success, stdout, stderr, exitCode).

- **configs/app-configs.js** — List of app names (accuplacer, ase, asvab, etc.).

- **configs/script-config.js** — Example script snippet (VERSION, BUILD_NUMBER, LIST_APP) used in the prompt.

## Environment

- **Required:** `DISCORD_BOT_TOKEN`, `EASYPASS_TARGET_CHANNEL_ID`, `WSZ_TARGET_CHANNEL_ID`, `GEMINI_API_KEY`
- **Optional:** `GEMINI_MODEL` (default `gemini-3-flash-preview`), `HOST` (default `0.0.0.0`), `PORT` (default `8000`)
- **Per-handler:** Easypass handler uses `EASYPASS_PROJECT_DIR` (Flutter project path; no default in code).

## Build Script and Command

- **Written file:** `{EASYPASS_PROJECT_DIR}/apps.sh` — overwritten each build with Gemini-generated script (VERSION, BUILD_NUMBER, LIST_APP block).
- **Executed:** `./build.sh a` (Android) or `./build.sh i` (iOS); command string from Gemini.

Platform for “latest version” is inferred from command: contains `build.sh i` → iOS, else Android.

## Version Handling

- **Next build version:** `getLatestVersionForApps(appNames, dir, platform)` → fetches store versions (Google Play internal / TestFlight), takes max version/build across apps, increments (patch +1, build +1), returns `{ versionName, buildNumber }`. Then `replaceVersionInScript(script, versionName, buildNumber)`.
- **Report only:** `getVersionsReport(appNames, dir, platform)` for check_version intent; no increment. Platform `"all"` queries both Android and iOS.
- **store-version-service.js** uses: CMS API (app config map), Google Play (service account JWT), App Store Connect (Apple JWT from `ios_api_key/`). Project dir must have `service_account.json` and `ios_api_key/` for store lookups.

## Branch Handling

- Remote branches fetched once per message; passed into prompt so Gemini can return an exact branch name from the list.
- On build, if `branch` is set: `checkoutBranch` does `git reset --hard`, `checkout`, `pull origin branch`. Failure stops build and replies with error.

## HTTP Endpoints

- `GET /` — JSON: status, bot_connected, bot_user, easypass_target_channel_id, wsz_target_channel_id
- `GET /health` — JSON: status (healthy/starting), bot_latency (ping), timestamp

## Conventions

- Only one build at a time per flow (build lock in handler).
- Long Discord replies are split with `splitMessage(text, 1900)` at newlines when possible.
- User-facing replies often mention the requesting user (`discordMessage.author`). Vietnamese used for user-facing messages. Some status messages (e.g. branch success, “Đang bắt đầu build…”) may omit the mention.
- New project flows: add a handler in `handlers/`, add env/channel routing in `index.js`, and call the handler with the right options (channel id, project dir, geminiService, buildState).
