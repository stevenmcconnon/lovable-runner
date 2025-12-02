export type UserRole = 'customer' | 'admin' | 'super-admin';

export interface ProfileRecord {
  id: string;
  accountId: string;
  email: string;
  fullName: string;
  cognitoSub: string;
  hasUsedTrial: boolean;
}

export interface ProfileDetails {
  userId: string;
  companyName?: string | null;
  title?: string | null;
  phone?: string | null;
  location?: string | null;
  photoUrl?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface AdminUserRecord extends ProfileRecord {
  roles: UserRole[];
  createdAt?: string | null;
  updatedAt?: string | null;
  isDisabled?: boolean;
}

export interface AccountSummary {
  accountId: string;
  primaryEmail?: string | null;
  userCount: number;
  siteCount: number;
  createdAt?: string | null;
  lastSiteAt?: string | null;
}

export interface AccountWithUsers extends AccountSummary {
  users: AdminUserRecord[];
}

export interface AuthContext {
  type: 'user' | 'machine';
  sub: string;
  email?: string;
  roles: UserRole[];
  profile?: ProfileRecord;
}

export interface MeResponse {
  profile: ProfileRecord;
  roles: UserRole[];
  details?: ProfileDetails | null;
}

export interface SubscriptionPlan {
  planKey: string;
  planName: string;
  priceMonthly: number;
  monthlyEditLimit: number | null;
  stripePriceId?: string | null;
}

export interface SubscriptionDetails {
  planKey: string;
  planName: string;
  priceMonthly: number;
  status: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  monthlyEditLimit?: number | null;
}

export interface UsageDetails {
  monthlyEditLimit: number;
  editsUsedThisPeriod: number;
  remainingEdits: number;
  periodStart: string | null;
  periodEnd: string | null;
}

export interface UsageLimits {
  planKey: string;
  planName: string;
  monthlyEditLimit: number;
  freeSiteLimit: number;
  dailyRebuildLimit: number;
  allowCustomDomains: boolean;
  allowLivePublishing: boolean;
  allowAiImages: boolean;
  allowSeoTools: boolean;
}

export type EditRequestStatus = 'pending' | 'in_progress' | 'completed' | 'rejected';
export type EditJobStatus = 'queued' | 'running' | 'failed' | 'completed';
export type SiteGenerationStatus =
  | 'queued'
  | 'running'
  | 'building'
  | 'deploying'
  | 'completed'
  | 'failed';

export interface EditJobRecord {
  id: string;
  editRequestId: string;
  status: EditJobStatus;
  lovableProjectId?: string | null;
  s3Key?: string | null;
  previewUrl?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EditRequestRecord {
  id: string;
  accountId: string;
  userId: string;
  description: string;
  status: EditRequestStatus;
  createdAt: string;
  updatedAt: string;
  siteId?: string | null;
  latestJob?: EditJobRecord | null;
}

export interface BusinessDetailsInput {
  businessName?: string;
  businessType?: string;
  phone?: string;
  address?: string;
  additionalDetails?: string;
}

export interface StripeCheckoutRequest {
  planKey: string;
  successUrl: string;
  cancelUrl: string;
}

export interface TemplateUploadRecord {
  templateId: string;
  fileName: string;
  uploadedAt: string;
  s3Key: string;
  uploadedBy: string;
}

export interface AdminJobFilters {
  status?: EditJobStatus;
  editRequestId?: string;
}

export interface AdminEditRequestFilters {
  status?: EditRequestStatus;
  accountId?: string;
  email?: string;
}

export interface SiteGenerationRecord {
  requestId: string;
  accountId?: string | null;
  userId?: string | null;
  sourceUrl?: string | null;
  description?: string | null;
  slug?: string | null;
  prefix?: string | null;
  bucket?: string | null;
  businessName?: string | null;
  businessType?: string | null;
  businessPhone?: string | null;
  businessAddress?: string | null;
  additionalDetails?: string | null;
  status: SiteGenerationStatus;
  publicUrl?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DomainOrderRecord {
  id: string;
  accountId?: string | null;
  slug?: string | null;
  domain: string;
  status: string;
  providerOrderId?: string | null;
  priceCents?: number | null;
  currency?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface DomainRecord {
  id: string;
  accountId?: string | null;
  slug: string;
  domain: string;
  type: string;
  provider?: string | null;
  status: string;
  isPrimary: boolean;
  verificationToken?: string | null;
  dnsSettings?: Record<string, unknown> | null;
  verifiedAt?: string | null;
  lastCheckedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface DeploymentRecord {
  id: string;
  slug: string;
  accountId?: string | null;
  target: string;
  status: string;
  bucket?: string | null;
  prefix?: string | null;
  publicUrl?: string | null;
  requestedBy?: string | null;
  errorMessage?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  completedAt?: string | null;
}
