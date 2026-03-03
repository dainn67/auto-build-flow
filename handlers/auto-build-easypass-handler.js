import { createMessagePrompt } from "../prompts/auto-build-prompt.js";
import { replaceFileContent, executeCommand } from "../utils.js";
import { getRemoteBranches, checkoutBranch } from "../services/git-service.js";
import { getGeminiService } from "../services/gemini-service.js";
import { getLatestVersionForApps, parseAppNamesFromScript, replaceVersionInScript, getVersionsReport } from "../services/store-version-service.js";

/**
 * Split a long message into smaller chunks respecting Discord's character limit.
 * Splits at newline boundaries when possible.
 */
function splitMessage(text, maxLength = 1900) {
  if (text.length <= maxLength) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf("\n", maxLength);
    if (splitAt === -1 || splitAt < maxLength / 2) splitAt = maxLength;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n/, "");
  }
  return chunks;
}

/**
 * Handle Discord MessageCreate for the auto-build flow.
 * @param {import("discord.js").Message} discordMessage
 * @param {Object} options
 * @param {string} options.targetChannelId - Channel ID to accept messages from (e.g. EASYPASS_TARGET_CHANNEL_ID)
 * @param {string} options.flutterProjectDir - Flutter project path (FLUTTER_PROJECT_DIR)
 * @param {import("../services/gemini-service.js").default} options.geminiService
 * @param {{ isBuilding: boolean }} options.buildState - Shared build lock; handler reads and mutates isBuilding
 */
export async function handleAutoBuildMessage(discordMessage) {
  let buildState = false;
  const dir = process.env.EASYPASS_PROJECT_DIR;

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
    const prompt = createMessagePrompt(metadata, branches);

    const aiResponseObj = await geminiService.processMessage(prompt, {
      isJSON: true,
    });

    const intent = aiResponseObj.intent;

    // If no intent
    if (!intent || intent === "none") return;

    // If intent is check_version, fetch and report store versions
    if (intent === "check_version") {
      const apps = aiResponseObj.checkVersionApps || [];
      const platform = aiResponseObj.checkVersionPlatform || "all";

      if (apps.length === 0) {
        await discordMessage.channel.send(`${discordMessage.author} ⚠️ Không tìm thấy app nào trong yêu cầu.`);
        return;
      }

      try {
        const report = await getVersionsReport(apps, dir, platform);
        const chunks = splitMessage(report, 1900);
        for (const chunk of chunks) {
          await discordMessage.channel.send(`${discordMessage.author}\n${chunk}`);
        }
      } catch (err) {
        console.error("❌ Failed to fetch versions:", err);
        await discordMessage.channel.send(`${discordMessage.author} ❌ Lỗi khi lấy version: ${err.message}`);
      }
      return;
    }

    // ── Intent: build ──

    if (buildState) {
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

    buildState = true;

    // ── Git checkout if branch is specified ──
    if (branch) {
      const branchResult = await checkoutBranch(branch, dir);

      if (!branchResult.success) {
        await discordMessage.channel.send(`${discordMessage.author} ❌ Lỗi chuyển nhánh: ${branchResult.message}`);
        buildState = false;
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
    buildState = false;
  }
}
