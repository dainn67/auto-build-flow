# Discord Message Relay with Gemini AI

A minimal Express backend service that connects to Discord using a bot token, listens to messages from a specific channel, and processes them using Google's Gemini AI.

## Features

- 🤖 Discord bot integration with message listening
- 🧠 Gemini 3 Flash AI processing for message analysis
- 📊 Automatic message categorization and sentiment analysis
- 💬 AI-powered responses in Discord
- 📝 Structured prompt management
- 🔧 RESTful API endpoints for health checks
- ⚙️ Fully configurable via environment variables

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Copy `env.example` to `.env` and fill in your values:

```bash
cp env.example .env
```

Edit `.env` with your tokens and IDs:

```env
DISCORD_BOT_TOKEN=your_actual_bot_token_here
TARGET_CHANNEL_ID=123456789012345678
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-3-flash-preview
HOST=0.0.0.0
PORT=8080
```

### Getting Required Credentials

#### Discord Bot Token & Channel ID

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application or select existing one
3. Go to "Bot" section
4. Click "Reset Token" or "Copy" to get your bot token
5. Enable "Message Content Intent" under Privileged Gateway Intents
6. Invite bot to your server using OAuth2 URL Generator
7. Enable Developer Mode in Discord (User Settings → Advanced → Developer Mode)
8. Right-click on the channel you want to monitor and click "Copy Channel ID"

#### Gemini API Key

1. Go to [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Sign in with your Google account
3. Click "Create API Key"
4. Copy the generated API key

## Running the Application

### Development mode (with auto-reload)

```bash
npm run dev
```

### Production mode

```bash
npm start
```

## Project Structure

```
.
├── index.js                    # Main application entry point
├── services/
│   └── gemini.js              # Gemini AI service module
├── prompts/
│   └── message-processor.js   # Prompt templates for AI
├── package.json               # Dependencies and scripts
├── .env                       # Environment variables (create from .env.example)
└── env.example                # Environment variables template
```

## API Endpoints

### `GET /`
Basic status check

**Response:**
```json
{
  "status": "running",
  "bot_connected": true,
  "bot_user": "YourBot#1234",
  "target_channel_id": "123456789012345678"
}
```

### `GET /health`
Detailed health check with bot latency

**Response:**
```json
{
  "status": "healthy",
  "bot_latency": 234,
  "timestamp": "2026-02-14T11:12:10.173Z"
}
```

## How It Works

1. **Discord Message Received**: Bot listens to messages in the configured channel
2. **Message Processing**: Message metadata is extracted and logged
3. **AI Analysis**: Message is sent to Gemini AI with structured prompt
4. **JSON Response**: Gemini returns analysis including:
   - Message analysis
   - Sentiment (positive/neutral/negative)
   - Suggested action
   - Category (question/statement/command/greeting/other)
   - Key points
   - Response suggestion
5. **Discord Reply**: Bot sends AI-powered response back to Discord channel

## Example Output

### Console Log

```
================================================================================
MESSAGE RECEIVED:
  Content: Hello, how are you?
  User ID: 123456789012345678
  Username: john_doe
  Display Name: John Doe
  Channel ID: 987654321098765432
  Channel Name: general
  Message ID: 111222333444555666
  Timestamp: 2026-02-14T12:34:56.789Z
  Server ID: 999888777666555444
  Server Name: My Discord Server
================================================================================

📤 Processing message with Gemini AI...
🤖 Sending prompt to Gemini (gemini-3-flash-preview)...
Prompt length: 453 characters
✅ Received response from Gemini
Response length: 287 characters
✅ Successfully parsed JSON response

================================================================================
🤖 GEMINI AI RESPONSE:
{
  "analysis": "Casual greeting with health inquiry",
  "sentiment": "positive",
  "suggested_action": "Respond with friendly greeting",
  "category": "greeting",
  "key_points": ["greeting", "health inquiry", "social interaction"],
  "response_suggestion": "Hello! I'm doing great, thank you for asking!"
}
================================================================================
```

### Discord Reply

```
✅ Message received from @john_doe

📊 Analysis: Casual greeting with health inquiry
💭 Sentiment: positive
🏷️ Category: greeting
```

## Utility Functions (utils.js)

The project includes utility functions for file operations and command execution.

### Usage

```javascript
const { replaceFileContent, executeCommand } = require('./utils.js');

// Example 1: Replace file content
async function updateFile() {
  try {
    const result = await replaceFileContent('./output.txt', 'New content here');
    console.log(result); // ✅ File updated successfully: ./output.txt
  } catch (error) {
    console.error(error.message);
  }
}

// Example 2: Execute shell command
async function runCommand() {
  const result = await executeCommand('ls -la');
  console.log(result.message); // ✅ Command executed successfully: ls -la
  console.log(result.stdout);  // Command output
}
```

### Available Functions

#### `replaceFileContent(filePath, newContent)`
Replaces the entire content of a file with the provided string.

**Parameters:**
- `filePath` (string) - Path to the file
- `newContent` (string) - New content to write

**Returns:** Promise with success message

#### `executeCommand(command)`
Executes a shell command and returns the output.

**Parameters:**
- `command` (string) - Command to execute

**Returns:** Promise with object containing:
- `success` (boolean) - Whether command succeeded
- `stdout` (string) - Standard output
- `stderr` (string) - Error output
- `message` (string) - Status message
- `exitCode` (number) - Exit code (only on failure)

## Technologies Used

- **Node.js** - JavaScript runtime
- **Express** - Web framework
- **discord.js** - Discord API wrapper
- **@google/generative-ai** - Google Gemini AI SDK
- **dotenv** - Environment variable management

## License

ISC
