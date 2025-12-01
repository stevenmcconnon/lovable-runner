declare module '../../src/launch' {
  export function runLaunch(params: {
    url?: string;
    description?: string;
    businessDetails?: any;
    requestId?: string;
    testMode?: boolean;
    onProgress?: (stage: string) => Promise<void> | void;
  }): Promise<{
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
}

declare module '../../src/launch-tracker' {
  export function recordLaunchStatus(args: {
    requestId: string;
    status: string;
    result?: any;
    error?: any;
  }): Promise<void>;
}
