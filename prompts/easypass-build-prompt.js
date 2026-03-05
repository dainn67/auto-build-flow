import appNames from "../configs/app-configs.js";
import scriptConfig from "../configs/script-config.js";

export function createMessagePrompt(messageData, branches = []) {
  const { content } = messageData;

  const branchRule =
    branches.length > 0
      ? `- Branch: if user specifies a branch, match it to the closest from this list: [${branches.join(", ")}]. Return the exact branch name from the list. If no match found, return the user's input as-is. If not specified, empty string.`
      : `- Branch: extract branch name if specified, otherwise empty string.`;

  return `You are an IT assistant, working with apps and github.
Classify and get the user intent from this  request: "${content}".
This is the provided app list: ${appNames.join(", ")}.

User intent detection:
- "build": user wants to build apps with version/build number.
- "submit": user wants to submit or release apps to production.
- "none": unrelated message → return empty values for all fields.

For "submit":
- User may specify app names and build number.
- Find the app name in the provided list and put app names in submitApps and build number in buildNumber.
- If no app specified, return empty array. If no build number specified, use build number 0.
- platform: a for android, i for ios, default is a.
- Command: python3 submit_android.py or python3 submit_ios.py.

For "build": 
- Generate script with version, build number, app list. Default: version 1.1.1, build 1.
- Read and detect user's specified version carefully. Eg: 111 2 means version 1.1.1 build 2
- Command: "build.sh a" (android, default) or "build.sh i" (ios).
- If user wants latest/next version: useLatestVersion=true, version=0.0.0, build=0.
${branchRule}

Message: short response in Vietnamese, matching user's tone. Mention branch/version detection if relevant.

Return in JSON format:
\`\`\`json{"intent":"","script":"${scriptConfig}","command":"","message":"","useLatestVersion":false,"branch":"","submitApps":[],"platform":"","buildNumber":""}\`\`\`
Return JSON only.`;
}

/**
 * Build prompt for resolving a possibly-typoed app name to an exact config key.
 * @param {string} appName - User input (may have typo)
 * @param {string[]} validKeys - All keys from the config map
 * @returns {string} - Prompt for Gemini; response must be JSON with "matchedKey" (exact key from list)
 */
export function createResolveAppNamePrompt(appName, validKeys) {
  return `You are a strict matcher. Given a user-provided app name (may contain typos or different casing) and a list of valid exact keys, return the single key from the list that best matches the user input.

Valid keys (return exactly one of these, unchanged): ${validKeys.join(", ")}

User input: "${appName}"

Return JSON only, with one field "matchedKey" set to the exact key from the list above. If no reasonable match, pick the closest. Example: {"matchedKey":"asvab"}`;
}
