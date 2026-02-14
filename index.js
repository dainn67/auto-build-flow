import { Client, GatewayIntentBits, Events } from "discord.js";
import express from "express";
import dotenv from "dotenv";
import GeminiService from "./services/gemini.js";
import { createMessagePrompt } from "./prompts/auto-build-prompt.js";

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

client.on(Events.MessageCreate, async (message) => {
  // Ignore messages from bots
  if (message.author.bot) {
    return;
  }

  // Only process messages from the target channel
  if (message.channelId !== TARGET_CHANNEL_ID) {
    return;
  }

  // Extract message metadata
  const metadata = {
    content: message.content,
    user_id: message.author.id,
    username: message.author.username,
    display_name: message.author.displayName || message.author.username,
    channel_id: message.channelId,
    channel_name: message.channel.name || "DM",
    message_id: message.id,
    timestamp: message.createdAt.toISOString(),
    server_id: message.guildId || null,
    server_name: message.guild?.name || null,
  };

  // Log the message details
  console.log("=".repeat(20));
  console.log("MESSAGE RECEIVED:");
  console.log(`  Content: ${metadata.content}`);
  console.log(`  User ID: ${metadata.user_id}`);
  console.log(`  Username: ${metadata.username}`);
  console.log(`  Display Name: ${metadata.display_name}`);
  console.log(`  Channel ID: ${metadata.channel_id}`);
  console.log(`  Channel Name: ${metadata.channel_name}`);
  console.log(`  Message ID: ${metadata.message_id}`);
  console.log(`  Timestamp: ${metadata.timestamp}`);
  console.log(`  Server ID: ${metadata.server_id}`);
  console.log(`  Server Name: ${metadata.server_name}`);
  console.log("=".repeat(20));

  try {
    // Create prompt from message
    const prompt = createMessagePrompt(metadata);

    // Get AI analysis
    const aiResponse = await geminiService.processMessage(prompt);

    // Reply to confirm receipt with AI insight
    const replyMessage = `💭 ${message.author}: ${JSON.stringify(aiResponse)}`;
    await message.channel.send(replyMessage);
  } catch (error) {
    console.error(`❌ Error processing message with Gemini:`, error);

    // Fallback: send simple confirmation
    try {
      await message.channel.send(`✅ Message received from ${message.author}`);
      console.log(
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
