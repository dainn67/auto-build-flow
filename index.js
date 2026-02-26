import express from "express";
import dotenv from "dotenv";
import GeminiService from "./services/gemini.js";
import { Client, GatewayIntentBits, Events } from "discord.js";
import { createMessagePrompt } from "./prompts/auto-build-prompt.js";
import { replaceFileContent, executeCommand } from "./utils.js";
import {
  getLatestVersionForApps,
  parseAppNamesFromScript,
  replaceVersionInScript,
} from "./services/store-version.js";

// Load environment variables
dotenv.config();

// Configuration from environment variables
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const TARGET_CHANNEL_ID = process.env.TARGET_CHANNEL_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash-001";
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

  try {
    // Create prompt from message
    const prompt = createMessagePrompt(metadata);

    // Define JSON schema for structured output
    const responseSchema = {
      type: "object",
      properties: {
        script: {
          type: "string",
          description:
            "The build script content with version, build number, and app list",
        },
        command: {
          type: "string",
          description: "The build command to execute",
        },
        message: {
          type: "string",
          description: "A short response message to the user",
        },
        useLatestVersion: {
          type: "boolean",
          description:
            "Whether to auto-fetch the latest version from the store and increment it",
        },
        branch: {
          type: "string",
          description:
            "Git branch name to checkout before building. Empty string means stay on current branch.",
        },
      },
      required: ["script", "command", "message", "useLatestVersion", "branch"],
    };

    // Get AI analysis with structured JSON output
    const aiResponseObj = await geminiService.processMessage(prompt, {
      schema: responseSchema,
    });

    const botMessage = aiResponseObj.message;
    let script = aiResponseObj.script;
    const command = aiResponseObj.command;
    const useLatestVersion = aiResponseObj.useLatestVersion;
    const branch = aiResponseObj.branch;

    if (!aiResponseObj || !botMessage || !script || !command) {
      return;
    }

    // Flutter project directory (contains credentials & build scripts)
    const dir =
      process.env.FLUTTER_PROJECT_DIR ||
      "/Users/dainguyen/StudioProjects/abc-adaptive-learning-app";
    // const dir = "/Users/abc-submit/StudioProjects/practice-test-app";

    // ── Auto-fetch latest store version if requested ──
    if (useLatestVersion) {
      try {
        const appNames = parseAppNamesFromScript(script);
        if (appNames.length === 0) {
          await discordMessage.channel.send(
            `${discordMessage.author} ⚠️ Could not detect app names from the script.`,
          );
          return;
        }

        await discordMessage.channel.send(
          `${discordMessage.author} 🔍 Fetching latest version from stores for: ${appNames.join(", ")}...`,
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
          `${discordMessage.author} ✅ Detected next version: **${versionName}** (build ${buildNumber})`,
        );

        console.log(
          `✅ Auto-detected next version: ${versionName} (${buildNumber})`,
        );
      } catch (err) {
        console.error("❌ Failed to fetch latest version:", err);
        await discordMessage.channel.send(
          `${discordMessage.author} ❌ Failed to detect latest store version: ${err.message}`,
        );
        return;
      }
    }

    // Check if a build is already in progress
    if (isBuilding) {
      try {
        await discordMessage.channel.send(
          `${discordMessage.author} ⏳ Please wait for the current build to finish.`,
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
        `${discordMessage.author} 🔀 Switching to branch: **${branch}**...`,
      );

      // Fetch latest remote branches
      await executeCommand(`cd ${dir} && git fetch origin`);

      // Try exact checkout first
      let checkoutResult = await executeCommand(
        `cd ${dir} && git checkout ${branch} && git pull origin ${branch}`,
      );

      // If exact match fails, try fuzzy search on remote branches
      if (!checkoutResult.success) {
        // Build search patterns: original, spaces→underscores, spaces→hyphens, no spaces
        const patterns = [
          ...new Set([
            branch,
            branch.replace(/\s+/g, "_"),
            branch.replace(/\s+/g, "-"),
            branch.replace(/\s+/g, ""),
          ]),
        ];

        let candidates = [];
        for (const pattern of patterns) {
          const searchResult = await executeCommand(
            `cd ${dir} && git branch -r | grep -i "${pattern}" | sed 's|origin/||' | xargs`,
          );
          const found = (searchResult.stdout || "")
            .trim()
            .split(/\s+/)
            .filter(Boolean);
          candidates.push(...found);
        }
        // Deduplicate
        candidates = [...new Set(candidates)];

        if (candidates.length === 1) {
          // Found exactly one match → use it
          const matched = candidates[0];
          await discordMessage.channel.send(
            `${discordMessage.author} 🔍 Branch **${branch}** not found, using match: **${matched}**`,
          );
          checkoutResult = await executeCommand(
            `cd ${dir} && git checkout ${matched} && git pull origin ${matched}`,
          );
        } else if (candidates.length > 1) {
          // Multiple matches → ask user to be more specific
          await discordMessage.channel.send(
            `${discordMessage.author} ⚠️ Multiple branches match "**${branch}**":\n${candidates.map((c) => `• \`${c}\``).join("\n")}\nPlease specify the full branch name.`,
          );
          isBuilding = false;
          return;
        }
      }

      if (!checkoutResult.success) {
        await discordMessage.channel.send(
          `${discordMessage.author} ❌ Failed to checkout branch **${branch}**: ${checkoutResult.stderr || checkoutResult.message}`,
        );
        isBuilding = false;
        return;
      }
    }

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
