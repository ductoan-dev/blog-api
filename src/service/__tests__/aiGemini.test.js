const provider = require("@/service/aiProvider.service");

beforeEach(() => {
  vi.stubEnv("AI_PROVIDER", "gemini");
  vi.stubEnv("GEMINI_API_KEY", "test-gemini-no-network");
  vi.stubEnv("AI_CHAT_MODEL", "gemini-3.5-flash-lite");
  vi.stubEnv("AI_EMBEDDING_MODEL", "gemini-embedding-001");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("uses a Gemini key for chat and embeddings without requiring OpenAI", () => {
  vi.stubEnv("OPENAI_API_KEY", "");
  const config = require("@/config/ai").requireAiConfig();
  expect(config.chatKey).toBe("test-gemini-no-network");
  expect(config.embeddingKey).toBe(config.chatKey);
  expect(config.embeddingVersion).toBe("gemini:gemini-embedding-001:1536");
});

it("embeds query text with the retrieval task type and normalizes vectors", async () => {
  const values = Array(1536).fill(0); values[0] = 3; values[1] = 4;
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ embeddings: [{ values }] }) });
  vi.stubGlobal("fetch", fetch);
  const [vector] = await provider.embed(["React?"], "RETRIEVAL_QUERY");
  expect(vector[0]).toBeCloseTo(0.6);
  expect(fetch.mock.calls[0][0]).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents");
  expect(fetch.mock.calls[0][1].headers["x-goog-api-key"]).toBe("test-gemini-no-network");
  const request = JSON.parse(fetch.mock.calls[0][1].body).requests[0];
  expect(request.taskType).toBe("RETRIEVAL_QUERY");
  expect(request.outputDimensionality).toBe(1536);
  expect(request.content.parts[0].text).toBe("React?");
});

it("sends native Gemini history and JSON settings, excluding thought parts", async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ candidates: [{ finishReason: "STOP",
    content: { parts: [{ thought: true, text: "private reasoning" }, { text: '{"supported":false,"paragraphs":[]}' }] } }] }) });
  vi.stubGlobal("fetch", fetch);
  expect(await provider.answer("More?", [{ role: "user", content: "React?" },
    { role: "assistant", content: "React" }], [{ id: 1, text: "React" }]))
    .toEqual({ supported: false, paragraphs: [] });
  const body = JSON.parse(fetch.mock.calls[0][1].body);
  expect(body.systemInstruction.parts[0].text).toBeTruthy();
  expect(body.systemInstruction.parts[0].text).toContain("tiêu đề và mô tả");
  expect(body.contents.map((item) => item.role)).toEqual(["user", "model", "user"]);
  expect(body.generationConfig.responseMimeType).toBe("application/json");
  expect(body.tools).toBeUndefined();
});

it("rejects blocked or truncated Gemini answers and malformed vectors", async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ candidates: [{ finishReason: "MAX_TOKENS" }] }) });
  vi.stubGlobal("fetch", fetch);
  await expect(provider.answer("React", [], [])).rejects.toThrow("AI_INVALID_ANSWER");
  fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ embeddings: [] }) });
  await expect(provider.embed(["React"])).rejects.toThrow("AI_INVALID_EMBEDDING_RESPONSE");
});
