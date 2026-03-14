interface AITextOptions {
    prompt: string;
    temperature: number;
    maxOutputTokens: number;
    taskLabel: string;
}
export declare function generateTextWithFallback(options: AITextOptions): Promise<string>;
export {};
