import express from "express";
import dotenv from "dotenv";
import GeminiService from "./services/gemini.js";
import { Client, GatewayIntentBits, Events } from "discord.js";
import { createMessagePrompt } from "./prompts/auto-build-prompt.js";
import { replaceFileContent, executeCommand } from "./utils.js";
import { getRemoteBranches, checkoutBranch } from "./services/branch.js";
import {
  getLatestVersionForApps,
  parseAppNamesFromScript,
  replaceVersionInScript,
  getVersionsReport,
} from "./services/store-version.js";

// Load environment variables
dotenv.config();

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


// Configuration from environment variables
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const TARGET_CHANNEL_ID = process.env.TARGET_CHANNEL_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3-flash-preview";
const HOST = process.env.HOST || "0.0.0.0";
const PORT = parseInt(process.env.PORT || "8000", 10);

// Validate required environment variables
if (!DISCORD_BOT_TOKEN) {
  throw new Error("DISCORD_BOT_TOKEN environment variable is required");
}
if (!TARGET_CHANNEL_ID) {
  throw new Error("TARGET_CHANNEL_ID environment variable is required");
}
if (!GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY environment variable is required");
}

// Initialize Gemini service
const geminiService = new GeminiService(GEMINI_API_KEY, GEMINI_MODEL);
console.log(`Initialized Gemini service with model: ${GEMINI_MODEL}`);

// Discord client setup
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Bot ready state
let botReady = false;

// Build state
let isBuilding = false;

// Discord bot event handlers
client.once(Events.ClientReady, (readyClient) => {
  botReady = true;
  console.log(
    `Discord bot logged in as ${readyClient.user.tag} (ID: ${readyClient.user.id})`,
  );
  console.log(`Listening to channel ID: ${TARGET_CHANNEL_ID}`);
});

client.on(Events.MessageCreate, async (discordMessage) => {
  // Ignore messages from bots
  if (discordMessage.author.bot) {
    return;
  }

  // Only process messages from the target channel
  if (discordMessage.channelId !== TARGET_CHANNEL_ID) {
    return;
  }

  // Extract message metadata
  const metadata = {
    content: discordMessage.content,
    user_id: discordMessage.author.id,
    username: discordMessage.author.username,
    display_name:
      discordMessage.author.displayName || discordMessage.author.username,
    channel_id: discordMessage.channelId,
    channel_name: discordMessage.channel.name || "DM",
    message_id: discordMessage.id,
    timestamp: discordMessage.createdAt.toISOString(),
    server_id: discordMessage.guildId || null,
    server_name: discordMessage.guild?.name || null,
  };

  // console.log(
  //   [
  //     `  Content: ${metadata.content}`,
  //     `  User ID: ${metadata.user_id}`,
  //     `  Username: ${metadata.username}`,
  //     `  Display Name: ${metadata.display_name}`,
  //     `  Channel ID: ${metadata.channel_id}`,
  //     `  Channel Name: ${metadata.channel_name}`,
  //     `  Message ID: ${metadata.message_id}`,
  //     `  Timestamp: ${metadata.timestamp}`,
  //     `  Server ID: ${metadata.server_id}`,
  //     `  Server Name: ${metadata.server_name}`,
  //   ].join("\n"),
  // );

  // Flutter project directory (contains credentials & build scripts)
  const dir =
    process.env.FLUTTER_PROJECT_DIR ||
    "/Users/dainguyen/StudioProjects/abc-adaptive-learning-app";

  try {
    // ── Fetch remote branches for AI matching ──
    const branches = await getRemoteBranches(dir);

    // ── Single Gemini call: detect intent (build / check_version / none) ──
    const prompt = createMessagePrompt(metadata, branches);

    const aiResponseObj = await geminiService.processMessage(prompt, {
      isJSON: true,
    });

    const intent = aiResponseObj.intent;

    // ── Intent: none → ignore ──
    if (!intent || intent === "none") {
      return;
    }

    // ── Intent: check_version → fetch & report store versions ──
    if (intent === "check_version") {
      const apps = aiResponseObj.checkVersionApps || [];
      const platform = aiResponseObj.checkVersionPlatform || "all";
      const cvMessage = aiResponseObj.message;

      if (apps.length === 0) {
        await discordMessage.channel.send(
          `${discordMessage.author} ⚠️ Không tìm thấy app nào trong yêu cầu.`,
        );
        return;
      }

      try {
        const report = await getVersionsReport(apps, dir, platform);
        const chunks = splitMessage(report, 1900);
        for (const chunk of chunks) {
          await discordMessage.channel.send(
            `${discordMessage.author}\n${chunk}`,
          );
        }
      } catch (err) {
        console.error("❌ Failed to fetch versions:", err);
        await discordMessage.channel.send(
          `${discordMessage.author} ❌ Lỗi khi lấy version: ${err.message}`,
        );
      }
      return;
    }

    // ── Intent: build ──
    const botMessage = aiResponseObj.message;
    let script = aiResponseObj.script;
    const command = aiResponseObj.command;
    const useLatestVersion = aiResponseObj.useLatestVersion;
    const branch = aiResponseObj.branch;

    if (!botMessage || !script || !command) {
      return;
    }

    // ── Auto-fetch latest store version if requested ──
    if (useLatestVersion) {
      try {
        const appNames = parseAppNamesFromScript(script);
        if (appNames.length === 0) {
          await discordMessage.channel.send(
            `${discordMessage.author} ⚠️ Không tìm thấy app nào trong script.`,
          );
          return;
        }

        await discordMessage.channel.send(
          `${discordMessage.author} 🔍 Đang lấy version mới nhất cho: ${appNames.join(", ")}...`,
        );

        // Detect platform from command: "build.sh a" → android, "build.sh i" → ios
        const platform = command.includes("build.sh i") ? "ios" : "android";

        const { versionName, buildNumber } = await getLatestVersionForApps(
          appNames,
          dir,
          platform,
        );

        // Replace placeholder version in the script
        script = replaceVersionInScript(script, versionName, buildNumber);

        await discordMessage.channel.send(
          `${discordMessage.author} ✅ Version tiếp theo: **${versionName}** (build ${buildNumber})`,
        );

        console.log(
          `✅ Auto-detected next version: ${versionName} (${buildNumber})`,
        );
      } catch (err) {
        console.error("❌ Failed to fetch latest version:", err);
        await discordMessage.channel.send(
          `${discordMessage.author} ❌ Lỗi khi lấy version: ${err.message}`,
        );
        return;
      }
    }

    // Check if a build is already in progress
    if (isBuilding) {
      try {
        await discordMessage.channel.send(
          `${discordMessage.author} ⏳ Vui lòng chờ build hiện tại hoàn tất.`,
        );
      } catch (error) {
        console.error("Failed to send build busy message:", error);
      }
      return;
    }

    const botResponse = `${discordMessage.author}\n${botMessage}`;
    await discordMessage.channel.send(botResponse);



    // Replace the app script
    await replaceFileContent(`${dir}/apps.sh`, script);

    isBuilding = true;

    // ── Git checkout if branch is specified ──
    if (branch) {
      await discordMessage.channel.send(
        `${discordMessage.author} 🔀 Đang chuyển sang nhánh: **${branch}**...`,
      );

      const branchResult = await checkoutBranch(branch, dir);

      if (!branchResult.success) {
        await discordMessage.channel.send(
          `${discordMessage.author} ❌ Lỗi chuyển nhánh: ${branchResult.message}`,
        );
        isBuilding = false;
        return;
      }

      await discordMessage.channel.send(
        `${discordMessage.author} ✅ Đã chuyển sang nhánh **${branch}**`,
      );
    }

    await discordMessage.channel.send(
      `${discordMessage.author} 🔨 Đang bắt đầu build...`,
    );
    await executeCommand(`cd ${dir} && ./${command}`);
  } catch (error) {
    console.error(`❌ Error processing message with Gemini:`, error);

    try {
      await discordMessage.channel.send(
        `Sent fallback confirmation reply for message ${metadata.message_id}`,
      );
    } catch (replyError) {
      console.error(`Failed to send fallback reply:`, replyError);
    }
  } finally {
    isBuilding = false;
  }
});

client.on(Events.Error, (error) => {
  console.error("Discord client error:", error);
});

// Start Discord bot
console.log("Starting Discord bot...");
client.login(DISCORD_BOT_TOKEN).catch((error) => {
  console.error("Failed to login to Discord:", error);
});

// Express app setup
const app = express();

app.get("/", (req, res) => {
  res.json({
    status: "running",
    bot_connected: botReady,
    bot_user: client.user?.tag || null,
    target_channel_id: TARGET_CHANNEL_ID,
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: botReady ? "healthy" : "starting",
    bot_latency: botReady ? Math.round(client.ws.ping) : null,
    timestamp: new Date().toISOString(),
  });
});

// Start Express server
app.listen(PORT, HOST, () => {
  console.log(`Express server running on http://${HOST}:${PORT}`);
});

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\nShutting down...");
  client.destroy();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\nShutting down...");
  client.destroy();
  process.exit(0);
});
