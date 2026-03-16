const axios = require("axios");
const { requestAICompletion } = require("./ai/providerClient");

const AI_PROVIDER = (process.env.AI_PROVIDER || "ollama").toLowerCase();
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "deepseek-coder:1.3b";
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 600000);
const HF_TOKEN = process.env.HF_TOKEN || "";
const HF_MODEL = process.env.HF_MODEL || "Qwen/Qwen2.5-Coder-7B-Instruct";
const HF_MODEL_FALLBACKS = process.env.HF_MODEL_FALLBACKS || "Qwen/Qwen2.5-Coder-7B-Instruct,deepseek-ai/deepseek-coder-6.7b-instruct";
const HF_TIMEOUT_MS = Number(process.env.HF_TIMEOUT_MS || 120000);

async function generateWithOllama(prompt) {
  const response = await axios.post(
    `${OLLAMA_BASE_URL}/api/generate`,
    {
      model: OLLAMA_MODEL,
      prompt,
      stream: false,
      format: "json",
      options: { temperature: 0 },
    },
    { timeout: OLLAMA_TIMEOUT_MS }
  );

  const text = response?.data?.response || "";
  if (!text) throw new Error("Ollama returned empty response");
  return text;
}

async function requestHfRouter(prompt, model) {
  const chatRes = await axios.post(
    "https://router.huggingface.co/v1/chat/completions",
    {
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
    },
    {
      timeout: HF_TIMEOUT_MS,
      headers: {
        Authorization: `Bearer ${HF_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
  return chatRes?.data?.choices?.[0]?.message?.content || "";
}

async function requestHfLegacy(prompt, model) {
  const response = await axios.post(
    `https://api-inference.huggingface.co/models/${encodeURIComponent(model)}`,
    {
      inputs: prompt,
      parameters: {
        max_new_tokens: 4096,
        temperature: 0,
        return_full_text: false,
      },
      options: {
        wait_for_model: true,
      },
    },
    {
      timeout: HF_TIMEOUT_MS,
      headers: {
        Authorization: `Bearer ${HF_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );

  const data = response?.data;
  if (Array.isArray(data) && data[0]?.generated_text) return data[0].generated_text;
  if (typeof data === "object" && data?.generated_text) return data.generated_text;
  return "";
}

async function generateWithHuggingFace(prompt) {
  if (!HF_TOKEN) throw new Error("HF_TOKEN is missing");
  const models = Array.from(
    new Set(
      [HF_MODEL, ...String(HF_MODEL_FALLBACKS || "").split(",")]
        .map((m) => m.trim())
        .filter(Boolean)
    )
  );
  let lastError = null;

  for (const model of models) {
    console.log(`Trying Hugging Face model: ${model}`);

    try {
      const routerText = await requestHfRouter(prompt, model);
      if (routerText && routerText.trim()) return routerText;
    } catch (routerErr) {
      const status = routerErr?.response?.status || routerErr?.status;
      if (status === 401 || status === 403) throw routerErr;
      lastError = routerErr;
      console.warn(`HF router failed for ${model}:`, status || routerErr?.message || routerErr);
    }

    try {
      const legacyText = await requestHfLegacy(prompt, model);
      if (legacyText && legacyText.trim()) return legacyText;
      lastError = new Error(`Hugging Face returned empty content for model ${model}`);
    } catch (legacyErr) {
      const status = legacyErr?.response?.status || legacyErr?.status;
      if (status === 401 || status === 403) throw legacyErr;
      lastError = legacyErr;
      console.warn(`HF legacy failed for ${model}:`, status || legacyErr?.message || legacyErr);
      continue;
    }
  }

  throw lastError || new Error("All configured Hugging Face models failed");
}

async function generateFromLLM(prompt) {
  const provider = String(process.env.AI_PROVIDER || AI_PROVIDER || "openai").toLowerCase();

  // Use unified provider client for OpenRouter/OpenAI/Gemini/Ollama/HuggingFace.
  try {
    const completion = await requestAICompletion({
      provider,
      prompt,
      ollama: {
        baseURL: OLLAMA_BASE_URL,
        model: OLLAMA_MODEL,
        timeoutMs: OLLAMA_TIMEOUT_MS,
      },
      huggingface: {
        token: HF_TOKEN,
        model: HF_MODEL,
        timeoutMs: HF_TIMEOUT_MS,
      },
      openai: {
        apiKey:
          process.env.OPENAI_API_KEY ||
          process.env.OPENROUTER_API_KEY ||
          "",
        baseURL: process.env.OPENAI_BASE_URL || "https://openrouter.ai/api/v1",
        preferredModels: [String(process.env.OPENAI_MODEL || "openai/gpt-4.1")],
        fallbackModels: String(process.env.OPENAI_MODEL_FALLBACKS || "")
          .split(",")
          .map((m) => m.trim())
          .filter(Boolean),
      },
    });

    const text = completion?.choices?.[0]?.message?.content || "";
    if (!String(text).trim()) throw new Error("AI model returned empty content");
    return text;
  } catch (error) {
    // Legacy fallback path retained for resilience if provider client fails unexpectedly.
    if (provider === "huggingface") {
      try {
        return await generateWithHuggingFace(prompt);
      } catch (_hfErr) {
        return generateWithOllama(prompt);
      }
    }
    if (provider === "ollama") {
      return generateWithOllama(prompt);
    }
    throw error;
  }
}

module.exports = {
  generateFromLLM,
};
