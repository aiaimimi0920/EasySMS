import type { EasySmsRuntimeConfig } from "../../domain/models.js";
import { TempLikeProvider } from "../shared/temp-like-provider.js";

export function createReceiveSmsFreeCcProvider(config: EasySmsRuntimeConfig): TempLikeProvider {
  return new TempLikeProvider(config, {
    descriptor: {
      key: "receive_sms_free_cc",
      displayName: "Receive-SMS-Free.cc",
      homepageUrl: "https://receive-sms-free.cc",
      sourceType: "public-web-scrape",
      capabilities: ["list-public-numbers", "read-public-inbox"],
      enabled: true,
      countryHints: ["United States", "Finland", "Netherlands", "Slovenia"],
      notes: [
        "Template is very similar to temporary-phone-number.com, so the same parser is reused.",
        "Some messages are partially masked by the source site, but HTML remains readable.",
      ],
    },
    listUrl: "https://receive-sms-free.cc/Free-USA-Phone-Number/",
    linkMatcher: /\/[A-Za-z-]+-Phone-Number\/\d+\/$/i,
  });
}
