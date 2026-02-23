import appNames from "../configs/app-configs.js";
import scriptConfig from "../configs/script-config.js";

export function createMessagePrompt(messageData) {
  const { content } = messageData;

  return `You are an IT assistant in building apps. Your job is to select apps, versions, build numbers and generate build command from user request and a provided app list.
This is the app list: ${appNames.join(", ")}.
This is the user request: "${content}"
From the user request, filter and select the apps, their version and build number user want and generate build command.
Rules:
Write a short reponse to user, saying you are building the apps with that version and build number.
If user doesn't specify platform, the command is build.sh a u.
Otherwise, the command is "build.sh a u" or "build.sh i" (a for android and i for ios, only android has "u" postfix).
If no app or only one app is provided, generate the empty list or a list with only one element: () or (app_name)
If no version or build number is provided, use version 1.1.1, build number 1.
Return the data, with your response following this JSON format template:
\`\`\`json{"script": "${scriptConfig}", "command": "Your build command", "message": "Your message"}\`\`\`
Return in that format only, no additional text.`;
}
