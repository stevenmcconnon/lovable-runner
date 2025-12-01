export type UserRole = 'customer' | 'admin' | 'super-admin';

export interface ProfileRecord {
  id: string;
  accountId: string;
  email: string;
  fullName: string;
  cognitoSub: string;
  hasUsedTrial: boolean;
}

export interface AuthContext {
  type: 'user' | 'machine';
  sub: string;
  email?: string;
  roles: UserRole[];
  profile?: ProfileRecord;
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
