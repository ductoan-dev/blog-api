const provider = require("@/service/aiProvider.service");

afterEach(() => vi.unstubAllGlobals());

it("uses the OpenAI embeddings endpoint and normalizes 1536-dimensional vectors", async () => {
  const vector = Array(1536).fill(0); vector[0] = 3; vector[1] = 4;
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ index: 0, embedding: vector }] }) });
  vi.stubGlobal("fetch", fetch);
  const [result] = await provider.embed(["React"]);
  expect(result[0]).toBeCloseTo(0.6);
  expect(result[1]).toBeCloseTo(0.8);
  const request = JSON.parse(fetch.mock.calls[0][1].body);
  expect(request.input).toEqual(["React"]);
  expect(request.model).toBe("text-embedding-3-small");
  expect(request.dimensions).toBe(1536);
  expect(fetch.mock.calls[0][0]).toBe("https://api.openai.com/v1/embeddings");
  expect(fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer test-key-no-network");
});

it("rejects missing or malformed embeddings instead of storing them", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) }));
  await expect(provider.embed(["React"])).rejects.toThrow("AI_INVALID_EMBEDDING_RESPONSE");
});

it("restores input order and rejects duplicate indexes in embedding responses", async () => {
  const first = Array(1536).fill(0); first[0] = 1;
  const second = Array(1536).fill(0); second[1] = 1;
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [
    { index: 1, embedding: second }, { index: 0, embedding: first },
  ] }) });
  vi.stubGlobal("fetch", fetch);
  expect(await provider.embed(["first", "second"])).toEqual([first, second]);
  fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [
    { index: 0, embedding: first }, { index: 0, embedding: second },
  ] }) });
  await expect(provider.embed(["first", "second"])).rejects.toThrow("AI_INVALID_EMBEDDING_RESPONSE");
});

it("calls OpenAI JSON mode with grounded sources and no search tools", async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ finish_reason: "stop",
    message: { content: '{"supported":false,"paragraphs":[]}' } }] }) });
  vi.stubGlobal("fetch", fetch);
  expect(await provider.answer("React?", [], [{ id: 1, text: "React", title: "React" }])).toEqual({ supported: false, paragraphs: [] });
  expect(fetch.mock.calls[0][0]).toBe("https://api.openai.com/v1/chat/completions");
  const body = JSON.parse(fetch.mock.calls[0][1].body);
  expect(body.response_format).toEqual({ type: "json_object" });
  expect(body.tools).toBeUndefined();
  expect(JSON.parse(body.messages[1].content).sources[0].id).toBe(1);
});

it("does not leak upstream error bodies and identifies quota failures", async () => {
  const json = vi.fn().mockResolvedValue({ secret: "not for logs" });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429, json }));
  await expect(provider.embed(["React"])).rejects.toMatchObject({ message: "AI_PROVIDER_RATE_LIMIT", status: 429 });
  expect(json).toHaveBeenCalledTimes(1);
});

it("distinguishes exhausted API credits from rate limits without exposing upstream text", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({
    error: { type: "insufficient_quota", code: "credit_balance_exhausted", message: "private upstream details" },
  }) }));
  await expect(provider.embed(["React"])).rejects.toMatchObject({
    message: "AI_INSUFFICIENT_QUOTA", status: 503, code: "AI_INSUFFICIENT_QUOTA",
  });
});

it("rejects truncated model JSON and handles request timeouts", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ finish_reason: "length",
    message: { content: '{"supported":false}' } }] }) }));
  await expect(provider.answer("React", [], [])).rejects.toThrow("AI_INVALID_ANSWER");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
  await expect(provider.embed(["React"])).rejects.toMatchObject({ status: 504 });
});
