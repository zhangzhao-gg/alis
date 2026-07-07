/**
 * [INPUT]: 无运行时依赖
 * [OUTPUT]: 对外提供 DEFAULT_AI_MODEL、AI_MODEL_OPTIONS、resolveAIModel、normalizeAIModel、getAIModelApiKey
 * [POS]: lib 层 AI 模型注册表，统一 Settings、chat completion、memory distill 的 provider 路由
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

export type AIProvider = "deepseek" | "aliyun";

export interface AIModelOption {
  value: string;
  label: string;
  provider: AIProvider;
  apiModel: string;
  baseUrl: string;
  jsonResponseFormat: boolean;
}

export interface AIProviderApiKeys {
  deepseekApiKey: string;
  aliyunApiKey: string;
}

export const DEFAULT_AI_MODEL = "deepseek-v4-flash";

export const AI_MODEL_OPTIONS: AIModelOption[] = [
  {
    value: DEFAULT_AI_MODEL,
    label: "DeepSeek V4 Flash",
    provider: "deepseek",
    apiModel: "deepseek-v4-flash",
    baseUrl: "https://api.deepseek.com",
    jsonResponseFormat: true,
  },
  {
    value: "ali-qwen-plus-character",
    label: "Ali Qwen Plus Character",
    provider: "aliyun",
    apiModel: "qwen-plus-character",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    jsonResponseFormat: false,
  },
];

export function resolveAIModel(model: string) {
  return AI_MODEL_OPTIONS.find((item) => item.value === model) ?? AI_MODEL_OPTIONS[0];
}

export function normalizeAIModel(model: string) {
  return resolveAIModel(model).value;
}

export function getAIModelApiKey(model: string, keys: AIProviderApiKeys) {
  return resolveAIModel(model).provider === "aliyun"
    ? keys.aliyunApiKey
    : keys.deepseekApiKey;
}
