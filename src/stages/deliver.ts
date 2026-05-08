import { join } from 'node:path';
import type { ClientProfile } from '../schemas/index.js';
import { ResendClient } from '../clients/resend-client.js';

/** Arguments to `runDeliverStage`. */
export interface RunDeliverStageArgs {
  runDir: string;
  clientProfile: ClientProfile;
  runSlug: string;
  briefName: string;
  resend: ResendClient;
}

/** Result of `runDeliverStage`. */
export interface RunDeliverStageResult {
  messageId: string;
}

/**
 * Stage 4 (Deliver): emails the rendered PDF to the client's
 * `delivery_email` and returns the Resend message ID. The PDF stays in the
 * run folder regardless of whether delivery succeeds (ANCHOR §2.5, §7.3).
 */
export async function runDeliverStage(
  args: RunDeliverStageArgs,
): Promise<RunDeliverStageResult> {
  const { runDir, clientProfile, runSlug, briefName, resend } = args;
  const pdfPath = join(runDir, 'brief.pdf');
  return resend.sendBriefEmail({
    to: clientProfile.delivery_email,
    runSlug,
    briefName,
    pdfPath,
  });
}
