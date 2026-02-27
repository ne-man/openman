/**
 * Image Analysis - Analyze images using AI vision capabilities
 */

import fs from 'fs/promises';
import OpenAI from 'openai';
import { config } from '@/core/config';
import { auditLogger } from '@/core/audit';

export interface AnalysisResult {
  description: string;
  elements: string[];
  suggestions?: string[];
  raw?: string;
}

export class ImageAnalyzer {
  private openai: OpenAI | null = null;

  constructor() {
    const aiConfig = config.get('ai');
    if (aiConfig.openai?.apiKey) {
      this.openai = new OpenAI({
        apiKey: aiConfig.openai.apiKey,
      });
    }
  }

  /**
   * Check if analyzer is available
   */
  public isAvailable(): boolean {
    return this.openai !== null;
  }

  /**
   * Analyze an image file
   */
  public async analyzeImage(
    imagePath: string,
    prompt?: string
  ): Promise<AnalysisResult> {
    if (!this.openai) {
      throw new Error('OpenAI API key not configured. Set OPENAI_API_KEY to enable image analysis.');
    }

    // Read image as base64
    const imageBuffer = await fs.readFile(imagePath);
    const base64Image = imageBuffer.toString('base64');
    const mimeType = imagePath.endsWith('.png') ? 'image/png' : 'image/jpeg';

    // Default prompt for screen analysis
    const analysisPrompt = prompt || `
Analyze this device screenshot and provide:
1. A brief description of what's on the screen
2. List of UI elements visible (buttons, text fields, icons, etc.)
3. What app or screen this appears to be
4. Any actionable items or suggestions for the user

Be concise and focus on actionable information.
`;

    await auditLogger.log({
      timestamp: new Date(),
      action: 'image.analyze',
      details: { imagePath, prompt: analysisPrompt.substring(0, 100) },
      result: 'success',
      riskLevel: 'low',
    });

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: analysisPrompt },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${mimeType};base64,${base64Image}`,
                },
              },
            ],
          },
        ],
        max_tokens: 1000,
      });

      const content = response.choices[0]?.message?.content || '';

      // Parse the response
      return this.parseAnalysisResult(content);
    } catch (error) {
      throw new Error(`Image analysis failed: ${(error as Error).message}`);
    }
  }

  /**
   * Analyze screen for specific UI elements
   */
  public async findUIElements(imagePath: string): Promise<AnalysisResult> {
    const prompt = `
Identify all interactive UI elements in this screenshot:
- Buttons (with their labels)
- Input fields (with their placeholders/labels)
- Icons (describe their function if known)
- Links or clickable text
- Menus or navigation items

Format: List each element with its approximate position (top/middle/bottom, left/center/right).
`;
    return this.analyzeImage(imagePath, prompt);
  }

  /**
   * Suggest actions based on screen content
   */
  public async suggestActions(
    imagePath: string,
    goal?: string
  ): Promise<AnalysisResult> {
    const prompt = goal
      ? `
Analyze this screenshot and suggest actions to achieve: "${goal}"

Provide step-by-step suggestions for what the user could do next.
`
      : `
Analyze this screenshot and suggest 3-5 possible actions the user might want to take.
Focus on the most likely or useful actions.
`;

    return this.analyzeImage(imagePath, prompt);
  }

  /**
   * Compare two screenshots
   */
  public async compareImages(
    image1Path: string,
    image2Path: string
  ): Promise<AnalysisResult> {
    if (!this.openai) {
      throw new Error('OpenAI API key not configured');
    }

    const [image1, image2] = await Promise.all([
      fs.readFile(image1Path),
      fs.readFile(image2Path),
    ]);

    const base64_1 = image1.toString('base64');
    const base64_2 = image2.toString('base64');

    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Compare these two screenshots. What changed between them? List the differences.' },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${base64_1}` } },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${base64_2}` } },
          ],
        },
      ],
      max_tokens: 1000,
    });

    const content = response.choices[0]?.message?.content || '';
    return this.parseAnalysisResult(content);
  }

  /**
   * Parse AI response into structured result
   */
  private parseAnalysisResult(content: string): AnalysisResult {
    const lines = content.split('\n').filter(l => l.trim());

    const elements: string[] = [];
    const suggestions: string[] = [];

    let currentSection = 'description';
    let description = '';

    for (const line of lines) {
      const lower = line.toLowerCase();

      // Detect sections
      if (lower.includes('element') || lower.includes('ui element') || lower.includes('button')) {
        currentSection = 'elements';
      } else if (lower.includes('suggest') || lower.includes('action') || lower.includes('next')) {
        currentSection = 'suggestions';
      }

      // Collect items
      if (line.match(/^[\d\-\•\*]/)) {
        const item = line.replace(/^[\d\-\•\*]\s*/, '').trim();
        if (currentSection === 'elements') {
          elements.push(item);
        } else if (currentSection === 'suggestions') {
          suggestions.push(item);
        }
      } else if (currentSection === 'description') {
        description += (description ? ' ' : '') + line.trim();
      }
    }

    return {
      description: description || content.substring(0, 500),
      elements,
      suggestions: suggestions.length > 0 ? suggestions : undefined,
      raw: content,
    };
  }
}

// Singleton instance
export const imageAnalyzer = new ImageAnalyzer();
