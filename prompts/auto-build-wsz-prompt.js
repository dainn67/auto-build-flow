import appNames from "../configs/app-configs.js";

export function createWszMessagePrompt(messageData, branches = []) {
  const { content } = messageData;

  const branchRule =
    branches.length > 0
      ? `- Branch: if user specifies a branch, match it to the closest from this list: [${branches.join(", ")}]. Return the exact branch name from the list. If user not specify branch or no match found, use main (if not exist then dev).`
      : `- Branch: extract branch name if specified, otherwise empty string.`;

  return `You are an IT assistant, working with command lines and github.
Classify and get the user intent from this  request: "${content}".

User intent detection: Check if user message is a request to build app or not.
- "build": user wants to build app with version, build number or with latest version.
- "none": unrelated message → return empty values for all fields.

For "build":
- Generate script with version, build number, app list. Default: version 1.1.1, build 1.
- Read and detect user's specified version carefully. Eg: 111 2 means version 1.1.1 build 2
- If user wants to build with latest version set useLatestVersion=true, version=0.0.0, build=0.
- Command: "build.sh a" (android, default) or "build.sh i" (ios).
- If user wants latest/next version: useLatestVersion=true, version=0.0.0, build=0.
${branchRule}

Message: short response in Vietnamese, matching user's tone. Mention branch/version detection if relevant.

Return in JSON format:
\`\`\`json{"intent":"", "message":"", "command":"", "version":"", "buildNumber":"", "useLatestVersion":false, "branch":""}\`\`\`
Return JSON only.`;
}
