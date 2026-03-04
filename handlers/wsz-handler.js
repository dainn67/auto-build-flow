import { createWszMessagePrompt } from "../prompts/wsz-prompt.js";
import { executeCommand } from "../utils.js";
import { getRemoteBranches, checkoutBranch } from "../services/git-service.js";
import { getGeminiService } from "../services/gemini-service.js";
import { getLatestVersionForPackageId } from "../services/store-version-service.js";

const WSZ_APP_PACKAGE = "com.wsz.quizapp";
const defaultBuildState = { isBuilding: false };

/**
 * Handle Discord MessageCreate for the WSZ auto-build flow.
 * @param {import("discord.js").Message} discordMessage
 * @param {Object} options
 * @param {string} options.targetChannelId - Channel ID to accept messages from (e.g. WSZ_TARGET_CHANNEL_ID)
 * @param {string} options.flutterProjectDir - Flutter project path (WSZ_PROJECT_DIR)
 * @param {import("../services/gemini-service.js").default} options.geminiService
 * @param {{ isBuilding: boolean }} options.buildState - Shared build lock; handler reads and mutates isBuilding
 */
export async function handleAutoBuildMessage(discordMessage, options = {}) {
  const buildState = options.buildState ?? defaultBuildState;
  const dir = options.flutterProjectDir || process.env.WSZ_PROJECT_DIR;
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

    // ── Fetch remote branches for AI matching ──
    const branches = await getRemoteBranches(dir);

    // ── Single Gemini call: detect intent (build / check_version / none) ──
    const prompt = createWszMessagePrompt(metadata, branches);

    const aiResponseObj = await geminiService.processMessage(prompt, {
      isJSON: true,
    });

    const intent = aiResponseObj.intent;

    // If no intent
    if (!intent || intent === "none") return;

    // WSZ flow currently supports only "build" or "none"
    if (intent !== "build") return;

    // Builds are already in progress
    if (buildState.isBuilding) {
      try {
        await discordMessage.channel.send(`${discordMessage.author} ⏳ Vui lòng chờ build hiện tại hoàn tất.`);
      } catch (error) {
        console.error("Failed to send build busy message:", error);
      }
      return;
    }

    const botMessage = aiResponseObj.message;
    const command = aiResponseObj.command;
    const branch = aiResponseObj.branch;
    const useLatestVersion = aiResponseObj.useLatestVersion;
    let version = aiResponseObj.version;
    let buildNumber = aiResponseObj.buildNumber;

    buildState.isBuilding = true;
    locked = true;

    const botResponse = `${discordMessage.author}\n${botMessage}`;
    await discordMessage.channel.send(botResponse);

    // ── Auto-fetch latest store version if requested ──
    if (useLatestVersion) {
      try {
        const platform = command.includes("build.sh i") ? "ios" : "android";
        const storeVersion = await getLatestVersionForPackageId(WSZ_APP_PACKAGE, dir, platform);
        version = storeVersion.versionName;
        buildNumber = storeVersion.buildNumber;
        await discordMessage.channel.send(`Version tiếp theo: **${version}** (build ${buildNumber})`);
      } catch (err) {
        console.error("❌ Failed to fetch latest version:", err);
        await discordMessage.channel.send(`${discordMessage.author} ❌ Lỗi khi lấy version: ${err.message}`);
        return;
      }
    }

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
    await executeCommand(`cd ${dir} && ./${command} ${version} ${buildNumber}`);
    discordMessage.channel.send(`Build hoàn tất, xem trạng thái tại:\nhttps://appstoreconnect.apple.com/teams/ffd01a9b-8357-4f90-8f06-41ddd833612b/apps/6759789375/testflight/ios`);
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
