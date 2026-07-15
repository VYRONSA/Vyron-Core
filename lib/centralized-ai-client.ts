type ChatMessage = {
  role: "system" | "user";
  content: string;
};

type JsonSchemaConfig = {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
};

type GenerateStructuredJsonInput = {
  messages: ChatMessage[];
  schema: JsonSchemaConfig;
  model?: string;
  temperature?: number;
};

export type StructuredAiResult<T> = {
  model: string;
  output: T;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
};

function asText(value: unknown): string {
  return String(value ?? "").trim();
}

export function getCentralAiModel(): string {
  return asText(process.env.OPENAI_MODEL) || "gpt-4o-mini";
}

function getCentralAiApiKey(): string {
  const key = asText(process.env.OPENAI_API_KEY);
  if (!key) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }
  return key;
}

function parseJsonContent<T>(content: unknown): T {
  if (typeof content === "string") {
    return JSON.parse(content) as T;
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        const p = part as { type?: string; text?: string };
        return p?.type === "text" ? p.text || "" : "";
      })
      .join("");
    return JSON.parse(text) as T;
  }

  throw new Error("AI response did not include valid JSON content.");
}

export async function generateStructuredJson<T>(
  input: GenerateStructuredJsonInput
): Promise<StructuredAiResult<T>> {
  const apiKey = getCentralAiApiKey();
  const model = input.model || getCentralAiModel();

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: typeof input.temperature === "number" ? input.temperature : 0.2,
      messages: input.messages,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: input.schema.name,
          strict: input.schema.strict ?? true,
          schema: input.schema.schema,
        },
      },
    }),
  });

  const body = (await response.json().catch(() => ({}))) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: unknown } }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
    model?: string;
  };

  if (!response.ok) {
    throw new Error(body?.error?.message || "AI generation request failed.");
  }

  const content = body?.choices?.[0]?.message?.content;
  const parsed = parseJsonContent<T>(content);

  return {
    model: body.model || model,
    output: parsed,
    usage: {
      promptTokens: Number(body?.usage?.prompt_tokens || 0),
      completionTokens: Number(body?.usage?.completion_tokens || 0),
      totalTokens: Number(body?.usage?.total_tokens || 0),
    },
  };
}
