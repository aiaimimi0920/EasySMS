import type {
  ListPublicNumbersOptions,
  ProviderDescriptor,
  SmsInboxSnapshot,
  SmsPublicNumber,
} from "../domain/models.js";

export interface SmsProvider {
  readonly descriptor: ProviderDescriptor;
  listPublicNumbers(options: ListPublicNumbersOptions): Promise<SmsPublicNumber[]>;
  getInbox(numberId: string): Promise<SmsInboxSnapshot>;
}
