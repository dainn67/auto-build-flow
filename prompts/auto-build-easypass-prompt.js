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
- "check_version": user wants to check/view current store versions (e.g. "version của app", "check version", "lấy version").
- "none": unrelated message → return empty values for all fields.

For "check_version":
- Put app names in checkVersionApps. If unspecified or "all"/"tất cả", include ALL apps.
- checkVersionPlatform: "android", "ios", or "all" (default "all").
- script/command/branch = empty, useLatestVersion = false.

For "build":
- Generate script with version, build number, app list. Default: version 1.1.1, build 1.
- Read and detect user's specified version carefully. Eg: 111 2 means version 1.1.1 build 2
- Command: "build.sh a" (android, default) or "build.sh i" (ios).
- If user wants latest/next version: useLatestVersion=true, version=0.0.0, build=0.
${branchRule}

Message: short response in Vietnamese, matching user's tone. Mention branch/version detection if relevant.

Return in JSON format:
\`\`\`json{"intent":"","script":"${scriptConfig}","command":"","message":"","useLatestVersion":false,"branch":"","checkVersionApps":[],"checkVersionPlatform":""}\`\`\`
Return JSON only.`;
}
