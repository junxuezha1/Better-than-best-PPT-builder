import {
  completeChat,
  extractJsonObject,
  extractSvg,
  type ChatMessage,
  type CompleteChatOptions,
} from "./llm.ts";
import { assertSvgTextFits } from "./svg-text-layout.ts";
import type { ModelConfig } from "./types.ts";

const DEFAULT_RETRY_DELAYS = [5_000, 15_000];

interface ModelCallOptions extends CompleteChatOptions {
  retryDelaysMs?: number[];
  onRetry?: (input: { attempt: number; maxAttempts: number; delayMs: number }) => void;
  repairInvalidOutput?: boolean;
  /** Resolve verified project-local assets before the normal SVG safety checks. */
  outputTransform?: (text: string) => string;
}

async function runWithRetry<T>(
  task: () => Promise<T>,
  options?: Pick<ModelCallOptions, "retryDelaysMs" | "onRetry" | "signal">,
): Promise<T> {
  const delays = options?.retryDelaysMs ?? DEFAULT_RETRY_DELAYS;
  const maxAttempts = delays.length + 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (options?.signal?.aborted) throw new Error("CANCELLED");
    try {
      return await task();
    } catch (error) {
      if (options?.signal?.aborted) throw new Error("CANCELLED");
      const message = error instanceof Error ? error.message : String(error);
      if (!isTransientModelError(message) || attempt === maxAttempts) throw error;
      const delayMs = delays[attempt - 1];
      options?.onRetry?.({ attempt: attempt + 1, maxAttempts, delayMs });
      await wait(delayMs, options?.signal);
    }
  }
  throw new Error("模型请求重试失败");
}

export async function generateText(
  config: ModelConfig,
  messages: ChatMessage[],
  options?: ModelCallOptions,
): Promise<string> {
  return runWithRetry(
    () => completeChat(config, messages, {
      ...options,
      stream: options?.stream
        ?? (config.protocol === "responses" || config.protocol === "chat_completions"),
    }),
    options,
  );
}

export async function generateJson<T>(
  config: ModelConfig,
  messages: ChatMessage[],
  options?: ModelCallOptions,
): Promise<T> {
  const text = await generateText(config, messages, options);
  return extractJsonObject(text) as T;
}

export async function generateSvg(
  config: ModelConfig,
  messages: ChatMessage[],
  options?: ModelCallOptions,
): Promise<string> {
  let text = await generateText(config, messages, options);
  const maxRepairAttempts = options?.repairInvalidOutput === false ? 0 : 2;
  for (let repairAttempt = 0; ; repairAttempt += 1) {
    try {
      const svg = extractSvg(options?.outputTransform ? options.outputTransform(text) : text);
      assertSvgTextFits(svg);
      return svg;
    } catch (error) {
      if (options?.signal?.aborted || repairAttempt >= maxRepairAttempts) throw error;
      const issue = error instanceof Error ? error.message : String(error);
      text = await generateText(
        config,
        [
          ...messages,
          {
            role: "user",
            content: `上一版 SVG 未通过交付校验：${issue}。请从原始输入重新生成，修正该问题，并且只输出一个完整 SVG。`,
          },
        ],
        options,
      );
    }
  }
}

export function isTransientModelError(message: string): boolean {
  return /\b(?:429|502|503|504|524)\b|at capacity|high demand|rate[ -]?limit|temporar(?:y|ily) unavailable|overloaded|timed?\s*out|upstream request failed|fetch failed|connection (?:reset|closed|terminated)|socket hang up|ECONNRESET|容量|限流|繁忙|暂时不可用|超时/i.test(message);
}

export function isRecoverableModelOutputError(error: unknown): boolean {
  if (error instanceof SyntaxError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return isTransientModelError(message)
    || /模型输出里没有 JSON|Unexpected token|Expected ',' or '}'|JSON.*(?:parse|解析)/i.test(message);
}

async function wait(delayMs: number, signal?: AbortSignal): Promise<void> {
  const deadline = Date.now() + Math.max(0, delayMs);
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("CANCELLED");
    const remaining = deadline - Date.now();
    await new Promise((resolve) => setTimeout(resolve, Math.min(250, remaining)));
  }
}
