import appNames from "../configs/app_configs.js";

export function createMessagePrompt(messageData) {
  const { content } = messageData;

  return `You are an assistant in selecting apps, versions, build numbers from user request and a provided app list.
This is the app list: ${appNames.join(", ")}.
This is the user request: "${content}"
From the user request, filter and select the apps, their version and build number user want and return in JSON format following this structure: {"apps": [], "version": "1.1.1+1"}.
Return ONLY valid JSON, no additional text.`;
}
