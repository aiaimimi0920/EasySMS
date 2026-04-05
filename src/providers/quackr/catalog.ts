export interface QuackrCountryMetadata {
  countryCode: string;
  countryName: string;
  locale: string;
  slug: string;
}

const quackrCountryCatalog: Record<string, QuackrCountryMetadata> = {
  au: { locale: "au", countryName: "Australia", countryCode: "+61", slug: "australia" },
  at: { locale: "at", countryName: "Austria", countryCode: "+43", slug: "austria" },
  be: { locale: "be", countryName: "Belgium", countryCode: "+32", slug: "belgium" },
  br: { locale: "br", countryName: "Brazil", countryCode: "+55", slug: "brazil" },
  ca: { locale: "ca", countryName: "Canada", countryCode: "+1", slug: "canada" },
  cn: { locale: "cn", countryName: "China", countryCode: "+86", slug: "china" },
  de: { locale: "de", countryName: "Germany", countryCode: "+49", slug: "germany" },
  es: { locale: "es", countryName: "Spain", countryCode: "+34", slug: "spain" },
  fi: { locale: "fi", countryName: "Finland", countryCode: "+358", slug: "finland" },
  fr: { locale: "fr", countryName: "France", countryCode: "+33", slug: "france" },
  hu: { locale: "hu", countryName: "Hungary", countryCode: "+36", slug: "hungary" },
  id: { locale: "id", countryName: "Indonesia", countryCode: "+62", slug: "indonesia" },
  in: { locale: "in", countryName: "India", countryCode: "+91", slug: "india" },
  kr: { locale: "kr", countryName: "Korea", countryCode: "+82", slug: "korea" },
  lt: { locale: "lt", countryName: "Lithuania", countryCode: "+370", slug: "lithuania" },
  ma: { locale: "ma", countryName: "Morocco", countryCode: "+212", slug: "morocco" },
  mx: { locale: "mx", countryName: "Mexico", countryCode: "+52", slug: "mexico" },
  nl: { locale: "nl", countryName: "Netherlands", countryCode: "+31", slug: "netherlands" },
  pk: { locale: "pk", countryName: "Pakistan", countryCode: "+92", slug: "pakistan" },
  pl: { locale: "pl", countryName: "Poland", countryCode: "+48", slug: "poland" },
  pt: { locale: "pt", countryName: "Portugal", countryCode: "+351", slug: "portugal" },
  rs: { locale: "rs", countryName: "Serbia", countryCode: "+381", slug: "serbia" },
  ru: { locale: "ru", countryName: "Russia", countryCode: "+7", slug: "russia" },
  se: { locale: "se", countryName: "Sweden", countryCode: "+46", slug: "sweden" },
  si: { locale: "si", countryName: "Slovenia", countryCode: "+386", slug: "slovenia" },
  th: { locale: "th", countryName: "Thailand", countryCode: "+66", slug: "thailand" },
  uk: { locale: "uk", countryName: "United Kingdom", countryCode: "+44", slug: "united-kingdom" },
  us: { locale: "us", countryName: "United States", countryCode: "+1", slug: "united-states" },
  za: { locale: "za", countryName: "South Africa", countryCode: "+27", slug: "south-africa" },
};

export function getQuackrCountryMetadata(locale: string | undefined): QuackrCountryMetadata | undefined {
  if (!locale) {
    return undefined;
  }

  return quackrCountryCatalog[locale.toLowerCase()];
}

export function getQuackrLocaleRank(locale: string | undefined): number {
  const key = (locale ?? "").toLowerCase();
  const locales = Object.keys(quackrCountryCatalog);
  const index = locales.indexOf(key);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

export function buildQuackrNumberUrl(countrySlug: string, phoneNumberDigits: string): string {
  return `https://quackr.io/temporary-numbers/${countrySlug}/${phoneNumberDigits}`;
}

export function parseQuackrAddedAt(value: number | string | undefined): number | undefined {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) {
    return undefined;
  }

  return raw > 1_000_000_000_000 ? raw : raw * 1000;
}
