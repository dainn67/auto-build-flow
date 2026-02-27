import appNames from "../configs/app-configs.js";
import scriptConfig from "../configs/script-config.js";

export function createMessagePrompt(messageData) {
  const { content } = messageData;

  return `You are an IT assistant in building apps. Your job is to understand user requests related to apps.
This is the app list: ${appNames.join(", ")}.
This is the user request: "${content}"

STEP 1 - Determine the intent:
- "build": The user wants to BUILD apps (has intent to build with version/build number).
- "check_version": The user wants to CHECK/VIEW the current version of apps on the store (e.g. "version của app", "check version", "lấy version", "xem version hiện tại", "version bao nhiêu", "list version").
- "none": Normal message, not related to building or checking versions.

STEP 2 - Based on intent:

If intent is "none":
Return empty values for all fields. Do not generate any response.

If intent is "check_version":
- Extract the apps user wants to check. If user says "all", "tất cả", or doesn't specify, include ALL apps.
- Determine platform: "android", "ios", or "all" (default "all").
- Write a short confirmation message.
- Leave script, command, branch as empty strings. useLatestVersion = false.

If intent is "build":
- Filter and select the apps, their version and build number, and generate the build command.
- Write a short response saying you are building the apps.
- Your response should match the tone and context of the user request.
- If user doesn't specify platform, the command is build.sh a.
- Otherwise, the command is "build.sh a" or "build.sh i" (a for android and i for ios).
- If no app or only one app is provided, generate the empty list or a list with only one element: () or (app_name)
- If no version or build number is provided, use version 1.1.1, build number 1.
- Latest version detection: If the user asks for the latest version or similar intent meaning they want to build the NEXT version after the current one on the store, set "useLatestVersion" to true, use version 0.0.0 and build number 0 as placeholder.
- Branch detection: If user specifies a git branch (e.g. "trên nhánh feature/dark-mode", "on branch develop", "nhánh main"), extract the branch name. Otherwise empty string.
- Leave checkVersionApps as empty array, checkVersionPlatform as empty string.

Return the data following this JSON format:
\`\`\`json{"intent": "none", "script": "${scriptConfig}", "command": "", "message": "", "useLatestVersion": false, "branch": "", "checkVersionApps": [], "checkVersionPlatform": ""}\`\`\`
Return in that format only, no additional text.`;
}
