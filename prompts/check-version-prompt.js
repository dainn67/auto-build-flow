import appNames from "../configs/app-configs.js";

export function createCheckVersionPrompt(messageData) {
    const { content } = messageData;

    return `You are an IT assistant. Your job is to determine if the user wants to check/view the current version of apps on the store.
This is the full app list: ${appNames.join(", ")}.
This is the user request: "${content}"

Rules:
1. Determine if the user is asking to check/view the version of apps on the store.
   Examples of such requests: "version của các app", "check version", "lấy version trên store", "xem version hiện tại", "version bao nhiêu rồi", "list version", etc.
2. If this is NOT a request to check app versions (e.g. it's a build request, normal message, or unrelated), return:
   {"isCheckVersion": false, "apps": [], "platform": "all", "message": ""}
3. If it IS a version check request:
   - Extract the specific apps the user wants to check. If the user says "all" or "tất cả" or doesn't specify any app, include ALL apps from the list.
   - Determine the platform: "android", "ios", or "all" (check both). Default is "all".
   - Write a short confirmation message matching the tone of the user request.
4. Return the data in the following JSON format:
\`\`\`json{"isCheckVersion": true, "apps": ["app1", "app2"], "platform": "all", "message": "Your message"}\`\`\`
Return in that format only, no additional text.`;
}
