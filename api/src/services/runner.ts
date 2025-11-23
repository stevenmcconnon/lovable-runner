import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { config } from '../env';
import { BusinessDetailsInput } from '../types';

export class RunnerService {
  private lambda = new LambdaClient({ region: config.awsRegion });

  async enqueueEditJob(params: {
    jobId: string;
    editRequestId: string;
    accountId: string;
    description: string;
    siteId?: string | null;
    businessDetails?: BusinessDetailsInput;
  }) {
    const payload = {
      action: 'RUN_EDIT_REQUEST',
      jobId: params.jobId,
      editRequestId: params.editRequestId,
      accountId: params.accountId,
      description: params.description,
      siteId: params.siteId ?? null,
      businessDetails: params.businessDetails ?? null,
    };

    await this.lambda.send(
      new InvokeCommand({
        FunctionName: config.runner.functionName,
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify(payload)),
      })
    );
  }
}
