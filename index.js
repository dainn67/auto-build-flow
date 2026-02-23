import express from "express";
import dotenv from "dotenv";
import GeminiService from "./services/gemini.js";
import { Client, GatewayIntentBits, Events } from "discord.js";
import { createMessagePrompt } from "./prompts/auto-build-prompt.js";
import { replaceFileContent, executeCommand } from "./utils.js";

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

  // Log the message details
  // console.log(
  //   [
  //     "=".repeat(20),
  //     "MESSAGE RECEIVED:",
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
  //     "=".repeat(20),
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
      },
      required: ["script", "command", "message"],
    };

    // Get AI analysis with structured JSON output
    const aiResponseObj = await geminiService.processMessage(prompt, {
      schema: responseSchema,
    });

    const botMessage = aiResponseObj.message;
    const script = aiResponseObj.script;
    const command = aiResponseObj.command;

    if (!aiResponseObj || !botMessage || !script || !command) {
      return;
    }

    const botResponse = `${discordMessage.author}\n${botMessage}`;
    await discordMessage.channel.send(botResponse);

    // const dir = "/Users/dainguyen/StudioProjects/abc-adaptive-learning-app";
    const dir = "/Users/abc-submit/StudioProjects/practice-test-app";

    // Replace the app script
    try {
      const result = await replaceFileContent(`${dir}/apps.sh`, script);
      console.log(result);
    } catch (error) {
      console.error(error.message);
    }

    await executeCommand(`cd ${dir} && ./${command}`);
  } catch (error) {
    console.error(`❌ Error processing message with Gemini:`, error);

    // Fallback: send simple confirmation
    try {
      await discordMessage.channel.send(
        `Sent fallback confirmation reply for message ${metadata.message_id}`,
      );
    } catch (replyError) {
      console.error(`Failed to send fallback reply:`, replyError);
    }
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
