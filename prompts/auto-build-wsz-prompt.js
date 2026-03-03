export function createWszMessagePrompt(messageData, branches = []) {
  const { content } = messageData;

  const branchRule =
    branches.length > 0
      ? `- If user specifies a branch, find the closest branch from the list: [${branches.join(", ")}]. Return the exact branch name, default is main (or dev if main not exist).`
      : `- Leave branch empty if not specified.`;

  return `You are an IT assistant, working with command lines and github.
Classify and get the user intent from this  request: "${content}".

User intent detection: Check if user message is a request to build app or not.
- "build": user wants to build the app, they may specify version and build number, or by default use latest version.
- "none": unrelated message → return intent none and empty values for all fields.

For user wants to build the app:
- Return the selected version, build number or latest version. Default is version 1.1.1, build 1.
- Read and detect user's specified version carefully. Eg: 111 2 means version 1.1.1 build 2
- If user wants to build with latest version set useLatestVersion=true, version=0.0.0, build=0.
- Command: "build.sh i" (ios, default) or "build.sh a" (android).
${branchRule}

Give a short response in user's language, matching user's tone. Mention branch/version detection if relevant.

Return in JSON format only:
\`\`\`json{"intent":"", "message":"", "command":"", "version":"", "buildNumber":"", "useLatestVersion":false, "branch":""}\`\`\``;
}
