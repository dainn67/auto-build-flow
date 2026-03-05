import { executeCommand } from "../utils.js";
import { getGeminiService } from "../services/gemini-service.js";
import { createLesliePrompt } from "../prompts/leslie-build-prompt.js";

const defaultBuildState = { isBuilding: false };

/**
 * Leslie auto-build handler.
 *
 * Simpler flow:
 * - AI only checks whether the message is a build command.
 * - If yes, it returns a single shell command in `command` (including version & build number).
 * - If not, it returns an empty object or `command: null/undefined` and the handler does nothing.
 * - The handler prevents concurrent builds via a shared `buildState`.
 *
 * @param {import("discord.js").Message} discordMessage
 * @param {Object} options
 * @param {{ isBuilding: boolean }} options.buildState - Shared build lock
 * @param {string} options.flutterProjectDir - Optional override for LESLIE project dir
 */
export async function handleAutoBuildMessage(discordMessage, options = {}) {
    const buildState = options.buildState ?? defaultBuildState;
    const dir = options.flutterProjectDir || process.env.LESLIE_PROJECT_DIR;
    let locked = false;

    // Ignore messages from bots
    if (discordMessage.author.bot) {
        return;
    }

    if (!dir) {
        console.error("LESLIE_PROJECT_DIR is not configured.");
        try {
            await discordMessage.channel.send(
                `${discordMessage.author} ❌ LESLIE_PROJECT_DIR chưa được cấu hình trên server.`,
            );
        } catch (error) {
            console.error("Failed to send LESLIE_PROJECT_DIR missing message:", error);
        }
        return;
    }

    // Basic metadata (can be used in the prompt if needed later)
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

        const prompt = createLesliePrompt(metadata);

        const aiResponseObj = await geminiService.processMessage(prompt, {
            isJSON: true,
        });

        const botMessage = aiResponseObj?.message
        const command = aiResponseObj?.command;

        // If AI says it's not a build request, do nothing
        if (!command || typeof command !== "string" || command.trim() === "") {
            return;
        }

        // Prevent concurrent builds
        if (buildState.isBuilding) {
            try {
                await discordMessage.channel.send(
                    `${discordMessage.author} ⏳ Vui lòng chờ build LESLIE hiện tại hoàn tất.`,
                );
            } catch (error) {
                console.error("Failed to send build busy message for LESLIE:", error);
            }
            return;
        }

        buildState.isBuilding = true;
        locked = true;

        const trimmedCommand = command.trim();

        await discordMessage.channel.send(
            `${discordMessage.author}\n${botMessage}\nCommand: ${trimmedCommand}`,
        );

        const result = await executeCommand(`cd ${dir} && ${trimmedCommand}`);

        if (result.success) {
            await discordMessage.channel.send(
                `${discordMessage.author} ✅ Build LESLIE hoàn tất.\n${result.stdout ? "Output:\n```" + result.stdout.slice(0, 1800) + "```" : ""}`,
            );
        } else {
            await discordMessage.channel.send(
                `${discordMessage.author} ❌ Build LESLIE thất bại.\n${result.stderr ? "Error:\n```" + result.stderr.slice(0, 1800) + "```" : ""}`,
            );
        }
    } catch (error) {
        console.error("❌ Error in LESLIE handler:", error);
        try {
            await discordMessage.channel.send(
                `${discordMessage.author} ❌ Đã xảy ra lỗi khi xử lý yêu cầu build LESLIE.`,
            );
        } catch (replyError) {
            console.error("Failed to send LESLIE error message:", replyError);
        }
    } finally {
        if (locked) buildState.isBuilding = false;
    }
}

