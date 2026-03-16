const OpenAI = require("openai");
const axios = require("axios");

const toCompletionShape = (content) => ({ choices: [{ message: { content } }] });
const STRICT_JSON_SYSTEM_PROMPT =
  "You are a backend API. Return ONLY valid JSON. Do not include explanations, markdown, comments, or text before/after JSON. Output must be strictly parseable using JSON.parse().";
const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

const buildApiKeyPool = (primaryKey) => {
  const raw = String(
    process.env.OPENROUTER_API_KEYS ||
      process.env.OPENAI_API_KEYS ||
      ""
  );
  const envKeys = raw
    .split(",")
    .map((k) => String(k || "").trim())
    .filter(Boolean);
  const keys = [String(primaryKey || "").trim(), ...envKeys].filter(Boolean);
  return Array.from(new Set(keys));
};

const requestWithOllama = async ({ prompt, baseURL, model, timeoutMs, fallbackModels = [] }) => {
  const models = Array.from(new Set([model, ...(fallbackModels || [])].filter(Boolean)));
  let lastError = null;

  for (const currentModel of models) {
    try {
      console.log(`Trying Ollama model: ${currentModel}`);
      const response = await axios.post(
        `${baseURL}/api/chat`,
        {
          model: currentModel,
          messages: [
            { role: "system", content: STRICT_JSON_SYSTEM_PROMPT },
            { role: "user", content: prompt },
          ],
          format: "json",
          options: {
            temperature: 0,
          },
          stream: false,
        },
        { timeout: timeoutMs }
      );

      const content = response?.data?.message?.content || "";
      if (!content) throw new Error("Ollama returned empty content");
      return toCompletionShape(content);
    } catch (error) {
      lastError = error;
      const status = error?.response?.status;
      const data = error?.response?.data;
      const isConnectionError = !status && (error?.code === "ECONNREFUSED" || error?.code === "ENOTFOUND");
      const isTimeout = error?.code === "ECONNABORTED" || String(error?.message || "").includes("timeout");
      const isNotFound = status === 404;
      const canTryNext = isTimeout || isNotFound;

      if (isConnectionError) {
        throw new Error(`Ollama is not reachable at ${baseURL}. Start Ollama and run: ollama run ${currentModel}`);
      }

      if (canTryNext && currentModel !== models[models.length - 1]) {
        console.warn(`Ollama model ${currentModel} failed (${isTimeout ? "timeout" : "not found"}). Trying fallback model...`);
        continue;
      }

      throw new Error(`Ollama request failed${status ? ` (${status})` : ""}: ${data?.error || error.message}`);
    }
  }

  throw lastError || new Error("All configured Ollama models failed");
};

const requestWithOpenAI = async ({ prompt, apiKey, baseURL, preferredModels, fallbackModels }) => {
  const models = Array.from(new Set([...(preferredModels || []), ...(fallbackModels || [])]));
  const candidateKeys = buildApiKeyPool(apiKey);
  const firstKey = candidateKeys[0] || "";
  const isOpenRouter =
    String(firstKey || "").startsWith("sk-or-") || /openrouter\.ai/i.test(String(baseURL || ""));
  let sawRateLimit = false;
  const defaultMaxTokens = Number(process.env.OPENAI_MAX_TOKENS || 3200);
  const gpt4MaxTokens = Number(process.env.OPENAI_MAX_TOKENS_GPT4 || 3200);
  const gpt4MiniMaxTokens = Number(process.env.OPENAI_MAX_TOKENS_GPT4_MINI || 3200);
  const minMaxTokens = Number(process.env.OPENAI_MIN_MAX_TOKENS || 512);

  for (const currentKey of candidateKeys) {
    const openai = isOpenRouter ? null : new OpenAI(baseURL ? { apiKey: currentKey, baseURL } : { apiKey: currentKey });
    for (const model of models) {
      console.log(`Trying OpenAI model: ${model}`);
      const isGpt4 = model.includes("gpt-4");
      const isMini = /mini/i.test(model);
      const baseMaxTokens = isGpt4 ? (isMini ? gpt4MiniMaxTokens : gpt4MaxTokens) : defaultMaxTokens;
      const tokenCandidates = Array.from(
        new Set([
          baseMaxTokens,
          Math.max(minMaxTokens, Math.floor(baseMaxTokens * 0.75)),
          Math.max(minMaxTokens, Math.floor(baseMaxTokens * 0.5)),
          Math.max(minMaxTokens, Math.floor(baseMaxTokens * 0.33)),
          minMaxTokens,
        ].filter((n) => Number.isFinite(n) && n > 0))
      ).sort((a, b) => b - a);

      for (const maxTokens of tokenCandidates) {
        try {
          const requestBody = {
            model,
            messages: [
              { role: "system", content: STRICT_JSON_SYSTEM_PROMPT },
              { role: "user", content: prompt },
            ],
            max_tokens: maxTokens,
            temperature: 0,
          };

          if (process.env.OPENAI_JSON_MODE !== "false") {
            requestBody.response_format = { type: "json_object" };
          }

          let response;
          if (isOpenRouter) {
            const endpoint = baseURL
              ? `${String(baseURL).replace(/\/$/, "")}/chat/completions`
              : OPENROUTER_CHAT_URL;
            try {
              const res = await axios.post(endpoint, requestBody, {
                timeout: 60000,
                headers: {
                  Authorization: `Bearer ${currentKey}`,
                  "Content-Type": "application/json",
                  "HTTP-Referer": process.env.OPENROUTER_REFERER || "http://localhost:3000",
                  "X-Title": process.env.OPENROUTER_TITLE || "AI Project Generator",
                },
              });
              response = res.data;
            } catch (error) {
              const status = error?.response?.status || error?.status;
              const message = String(error?.message || error?.response?.data || "");
              const unsupportedJsonMode = status === 400 && /response_format|json_object|json schema/i.test(message);
              if (!unsupportedJsonMode || !requestBody.response_format) throw error;
              delete requestBody.response_format;
              const res = await axios.post(endpoint, requestBody, {
                timeout: 60000,
                headers: {
                  Authorization: `Bearer ${currentKey}`,
                  "Content-Type": "application/json",
                  "HTTP-Referer": process.env.OPENROUTER_REFERER || "http://localhost:3000",
                  "X-Title": process.env.OPENROUTER_TITLE || "AI Project Generator",
                },
              });
              response = res.data;
            }
          } else {
            try {
              response = await openai.chat.completions.create(requestBody);
            } catch (error) {
              const status = error?.status || error?.response?.status;
              const message = String(error?.message || error?.response?.data || "");
              const unsupportedJsonMode = status === 400 && /response_format|json_object|json schema/i.test(message);
              if (!unsupportedJsonMode || !requestBody.response_format) throw error;

              delete requestBody.response_format;
              response = await openai.chat.completions.create(requestBody);
            }
          }

          return { response, sawRateLimit };
        } catch (error) {
          const status = error?.status || error?.response?.status;
          console.warn(`Model ${model} failed (max_tokens=${maxTokens}):`, status || error?.message || error);
          if (status === 401 || status === 402 || status === 403 || status === 429) {
            sawRateLimit = true;
            break;
          }
          if (typeof status === "number" && status >= 500) continue;
          throw error;
        }
      }
    }
    // Continue with next key when current key is blocked/limited.
  }

  return { response: null, sawRateLimit };
};

const requestWithGemini = async ({ prompt, apiKey, preferredModels, fallbackModels }) => {
  const models = Array.from(new Set([...(preferredModels || []), ...(fallbackModels || [])]));
  let sawRateLimit = false;
  let sawModelNotFound = false;
  const combinedPrompt = `${STRICT_JSON_SYSTEM_PROMPT}\n\n${prompt}`;

  for (const model of models) {
    try {
      console.log(`Trying Gemini model: ${model}`);
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          contents: [{ role: "user", parts: [{ text: combinedPrompt }] }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 8192,
          },
        },
        { timeout: 120000 }
      );

      const content =
        response?.data?.candidates?.[0]?.content?.parts
          ?.map((p) => p?.text || "")
          .join("")
          .trim() || "";

      if (!content) {
        throw new Error("Gemini returned empty content");
      }

      return { response: toCompletionShape(content), sawRateLimit };
    } catch (error) {
      const status = error?.response?.status || error?.status;
      console.warn(`Model ${model} failed:`, status || error?.message || error);
      if (status === 401 || status === 403) throw error;
      if (status === 429) {
        sawRateLimit = true;
        continue;
      }
      if (status === 404) {
        // Model name/version mismatch should not abort all attempts.
        sawModelNotFound = true;
        continue;
      }
      if (typeof status === "number" && status >= 500) continue;
      throw error;
    }
  }

  return { response: null, sawRateLimit, sawModelNotFound };
};

const requestWithHuggingFace = async ({ prompt, token, model, timeoutMs }) => {
  if (!token) {
    throw new Error("HF_TOKEN is missing");
  }
  if (!model) {
    throw new Error("HF_MODEL is missing");
  }

  console.log(`Trying Hugging Face model: ${model}`);
  try {
    const chatResponse = await axios.post(
      "https://router.huggingface.co/v1/chat/completions",
      {
        model,
        messages: [
          { role: "system", content: STRICT_JSON_SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        temperature: 0,
      },
      {
        timeout: timeoutMs,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    const content = chatResponse?.data?.choices?.[0]?.message?.content || "";
    if (content) {
      return toCompletionShape(content);
    }
  } catch (_) {
    // Fall through to legacy endpoint.
  }

  const legacyResponse = await axios.post(
    `https://api-inference.huggingface.co/models/${encodeURIComponent(model)}`,
    {
      inputs: prompt,
      parameters: {
        max_new_tokens: 4096,
        temperature: 0,
        return_full_text: false,
      },
      options: { wait_for_model: true },
    },
    {
      timeout: timeoutMs,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    }
  );

  const data = legacyResponse?.data;
  if (Array.isArray(data) && data[0]?.generated_text) {
    return toCompletionShape(data[0].generated_text);
  }
  if (typeof data === "object" && data?.generated_text) {
    return toCompletionShape(data.generated_text);
  }
  throw new Error("Hugging Face returned unsupported response format");
};

const requestAICompletion = async ({
  provider,
  prompt,
  ollama,
  openai,
  huggingface,
}) => {
  const resolvedProvider = String(provider || process.env.AI_PROVIDER || "openai").toLowerCase();
  const openaiBaseURL = String(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  const defaultOpenAI = {
    apiKey: process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY || "",
    baseURL: openaiBaseURL,
    preferredModels: [String(process.env.OPENAI_MODEL || "gpt-4o-mini")],
    fallbackModels: String(process.env.OPENAI_MODEL_FALLBACKS || "")
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean),
    geminiApiKey: process.env.GEMINI_API_KEY || "",
    geminiPreferredModels: [String(process.env.GEMINI_MODEL || "gemini-1.5-pro")],
    geminiFallbackModels: String(process.env.GEMINI_MODEL_FALLBACKS || "")
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean),
  };
  const openaiCfg = { ...defaultOpenAI, ...(openai || {}) };
  const allowOllamaFallback = String(process.env.AI_ALLOW_OLLAMA_FALLBACK || "false").toLowerCase() === "true";
  const ollamaCfg = {
    baseURL: process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434",
    model: process.env.OLLAMA_MODEL || "llama3.1",
    timeoutMs: Number(process.env.OLLAMA_TIMEOUT_MS || 120000),
    fallbackModels: String(process.env.OLLAMA_FALLBACK_MODELS || "")
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean),
    ...(ollama || {}),
  };
  const hasOpenAIKey = Boolean(openaiCfg?.apiKey);
  const hasGeminiKey = Boolean(openaiCfg?.geminiApiKey);

  if (resolvedProvider === "ollama") {
    return requestWithOllama({
      prompt,
      baseURL: ollamaCfg.baseURL,
      model: ollamaCfg.model,
      timeoutMs: ollamaCfg.timeoutMs,
      fallbackModels: ollamaCfg.fallbackModels,
    });
  }

  if (resolvedProvider === "huggingface") {
    return requestWithHuggingFace({
      prompt,
      token: huggingface?.token,
      model: huggingface?.model,
      timeoutMs: huggingface?.timeoutMs || 120000,
    });
  }

  if (resolvedProvider !== "openai" && resolvedProvider !== "gemini") {
    throw new Error(`Unsupported AI_PROVIDER: ${provider}. Use 'gemini', 'openai', 'huggingface', or 'ollama'.`);
  }

  try {
    const result =
      resolvedProvider === "openai"
        ? await requestWithOpenAI({
            prompt,
            apiKey: openaiCfg.apiKey,
            baseURL: openaiCfg.baseURL,
            preferredModels: openaiCfg.preferredModels,
            fallbackModels: openaiCfg.fallbackModels,
          })
        : await requestWithGemini({
            prompt,
            apiKey: openaiCfg.geminiApiKey,
            preferredModels: openaiCfg.geminiPreferredModels,
            fallbackModels: openaiCfg.geminiFallbackModels,
          });

    const { response, sawRateLimit, sawModelNotFound } = result;

    if (response) return response;

    if (resolvedProvider === "gemini" && hasOpenAIKey) {
      console.warn("Gemini unavailable, trying OpenAI before Ollama fallback.");
      const openaiResult = await requestWithOpenAI({
        prompt,
        apiKey: openaiCfg.apiKey,
        baseURL: openaiCfg.baseURL,
        preferredModels: openaiCfg.preferredModels,
        fallbackModels: openaiCfg.fallbackModels,
      });
      if (openaiResult.response) return openaiResult.response;
    }

    if (resolvedProvider === "openai" && hasGeminiKey) {
      console.warn("OpenAI unavailable, trying Gemini before Ollama fallback.");
      const geminiResult = await requestWithGemini({
        prompt,
        apiKey: openaiCfg.geminiApiKey,
        preferredModels: openaiCfg.geminiPreferredModels,
        fallbackModels: openaiCfg.geminiFallbackModels,
      });
      if (geminiResult.response) return geminiResult.response;
    }

    if ((sawRateLimit || sawModelNotFound || resolvedProvider === "gemini") && allowOllamaFallback) {
      // Gemini provider is optional; if it fails for quota/model-name reasons, prefer graceful local fallback.
      console.warn(`All ${resolvedProvider} attempts failed (rate/model). Falling back to Ollama.`);
      return requestWithOllama({
        prompt,
        baseURL: ollamaCfg.baseURL,
        model: ollamaCfg.model,
        timeoutMs: ollamaCfg.timeoutMs,
        fallbackModels: ollamaCfg.fallbackModels,
      });
    }

    throw new Error(`All configured ${resolvedProvider} models failed or are unavailable for this key`);
  } catch (error) {
    console.error(`${resolvedProvider} request failed:`, error.message || error);
    console.error(`${resolvedProvider} status:`, error?.status || error?.response?.status);
    console.error(`${resolvedProvider} response:`, error?.response?.data || error?.toString());
    throw error;
  }
};

module.exports = {
  requestAICompletion,
};
