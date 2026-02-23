import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * Gemini AI Service for processing messages
 */
class GeminiService {
  constructor(apiKey, modelName = 'gemini-2.0-flash-001') {
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is required');
    }
    
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({ model: modelName });
    this.modelName = modelName;
  }

  /**
   * Generate content using Gemini API with JSON response mode
   * @param {string} prompt - The prompt to send to Gemini
   * @param {Object} schema - JSON schema for the response
   * @returns {Promise<Object>} - The generated JSON response
   */
  async generateWithSchema(prompt, schema) {
    try {
      const model = this.genAI.getGenerativeModel({ 
        model: this.modelName,
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: schema
        }
      });
      
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      
      return JSON.parse(text);
    } catch (error) {
      console.error('❌ Error calling Gemini API with schema:', error.message);
      throw error;
    }
  }

  /**
   * Generate content using Gemini API
   * @param {string} prompt - The prompt to send to Gemini
   * @returns {Promise<string>} - The generated text response
   */
  async generate(prompt) {
    try {
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      
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
  /**
   * Process a Discord message using Gemini
   * @param {string} prompt - The formatted prompt
   * @param {Object} [options] - Optional named parameters
   * @param {boolean} [options.isJSON=false] - Whether to parse the response as JSON
   * @param {Object} [options.schema] - JSON schema for structured output
   * @returns {Promise<Object|string>} - The analysis result (parsed JSON or text)
   */
  async processMessage(prompt, { isJSON = false, schema = null } = {}) {
    if (schema) {
      return await this.generateWithSchema(prompt, schema);
    } else if (isJSON) {
      return await this.generateJSON(prompt);
    } else {
      return await this.generate(prompt);
    }
  }
}

export default GeminiService;
