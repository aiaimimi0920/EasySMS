import type { EasySmsRuntimeConfig } from "../../domain/models.js";
import { TempLikeProvider } from "../shared/temp-like-provider.js";

export function createTemporaryPhoneNumberProvider(config: EasySmsRuntimeConfig): TempLikeProvider {
  return new TempLikeProvider(config, {
    descriptor: {
      key: "temporary_phone_number",
      displayName: "Temporary Phone Number",
      homepageUrl: "https://temporary-phone-number.com",
      sourceType: "public-web-scrape",
      capabilities: ["list-public-numbers", "read-public-inbox"],
      enabled: true,
      countryHints: ["United States", "United Kingdom", "Finland", "Netherlands"],
      notes: [
        "Home page exposes recent numbers across multiple countries.",
        "Inbox pages are server-rendered and parse cleanly from direct HTML.",
      ],
    },
    listUrl: "https://temporary-phone-number.com/US-Phone-Number/",
    linkMatcher: /\/[A-Za-z-]+-Phone-Number\/\d+$/i,
  });
}
