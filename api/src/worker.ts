import path from 'node:path';

const resolveRootModule = (relativePath: string) => {
  try {
    return require(path.join(process.cwd(), relativePath));
  } catch (error) {
    // Fallback to resolving relative to the compiled file location (useful in tests)
    return require(path.join(__dirname, '..', relativePath));
  }
};

type RunLaunch = (params: {
  url?: string;
  description?: string;
  businessDetails?: BusinessDetailsInput;
  requestId?: string;
  testMode?: boolean;
  onProgress?: (stage: string) => Promise<void> | void;
}) => Promise<{
  slug: string;
  bucket: string;
  prefix: string;
  publicUrl: string;
  builtFromProject?: boolean;
  gitArchive?: {
    repoUrl: string;
    branch: string;
    path: string;
    commit?: string;
    committed: boolean;
    commitMessage: string;
  } | null;
  requestId?: string;
}>;

type RecordStatus = (args: { requestId: string; status: string; result?: any; error?: any }) => Promise<void>;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { runLaunch }: { runLaunch: RunLaunch } = resolveRootModule('src/launch');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { recordLaunchStatus }: { recordLaunchStatus: RecordStatus } = resolveRootModule('src/launch-tracker');
import { DatabaseService } from './services/database';
import { BusinessDetailsInput } from './types';

const db = new DatabaseService();

type SiteLaunchEvent = {
  requestId: string;
  url?: string;
  description?: string;
  businessDetails?: BusinessDetailsInput;
  testMode?: boolean;
};

const updateStatus = async (requestId: string, status: string, extras: Record<string, unknown> = {}) => {
  await db.updateSiteGeneration(requestId, {
    status: status as any,
    ...extras,
  });
  await recordLaunchStatus({ requestId, status, result: extras });
};

export const handleSiteLaunchJob = async (event: SiteLaunchEvent) => {
  if (!event?.requestId) throw new Error('requestId is required');
  const requestId = event.requestId;
  const referenceUrl = event.url;
  const businessDetails = event.businessDetails;
  const description = event.description || '';
  const testMode = Boolean(event.testMode);
  const reportStage = async (stage: string) => {
    await updateStatus(requestId, stage);
  };
  await reportStage('running');
  try {
    const result = await runLaunch({
      url: referenceUrl,
      description,
      businessDetails,
      requestId,
      testMode,
      onProgress: reportStage,
    });
    await updateStatus(requestId, 'completed', {
      bucket: result.bucket,
      prefix: result.prefix,
      slug: result.slug,
      publicUrl: result.publicUrl,
      builtFromProject: result.builtFromProject,
      gitArchive: result.gitArchive,
    });
    return {
      requestId,
      ...result,
      status: 'completed',
    };
  } catch (error: any) {
    await updateStatus(requestId, 'failed', {
      errorMessage: error?.message || 'Generation failed',
    });
    throw error;
  }
};
