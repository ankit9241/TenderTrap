import type { LlmMessage, LlmGenerateOptions, LlmProvider } from "./types";
import { sanitizeError } from "../db";

export class OllamaProvider implements LlmProvider {
  readonly name = "ollama";
  readonly baseUrl: string;
  readonly model: string;

  constructor(baseUrl?: string, model?: string) {
    this.baseUrl = (baseUrl || process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
    this.model = model || process.env.OLLAMA_MODEL || "gemma3:latest";
  }

  async checkHealth(): Promise<{ available: boolean; model: string; error?: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        method: "GET",
        signal: controller.signal,
      });

      if (!res.ok) {
        return {
          available: false,
          model: this.model,
          error: `Ollama returned status ${res.status}: ${res.statusText}`,
        };
      }

      const data = (await res.json()) as { models?: Array<{ name: string; model: string }> };
      const modelNames = (data.models ?? []).map((m) => m.name.toLowerCase());
      const target = this.model.toLowerCase();
      const hasModel = modelNames.some((n) => n === target || n.startsWith(`${target}:`));

      if (!hasModel) {
        return {
          available: false,
          model: this.model,
          error: `Model '${this.model}' is not pulled in Ollama. Run: ollama pull ${this.model}`,
        };
      }

      return { available: true, model: this.model };
    } catch (err: any) {
      if (err?.name === "AbortError") {
        return { available: false, model: this.model, error: `Connection to Ollama timed out at ${this.baseUrl}` };
      }
      return { available: false, model: this.model, error: `Ollama connection failed: ${sanitizeError(err)}` };
    } finally {
      clearTimeout(timer);
    }
  }

  async generateJson(messages: LlmMessage[], options?: LlmGenerateOptions): Promise<string> {
    return this.executeGenerateJson(messages, options, 0);
  }

  private async executeGenerateJson(
    messages: LlmMessage[],
    options?: LlmGenerateOptions,
    retryCount = 0,
  ): Promise<string> {
    const timeoutMs = options?.timeoutMs ?? (Number(process.env["LLM_TIMEOUT_MS"]) || 180_000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const temperature = retryCount > 0 ? 0.25 : (options?.temperature ?? 0.1);
    const repeatPenalty = retryCount > 0 ? 1.25 : 1.15;
    const numCtx = Number(process.env["OLLAMA_NUM_CTX"]) || 8192;

    try {
      const payload: Record<string, unknown> = {
        model: this.model,
        messages,
        format: options?.format ?? "json",
        stream: false,
        options: {
          temperature,
          num_ctx: numCtx,
          repeat_penalty: repeatPenalty,
          repeat_last_n: 64,
          num_predict: 2048,
        },
      };

      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => "");
        if (retryCount === 0 && errorText.includes("token repeat limit reached")) {
          return await this.executeGenerateJson(messages, options, 1);
        }
        throw new Error(`Ollama API error (${res.status}): ${errorText || res.statusText}`);
      }

      const data = (await res.json()) as { message?: { content?: string } };
      const content = data.message?.content?.trim();

      if (!content) {
        throw new Error("Ollama returned an empty response");
      }

      return content;
    } catch (err: any) {
      if (err?.name === "AbortError") {
        throw new Error(`Ollama generation timed out after ${Math.round(timeoutMs / 1000)} seconds`);
      }
      if (retryCount === 0 && String(err).includes("token repeat limit reached")) {
        return await this.executeGenerateJson(messages, options, 1);
      }
      throw new Error(`LLM call failed: ${sanitizeError(err)}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
