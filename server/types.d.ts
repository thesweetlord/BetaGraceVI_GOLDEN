declare module "@google/generative-ai" {
  export class GoogleGenerativeAI {
    constructor(apiKey: string);
    getGenerativeModel(options: {
      model: string;
      systemInstruction: string;
    }): {
      generateContent(params: {
        contents: Array<{ role: string; parts: Array<{ text: string }> }>;
        generationConfig: { maxOutputTokens: number; temperature: number };
      }): Promise<{ response: { text(): string } }>;
    };
  }
}

declare module "@huggingface/inference" {
  export class HfInference {
    constructor(token: string);
    chatCompletion(params: {
      model: string;
      messages: Array<{ role: string; content: string }>;
      max_tokens: number;
      temperature: number;
    }): Promise<{ choices: Array<{ message?: { content?: string } }> }>;
  }
}

declare module "./aletheia-bridge.js" {
  export function queryGraph(
    entity: string,
    topK?: number,
  ): Promise<Array<{ neighbor: string; weight: number; sources: string[] }>>;
  export function queryChroma(query: string, topK?: number): Promise<string[]>;
}

declare module "ffmpeg-static" {
  const ffmpegPath: string | null;
  export default ffmpegPath;
}

declare module "drizzle-orm" {
  export function eq(...args: any[]): any;
  export function desc(...args: any[]): any;
  export function asc(...args: any[]): any;
  export function sql(...args: any[]): any;
}

declare module "esbuild" {
  export function build(options: any): Promise<any>;
}

declare module "vite" {
  export function build(options?: any): Promise<any>;
}
