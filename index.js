import express from "express";
import dotenv from "dotenv";
import { getGeminiService } from "./services/gemini-service.js";
import { Client, GatewayIntentBits, Events } from "discord.js";
import { handleAutoBuildMessage as handleAutoBuildEasypass } from "./build_handlers/easypass-handler.js";
import { handleAutoBuildMessage as handleAutoBuildWsz } from "./build_handlers/wsz-handler.js";
import { handleAutoBuildMessage as handleAutoBuildLeslie } from "./build_handlers/leslie-handler.js";

// Load environment variables
dotenv.config();

// Configuration from environment variables
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const EASYPASS_TARGET_CHANNEL_ID = process.env.EASYPASS_TARGET_CHANNEL_ID;
const WSZ_TARGET_CHANNEL_ID = process.env.WSZ_TARGET_CHANNEL_ID;
const LESLIE_TARGET_CHANNEL_ID = process.env.LESLIE_TARGET_CHANNEL_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3-flash-preview";
const HOST = process.env.HOST || "0.0.0.0";
const PORT = parseInt(process.env.PORT || "8000", 10);

// Validate required environment variables
if (!DISCORD_BOT_TOKEN) throw new Error("DISCORD_BOT_TOKEN missing");

if (!EASYPASS_TARGET_CHANNEL_ID) throw new Error("EASYPASS_TARGET_CHANNEL_ID missing");

if (!WSZ_TARGET_CHANNEL_ID) throw new Error("WSZ_TARGET_CHANNEL_ID missing");

if (!LESLIE_TARGET_CHANNEL_ID) throw new Error("LESLIE_TARGET_CHANNEL_ID missing");

if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY missing");

// Initialize Gemini service (singleton; handlers use getGeminiService())
getGeminiService();
console.log(`Initialized Gemini service with model: ${GEMINI_MODEL}`);

// Discord client setup
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

// Bot ready state
let botReady = false;

// Shared build locks (prevent concurrent builds per flow)
const easypassBuildState = { isBuilding: false };
const wszBuildState = { isBuilding: false };
const leslieBuildState = { isBuilding: false };

// Discord bot event handlers
client.once(Events.ClientReady, (readyClient) => {
  botReady = true;
  console.log(`Discord bot logged in as ${readyClient.user.tag} (ID: ${readyClient.user.id})`);
  console.log(
    `Listening to channel IDs: easypass ${EASYPASS_TARGET_CHANNEL_ID}, wsz ${WSZ_TARGET_CHANNEL_ID}, leslie ${LESLIE_TARGET_CHANNEL_ID}`,
  );
});

client.on(Events.MessageCreate, async (discordMessage) => {
  if (discordMessage.channelId === EASYPASS_TARGET_CHANNEL_ID) {
    await handleAutoBuildEasypass(discordMessage, { buildState: easypassBuildState });
  } else if (discordMessage.channelId === WSZ_TARGET_CHANNEL_ID) {
    await handleAutoBuildWsz(discordMessage, { buildState: wszBuildState });
  } else if (LESLIE_TARGET_CHANNEL_ID && discordMessage.channelId === LESLIE_TARGET_CHANNEL_ID) {
    await handleAutoBuildLeslie(discordMessage, { buildState: leslieBuildState });
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
    easypass_target_channel_id: EASYPASS_TARGET_CHANNEL_ID,
    wsz_target_channel_id: WSZ_TARGET_CHANNEL_ID,
    leslie_target_channel_id: LESLIE_TARGET_CHANNEL_ID || null,
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
