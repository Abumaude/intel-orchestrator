import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mdToPdf } from 'md-to-pdf';

/** Arguments to `renderPdf`. */
export interface RenderPdfArgs {
  markdownPath: string;
  outputPath: string;
  runSlug: string;
}

const HERE = dirname(fileURLToPath(import.meta.url));
/**
 * Path to the single v1 PDF stylesheet (ANCHOR §7.1). Per-template
 * stylesheets are out of scope.
 */
const DEFAULT_STYLESHEET = resolve(HERE, '../pdf-styles/default.css');

/** Escape characters that would break out of an HTML attribute or text node. */
function htmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Build the Puppeteer footerTemplate HTML. Run slug sits in the footer-left
 * position; automatic page numbers sit on the footer-right (ANCHOR §7.1).
 */
function buildFooterTemplate(runSlug: string): string {
  const safeSlug = htmlEscape(runSlug);
  return `<div style="font-family: Inter, Helvetica, Arial, sans-serif; font-size: 8pt; color: #555; width: 100%; padding: 0 2.5cm; display: flex; justify-content: space-between; align-items: center;">
  <span>${safeSlug}</span>
  <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
</div>`;
}

/**
 * Render a markdown file to a PDF on disk, using the single v1 stylesheet
 * and a footer that carries the run slug plus automatic page numbers.
 *
 * Throws a descriptive error if `markdownPath` does not exist or if the
 * underlying renderer fails to write the PDF.
 */
export async function renderPdf(args: RenderPdfArgs): Promise<void> {
  const { markdownPath, outputPath, runSlug } = args;

  if (!existsSync(markdownPath)) {
    throw new Error(`renderPdf: markdown file not found at ${markdownPath}`);
  }

  let result;
  try {
    result = await mdToPdf(
      { path: markdownPath },
      {
        dest: outputPath,
        stylesheet: [DEFAULT_STYLESHEET],
        launch_options: { args: ['--no-sandbox', '--disable-setuid-sandbox'] },
        pdf_options: {
          format: 'A4',
          margin: { top: '2.5cm', bottom: '2.5cm', left: '2.5cm', right: '2.5cm' },
          displayHeaderFooter: true,
          headerTemplate: '<div></div>',
          footerTemplate: buildFooterTemplate(runSlug),
          printBackground: true,
        },
      },
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`renderPdf: failed to render ${markdownPath} -> ${outputPath}: ${reason}`);
  }

  if (!result) {
    throw new Error(`renderPdf: renderer returned no output for ${markdownPath}`);
  }

  if (!existsSync(outputPath)) {
    throw new Error(`renderPdf: PDF was not written to ${outputPath}`);
  }
}
