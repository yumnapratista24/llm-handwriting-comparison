import OpenAI from "openai";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatParams {
  model: string;
  system: string;
  messages: ChatMessage[];
  webSearch?: boolean;
  maxTokens?: number;
}

export interface ChatResult {
  text: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface LlmProvider {
  chat(params: ChatParams): Promise<ChatResult>;
}

export function openRouterLlm(apiKey: string): LlmProvider {
  const client = new OpenAI({ apiKey, baseURL: "https://openrouter.ai/api/v1" });
  return {
    async chat({ model, system, messages, maxTokens }) {
      const res = await client.chat.completions.create({
        model,
        messages: [{ role: "system", content: system }, ...messages],
        ...(maxTokens ? { max_tokens: maxTokens } : {}),
      });
      return {
        text: res.choices?.[0]?.message?.content ?? "",
        usage: res.usage
          ? { inputTokens: res.usage.prompt_tokens, outputTokens: res.usage.completion_tokens }
          : undefined,
      };
    },
  };
}

export interface ChatCompletionsClient {
  create(
    body: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
  ): Promise<OpenAI.Chat.Completions.ChatCompletion>;
}

export function openRouterCompletions(apiKey: string): ChatCompletionsClient {
  const client = new OpenAI({ apiKey, baseURL: "https://openrouter.ai/api/v1" });
  return { create: (body) => client.chat.completions.create(body) };
}
