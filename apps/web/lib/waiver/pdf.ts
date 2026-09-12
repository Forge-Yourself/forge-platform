import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { WAIVER_VERSION, waiverBodyText } from './text';

export type RenderWaiverInput = {
  clientName: string;
  ptName: string;
  /** Raw SVG path data from SignaturePad — drawn as a stroke, never rasterized. */
  signatureSvgPath: string;
  signedAt: Date;
};

const PAGE_WIDTH = 595.28; // A4 at 72dpi
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;
const BODY_SIZE = 10.5;
const LINE_HEIGHT = 15.5; // ~1.48x, close to the client screen's 13px/1.65 at PDF scale

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function drawWrappedText(page: PDFPage, text: string, font: PDFFont, size: number, startY: number): number {
  const maxWidth = PAGE_WIDTH - MARGIN * 2;
  const lines = wrapText(text, font, size, maxWidth);
  let y = startY;
  for (const line of lines) {
    page.drawText(line, { x: MARGIN, y, size, font, color: rgb(0.15, 0.15, 0.15) });
    y -= LINE_HEIGHT;
  }
  return y;
}

/**
 * Renders the signed waiver as a PDF: body text, client/PT names, the
 * signature stroke, a timestamp, and WAIVER_VERSION in the footer.
 *
 * v1 always renders the English waiver body regardless of the client's
 * locale — pdf-lib's built-in StandardFonts (WinAnsi encoding) cannot render
 * Arabic glyphs at all without embedding a separate Unicode-capable font via
 * fontkit, which this milestone doesn't add. Rendering English rather than
 * throwing (or silently producing garbage glyphs) is the deliberate choice
 * here; a real Arabic-capable render is additive follow-up work, not a
 * silent gap — see the milestone plan's risk list.
 */
export async function renderWaiverPdf(input: RenderWaiverInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  let y = PAGE_HEIGHT - MARGIN;

  page.drawText('Forge — Liability Waiver', { x: MARGIN, y, size: 18, font: boldFont, color: rgb(0, 0, 0) });
  y -= 30;

  page.drawText(`Client: ${input.clientName}`, { x: MARGIN, y, size: 11, font: boldFont });
  y -= 16;
  page.drawText(`Trainer: ${input.ptName}`, { x: MARGIN, y, size: 11, font: boldFont });
  y -= 28;

  y = drawWrappedText(page, waiverBodyText('en'), font, BODY_SIZE, y);
  y -= 30;

  page.drawText('Signature:', { x: MARGIN, y, size: 11, font: boldFont });
  y -= 8;

  const signatureBoxTop = y;
  if (input.signatureSvgPath) {
    page.drawSvgPath(input.signatureSvgPath, {
      x: MARGIN,
      y: signatureBoxTop,
      scale: 1,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1.5,
    });
  }
  y -= 90;

  page.drawText(`Signed: ${input.signedAt.toISOString()}`, { x: MARGIN, y, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
  y -= 20;
  page.drawText(`Waiver version: ${WAIVER_VERSION}`, { x: MARGIN, y, size: 9, font, color: rgb(0.4, 0.4, 0.4) });

  return doc.save();
}
