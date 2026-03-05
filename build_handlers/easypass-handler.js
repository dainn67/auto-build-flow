import { createMessagePrompt } from "../prompts/easypass-build-prompt.js";
import { replaceFileContent, executeCommand } from "../utils.js";
import { getRemoteBranches, checkoutBranch } from "../services/git-service.js";
import { getGeminiService } from "../services/gemini-service.js";
import { getLatestVersionForApps, parseAppNamesFromScript, replaceVersionInScript } from "../services/store-service.js";
import { fetchAppConfig } from "../services/store-service.js";

const defaultBuildState = { isBuilding: false };

/**
 * Handle Discord MessageCreate for the auto-build flow.
 * @param {import("discord.js").Message} discordMessage
 * @param {Object} options
 * @param {string} options.targetChannelId - Channel ID to accept messages from (e.g. EASYPASS_TARGET_CHANNEL_ID)
 * @param {string} options.flutterProjectDir - Flutter project path (FLUTTER_PROJECT_DIR)
 * @param {import("../services/gemini-service.js").default} options.geminiService
 * @param {{ isBuilding: boolean }} options.buildState - Shared build lock; handler reads and mutates isBuilding
 */
export async function handleAutoBuildMessage(discordMessage, options = {}) {
  const buildState = options.buildState ?? defaultBuildState;
  const dir = options.flutterProjectDir || process.env.EASYPASS_PROJECT_DIR;
  let locked = false;

  // Ignore messages from bots
  if (discordMessage.author.bot) {
    return;
  }

  // Extract message metadata
  const metadata = {
    content: discordMessage.content,
    user_id: discordMessage.author.id,
    username: discordMessage.author.username,
    display_name: discordMessage.author.displayName || discordMessage.author.username,
    channel_id: discordMessage.channelId,
    channel_name: discordMessage.channel.name || "DM",
    message_id: discordMessage.id,
    timestamp: discordMessage.createdAt.toISOString(),
    server_id: discordMessage.guildId || null,
    server_name: discordMessage.guild?.name || null,
  };

  try {
    const geminiService = getGeminiService();
    const branches = await getRemoteBranches(dir);

    const prompt = createMessagePrompt(metadata, branches);
    const aiResponseObj = await geminiService.processMessage(prompt, {
      isJSON: true,
    });
    const intent = aiResponseObj.intent;

    if (!intent || intent === "none") return;

    if (intent === "submit") {
      const appNames = aiResponseObj.submitApps;
      if (appNames.length === 0) {
        await discordMessage.channel.send(`${discordMessage.author} ⚠️ Không tìm thấy app nào trong script.`);
        return;
      }

      const platform = aiResponseObj.platform;
      const command = aiResponseObj.command;
      const buildNumber = aiResponseObj.buildNumber;

      for (const appName of appNames) {
        const appConfig = await fetchAppConfig(appName);
        const packageName = appConfig.androidPackageName;
        const bundleId = appConfig.iosBundleId;

        const selectedPackageName = platform === "a" ? packageName : bundleId;
        const selectedBuildNumber = buildNumber > 0 ? `${buildNumber}` : "";

        await executeCommand(`cd ${dir} && ${command} ${selectedPackageName} ${selectedBuildNumber}`);
      }

      return;
    }

    if (buildState.isBuilding) {
      // Builds are already in progress
      try {
        await discordMessage.channel.send(`${discordMessage.author} ⏳ Vui lòng chờ build hiện tại hoàn tất.`);
      } catch (error) {
        console.error("Failed to send build busy message:", error);
      }
      return;
    }

    const botMessage = aiResponseObj.message;
    let script = aiResponseObj.script;
    const command = aiResponseObj.command;
    const useLatestVersion = aiResponseObj.useLatestVersion;
    const branch = aiResponseObj.branch;

    if (!botMessage || !script || !command) return;

    buildState.isBuilding = true;
    locked = true;

    // ── Auto-fetch latest store version if requested ──
    if (useLatestVersion) {
      try {
        const appNames = parseAppNamesFromScript(script);
        if (appNames.length === 0) {
          await discordMessage.channel.send(`${discordMessage.author} ⚠️ Không tìm thấy app nào trong script.`);
          return;
        }

        await discordMessage.channel.send(`${discordMessage.author} 🔍 Đang lấy version mới nhất cho: ${appNames.join(", ")}...`);

        // Detect platform from command: "build.sh a" → android, "build.sh i" → ios
        const platform = command.includes("build.sh i") ? "ios" : "android";

        const { versionName, buildNumber } = await getLatestVersionForApps(appNames, dir, platform);

        // Replace placeholder version in the script
        script = replaceVersionInScript(script, versionName, buildNumber);

        await discordMessage.channel.send(`${discordMessage.author} ✅ Version tiếp theo: **${versionName}** (build ${buildNumber})`);

        console.log(`✅ Auto-detected next version: ${versionName} (${buildNumber})`);
      } catch (err) {
        console.error("❌ Failed to fetch latest version:", err);
        await discordMessage.channel.send(`${discordMessage.author} ❌ Lỗi khi lấy version: ${err.message}`);
        return;
      }
    }

    const botResponse = `${discordMessage.author}\n${botMessage}`;
    await discordMessage.channel.send(botResponse);

    // Replace the app script
    await replaceFileContent(`${dir}/apps.sh`, script);

    // ── Git checkout if branch is specified ──
    if (branch) {
      const branchResult = await checkoutBranch(branch, dir);

      if (!branchResult.success) {
        await discordMessage.channel.send(`${discordMessage.author} ❌ Lỗi chuyển nhánh: ${branchResult.message}`);
        return;
      }

      await discordMessage.channel.send(`Đã chuyển sang nhánh **${branch}**`);
    }

    await discordMessage.channel.send(`Đang bắt đầu build...`);
    await executeCommand(`cd ${dir} && ./${command}`);
  } catch (error) {
    console.error(`❌ Error processing message with Gemini:`, error);

    try {
      await discordMessage.channel.send(`Sent fallback confirmation reply for message ${metadata.message_id}`);
    } catch (replyError) {
      console.error("Failed to send fallback reply:", replyError);
    }
  } finally {
    if (locked) buildState.isBuilding = false;
  }
}
