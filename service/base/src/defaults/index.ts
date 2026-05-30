import type { EasySmsRuntimeConfig } from "../domain/models.js";

export const defaultEasySmsRuntimeConfig: EasySmsRuntimeConfig = {
  server: {
    host: "0.0.0.0",
    port: 8080,
  },
  strategy: {
    strictProviderMode: false,
    providerStrategyModeId: "aggregate-latest",
  },
  maintenance: {
    enabled: true,
    intervalMs: 30000,
    keepRecentCount: 100,
    activeProbeEnabled: true,
    activeProbeIntervalMs: 300000,
    probeHistoryMaxEntries: 24,
    probeHistoryWindowMs: 86400000,
  },
  persistence: {
    enabled: false,
    driver: "file",
    intervalMs: 60000,
    filePath: "state/easy-sms-state.json",
  },
  scraping: {
    requestTimeoutMs: 15000,
    maxNumbersPerProvider: 20,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
  },
  providers: {
    enabledProviders: [
      "onlinesim",
      "smstome",
      "receive_smss",
      "receive_sms_free_cc",
      "sms24",
      "yunduanxin",
    ],
    onlineSim: {
      apiKey: "",
    },
    smsToMe: {
      email: "",
      password: "",
    },
    receiveSmss: {
      username: "",
      password: "",
    },
    receiveSmsFreeCc: {
      email: "",
      password: "",
    },
    synthetic: {
      leaseWindowSeconds: 20 * 60,
      terminalOutcomeCooldownSeconds: 2 * 60 * 60,
    },
    heroSms: {
      enabled: false,
      apiKey: "",
      baseUrl: "https://hero-sms.com/stubs/handler_api.php",
      defaultService: "dr",
      defaultCountry: 16,
      selectionMode: "balanced",
      reuseEnabled: true,
      defaultMaxBindingsPerPhone: 1,
      refundableCancelWindowSeconds: 120,
      leaseWindowSeconds: 20 * 60,
    },
  },
};
