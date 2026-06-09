import type {
  EasySmsSnapshotMode,
  GetInboxOptions,
  HeroSmsActivationAction,
  HeroSmsActivationCreateInput,
  ListPublicNumbersOptions,
  ObserveSmsMessageInput,
  RecoverSmsSessionByPhoneRequest,
  SmsProviderHealthQueryFilters,
  SmsProviderProbeHistoryQueryFilters,
  SmsSessionMessageQueryFilters,
  SmsSessionOutcomeReport,
  SmsSessionQueryFilters,
} from "../domain/models.js";
import {
  SmsObservedMessageNotFoundError,
  SmsSessionNotFoundError,
} from "../domain/errors.js";
import type { EasySmsService } from "../service/easy-sms-service.js";

export class EasySmsHttpHandler {
  public constructor(private readonly service: EasySmsService) {}

  public getCatalog() {
    return { catalog: this.service.getCatalog() };
  }

  public getSnapshot(mode: EasySmsSnapshotMode = "summary") {
    return { snapshot: this.service.getSnapshot(mode) };
  }

  public getRuntimeDiagnostics() {
    return { runtime: this.service.getRuntimeDiagnostics() };
  }

  public getHealthz() {
    return {
      status: "ok",
      service: "easy-sms",
      providerCount: this.service.listProviders().length,
      strategyModeId: this.service.config.strategy.providerStrategyModeId,
      health: this.service.getHealthSummary(),
    };
  }

  public async planSession(
    input: HeroSmsActivationCreateInput,
    options: { providerKey?: string; costTier?: "free" | "paid" },
  ) {
    return { plan: await this.service.planSession(input, options) };
  }

  public async openSession(
    input: HeroSmsActivationCreateInput,
    options: { providerKey?: string; costTier?: "free" | "paid" },
  ) {
    return { session: await this.service.openSession(input, options) };
  }

  public recoverSessionByPhone(request: RecoverSmsSessionByPhoneRequest) {
    return { result: this.service.recoverSessionByPhone(request) };
  }

  public reportSessionOutcome(report: SmsSessionOutcomeReport) {
    return { result: this.service.reportSessionOutcome(report) };
  }

  public observeMessage(input: ObserveSmsMessageInput) {
    return { message: this.service.observeSessionMessage(input) };
  }

  public async readSessionStatus(sessionId: string) {
    return { status: await this.service.readSessionStatus(sessionId) };
  }

  public async readSessionCode(sessionId: string) {
    return { code: await this.service.readSessionCode(sessionId) };
  }

  public async readSessionMessages(sessionId: string) {
    return { messages: await this.service.listSessionMessages(sessionId) };
  }

  public async updateSessionAction(sessionId: string, action: HeroSmsActivationAction) {
    return { result: await this.service.updateSessionAction(sessionId, action) };
  }

  public queryProviders(filters: { costTier?: "free" | "paid"; capability?: string } = {}) {
    return { providers: this.service.listProviders(filters) };
  }

  public queryProviderHealth(filters: SmsProviderHealthQueryFilters = {}) {
    const includeProviders = filters.includeProviders ?? (filters.mode !== "summary");
    const includeRoutes = filters.includeRoutes ?? (filters.mode !== "summary");
    const includeTrends = filters.includeTrends ?? (filters.mode !== "summary");

    return {
      summary: this.service.getHealthSummary(),
      ...(includeProviders ? {
        providers: filters.providerKey
          ? this.service.listProviderHealth().filter((provider) => provider.providerKey === filters.providerKey)
          : this.service.listProviderHealth(),
      } : {}),
      ...(includeRoutes ? {
        routes: this.service.listRouteHealth(filters.providerKey),
      } : {}),
      ...(includeTrends ? {
        trends: this.service.listProbeTrends(filters.providerKey),
      } : {}),
    };
  }

  public queryProviderProbeHistory(filters: SmsProviderProbeHistoryQueryFilters = {}) {
    const includeHistory = filters.includeHistory ?? (filters.mode !== "summary");
    const includeTrends = filters.includeTrends ?? (filters.mode !== "summary");
    return {
      ...(includeHistory ? {
        history: this.service.listProbeHistory(filters),
      } : {}),
      ...(includeTrends ? {
        trends: this.service.listProbeTrends(filters.providerKey),
      } : {}),
    };
  }

  public async queryProviderSelectionPlan(
    options: Pick<
      ListPublicNumbersOptions,
      "countryCode" | "countryName" | "providerKey" | "costTier" | "limit" | "phoneBlacklist" | "providerPhoneBlacklist" | "allowReuse"
    > = {},
  ) {
    return {
      strategyModeId: this.service.config.strategy.providerStrategyModeId,
      routeKind: "list-public-numbers",
      candidates: await this.service.queryListSelectionPlan(options),
    };
  }

  public querySessions(filters: SmsSessionQueryFilters = {}) {
    return { sessions: this.service.querySessions(filters) };
  }

  public getSession(sessionId: string) {
    const session = this.service.getSessionById(sessionId);
    if (!session) {
      throw new SmsSessionNotFoundError(sessionId);
    }
    return { session };
  }

  public async queryObservedMessages(filters: SmsSessionMessageQueryFilters = {}) {
    return { messages: await this.service.queryObservedMessages(filters) };
  }

  public async getObservedMessage(
    messageId: string,
    filters: Pick<SmsSessionMessageQueryFilters, "refreshProjected"> = {},
  ) {
    const message = await this.service.getObservedMessageById(messageId, filters);
    if (!message) {
      throw new SmsObservedMessageNotFoundError(messageId);
    }
    return { message };
  }

  public getStats() {
    return { stats: this.service.getPersistenceStats() };
  }

  public getHeroSmsStats() {
    return { stats: this.service.getHeroSmsStats() };
  }

  public async probeAllProviders() {
    return { probes: await this.service.probeAllProviders() };
  }

  public async probeProvider(providerKey: string) {
    return { probe: await this.service.probeProvider(providerKey) };
  }

  public runMaintenance() {
    const startedAt = new Date();
    try {
      const maintenance = this.service.runMaintenance();
      const refreshedCount = maintenance.refreshed.providers.length + maintenance.refreshed.routes.length;
      this.service.recordMaintenanceLoopSuccess(
        startedAt,
        `Manual maintenance refreshed ${refreshedCount} operational-state entries via HTTP.`,
      );
      return { maintenance };
    } catch (error) {
      this.service.recordMaintenanceLoopFailure(startedAt, error, "Manual maintenance failed via HTTP.");
      throw error;
    }
  }

  public getLegacyProviderCatalog(filters: { costTier?: "free" | "paid"; capability?: string } = {}) {
    return { providers: this.service.listProviders(filters) };
  }

  public getLegacyProviderHealth(providerKey?: string) {
    return this.queryProviderHealth({
      providerKey: providerKey as SmsProviderHealthQueryFilters["providerKey"] | undefined,
      mode: "detail",
    });
  }

  public getLegacyProbeHistory(providerKey?: string) {
    return this.queryProviderProbeHistory({
      providerKey: providerKey as SmsProviderProbeHistoryQueryFilters["providerKey"] | undefined,
    });
  }

  public getLegacySelectionPlan(options: Pick<ListPublicNumbersOptions, "countryCode" | "countryName" | "providerKey" | "costTier" | "limit"> = {}) {
    return this.queryProviderSelectionPlan(options);
  }

  public async legacyProbe(providerKey?: string) {
    return {
      results: providerKey
        ? [await this.service.probeProvider(providerKey)]
        : await this.service.probeAllProviders(),
    };
  }

  public async listPublicNumbers(options: ListPublicNumbersOptions) {
    return this.service.listPublicNumbers(options);
  }

  public async getInbox(options: GetInboxOptions) {
    return this.service.getInbox(options);
  }

  public async listFacadeCountries(options: { providerKey?: string; costTier?: "free" | "paid" }) {
    return this.service.listFacadeCountries(options);
  }

  public async getFacadePrices(service: string, options: { providerKey?: string; costTier?: "free" | "paid" }) {
    return this.service.getFacadePrices(service, options);
  }

  public async listFacadeTopCountries(
    service: string,
    ranked: boolean,
    options: { providerKey?: string; costTier?: "free" | "paid" },
  ) {
    return this.service.listFacadeTopCountries(service, ranked, options);
  }

  public async listFacadeOperatorQuotes(
    country: number,
    service: string,
    options: { providerKey?: string; costTier?: "free" | "paid" },
  ) {
    return this.service.listFacadeOperatorQuotes(country, service, options);
  }

  public async resolveFacadeCountry(
    countryId: number,
    options: { providerKey?: string; costTier?: "free" | "paid" },
  ) {
    return this.service.resolveFacadeCountry(countryId, options);
  }

  public async createActivation(
    input: HeroSmsActivationCreateInput,
    options: { providerKey?: string; costTier?: "free" | "paid" },
  ) {
    return await this.service.createActivation(input, options);
  }

  public async getActivationStatus(
    activationId: number,
    options: { providerKey?: string; costTier?: "free" | "paid" },
  ) {
    return await this.service.getActivationStatus(activationId, options);
  }

  public async setActivationStatus(
    activationId: number,
    action: HeroSmsActivationAction,
    options: { providerKey?: string; costTier?: "free" | "paid" },
  ) {
    return await this.service.setActivationStatus(activationId, action, options);
  }

  public async listHeroSmsCountries() {
    return this.service.listHeroSmsCountries();
  }

  public async listHeroSmsTopCountries(service: string, ranked: boolean) {
    return this.service.listHeroSmsTopCountries(service, ranked);
  }

  public async listHeroSmsOperatorQuotes(country: number, service: string) {
    return this.service.listHeroSmsOperatorQuotes(country, service);
  }

  public disableProviderTemporarily(providerKey: string, input: { reason: string; until: Date }) {
    return { provider: this.service.disableProviderTemporarily(providerKey, input) };
  }

  public enableProvider(providerKey: string) {
    return { provider: this.service.enableProvider(providerKey) };
  }

  public resetOperationalState(providerKey?: string) {
    return this.service.resetOperationalState(providerKey);
  }
}
