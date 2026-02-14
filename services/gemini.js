import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * Gemini AI Service for processing messages
 */
class GeminiService {
  constructor(apiKey, modelName = 'gemini-2.0-flash-exp') {
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is required');
    }
    
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({ model: modelName });
    this.modelName = modelName;
  }

  /**
   * Generate content using Gemini API
   * @param {string} prompt - The prompt to send to Gemini
   * @returns {Promise<string>} - The generated text response
   */
  async generate(prompt) {
    try {
      console.log(`\n🤖 Sending prompt to Gemini (${this.modelName})...`);
      console.log(`Prompt length: ${prompt.length} characters`);
      
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      
      console.log(`✅ Received response from Gemini`);
      console.log(`Response length: ${text.length} characters`);
      
      return text;
    } catch (error) {
      console.error('❌ Error calling Gemini API:', error.message);
      throw error;
    }
  }

  /**
   * Generate content and parse as JSON
   * @param {string} prompt - The prompt to send to Gemini
   * @returns {Promise<Object>} - The parsed JSON response
   */
  async generateJSON(prompt) {
    try {
      const text = await this.generate(prompt);
      
      // Try to extract JSON from the response (in case it's wrapped in markdown)
      let jsonText = text.trim();
      
      // Remove markdown code blocks if present
      if (jsonText.startsWith('```json')) {
        jsonText = jsonText.replace(/^```json\n/, '').replace(/\n```$/, '');
      } else if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/^```\n/, '').replace(/\n```$/, '');
      }
      
      const parsed = JSON.parse(jsonText);
      console.log('✅ Successfully parsed JSON response');
      
      return parsed;
    } catch (error) {
      console.error('❌ Error parsing JSON from Gemini response:', error.message);
      console.error('Raw response:', error.response || 'N/A');
      throw error;
    }
  }

  /**
   * Process a Discord message using Gemini
   * @param {string} prompt - The formatted prompt
   * @returns {Promise<Object>} - The analysis result
   */
  async processMessage(prompt) {
    return await this.generateJSON(prompt);
  }
}

export default GeminiService;
