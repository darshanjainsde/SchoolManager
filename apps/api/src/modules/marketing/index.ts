export { MarketingModule } from './marketing.module';
export { MarketingService } from './marketing.service';
export type { LeadDetail, LeadListItem } from './marketing.service';
export {
  CreateLeadActivityDto,
  CreateLeadDto,
  LEAD_ACTIVITY_KINDS,
  LEAD_STATUSES,
  SetLeadStatusDto,
  UpdateLeadDto,
  UpdateMarketingConfigDto,
} from './marketing.dto';
export type { LeadActivityKindValue, LeadStatusValue, PublicMarketingConfig } from './marketing.dto';
