import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { Resend } from 'resend';

/** Arguments to `ResendClient.sendBriefEmail`. */
export interface SendBriefEmailArgs {
  to: string;
  runSlug: string;
  briefName: string;
  pdfPath: string;
}

/** Result of `ResendClient.sendBriefEmail`. */
export interface SendBriefEmailResult {
  messageId: string;
}

/**
 * Format the run date as an ISO calendar date (YYYY-MM-DD) for use in the
 * email subject line.
 */
function isoDate(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Lightweight recipient-shape check. Full format validation is left to
 * Resend; this only catches obviously malformed values before paying for an
 * API round-trip.
 */
function looksLikeEmail(value: string): boolean {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * Thin wrapper around the official Resend SDK used by Stage 4 (Deliver).
 * Sends a transactional email with the brief PDF attached. No link tracking,
 * open tracking, click rewriting, or list management (drift flag #10,
 * ANCHOR §7.2).
 */
export class ResendClient {
  private readonly resend: Resend;
  private readonly fromEmail: string;

  /** Construct a Resend client bound to `apiKey` and a verified sender address. */
  constructor({ apiKey, fromEmail }: { apiKey: string; fromEmail: string }) {
    if (!apiKey) {
      throw new Error('ResendClient: apiKey is required');
    }
    if (!fromEmail) {
      throw new Error('ResendClient: fromEmail is required');
    }
    this.resend = new Resend(apiKey);
    this.fromEmail = fromEmail;
  }

  /**
   * Send a brief PDF to the configured client recipient. Subject is
   * `[Intel Brief] ${briefName} — ${date}`; body is a short plain-text
   * acknowledgement naming the brief and the run slug. Returns the Resend
   * message ID on success (ANCHOR §7.2).
   *
   * Throws with a one-line reason if the recipient is malformed, the PDF
   * cannot be read, or Resend returns an error.
   */
  async sendBriefEmail(args: SendBriefEmailArgs): Promise<SendBriefEmailResult> {
    const { to, runSlug, briefName, pdfPath } = args;

    if (!looksLikeEmail(to)) {
      throw new Error(`ResendClient.sendBriefEmail: invalid recipient "${to}"`);
    }

    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await readFile(pdfPath);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`ResendClient.sendBriefEmail: cannot read PDF at ${pdfPath}: ${reason}`);
    }

    const subject = `[Intel Brief] ${briefName} — ${isoDate()}`;
    const text = [
      `Your intelligence brief "${briefName}" is attached.`,
      ``,
      `Run: ${runSlug}`,
    ].join('\n');

    const response = await this.resend.emails.send({
      from: this.fromEmail,
      to,
      subject,
      text,
      attachments: [
        {
          filename: basename(pdfPath),
          content: pdfBuffer,
          contentType: 'application/pdf',
        },
      ],
    });

    if (response.error) {
      throw new Error(
        `ResendClient.sendBriefEmail: Resend rejected send to ${to} (${response.error.name}): ${response.error.message}`,
      );
    }

    if (!response.data?.id) {
      throw new Error(
        `ResendClient.sendBriefEmail: Resend response missing message id for send to ${to}`,
      );
    }

    return { messageId: response.data.id };
  }
}
