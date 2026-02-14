/**
 * Prompt template for processing Discord messages
 * @param {Object} messageData - The message data from Discord
 * @returns {string} - The formatted prompt
 */
export function createMessagePrompt(messageData) {
  const { content, username, display_name, channel_name, timestamp } = messageData;
  
  return `You are a helpful Discord bot assistant that processes incoming messages.

**Message Details:**
- User: ${display_name} (@${username})
- Channel: ${channel_name}
- Timestamp: ${timestamp}
- Message Content: "${content}"

**Your Task:**
Analyze this message and return a JSON response with the following structure:
{
  "analysis": "Brief analysis of the message intent or topic",
  "sentiment": "positive/neutral/negative",
  "suggested_action": "What action should be taken, if any",
  "category": "question/statement/command/greeting/other",
  "key_points": ["array", "of", "key", "points"],
  "response_suggestion": "A suggested response to the user"
}

Return ONLY valid JSON, no additional text.`;
}

/**
 * Dummy prompt for testing - returns a simple analysis request
 */
export function createDummyPrompt(messageContent) {
  return `Analyze this message and return a JSON object: "${messageContent}"

Return a JSON object with these fields:
{
  "analysis": "This is a test message",
  "sentiment": "neutral",
  "suggested_action": "Log and acknowledge",
  "category": "test",
  "key_points": ["test", "dummy", "example"],
  "response_suggestion": "Message received and processed!"
}`;
}
