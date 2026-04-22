// Shared helpers for all PRD chunks.
const {
  Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, BorderStyle, WidthType, ShadingType, PageBreak,
  AlignmentType,
} = require('docx');

const MONO_FONT = 'Consolas';
const BODY_FONT = 'Arial';

const border = { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' };
const borders = { top: border, bottom: border, left: border, right: border };
const HEADER_FILL = 'D9E2F3';
const ZEBRA_FILL = 'F2F2F2';
const CONTENT_W = 9360;

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1, pageBreakBefore: true,
    children: [new TextRun({ text, bold: true })],
  });
}
function h1NoBreak(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun({ text, bold: true })],
  });
}
function h2(text) { return new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text, bold: true })] }); }
function h3(text) { return new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun({ text, bold: true })] }); }
function h4(text) { return new Paragraph({ heading: HeadingLevel.HEADING_4, children: [new TextRun({ text, bold: true })] }); }
function p(text) { return new Paragraph({ children: [new TextRun(text)], spacing: { after: 120 } }); }
function pRuns(runs) { return new Paragraph({ children: runs, spacing: { after: 120 } }); }
function bullet(text, level = 0) {
  return new Paragraph({
    numbering: { reference: 'bullets', level },
    children: [new TextRun(text)],
    spacing: { after: 60 },
  });
}
function bulletRuns(runs, level = 0) {
  return new Paragraph({
    numbering: { reference: 'bullets', level },
    children: runs, spacing: { after: 60 },
  });
}
function num(text, level = 0) {
  return new Paragraph({
    numbering: { reference: 'numbers', level },
    children: [new TextRun(text)],
    spacing: { after: 60 },
  });
}
function code(text) {
  const lines = String(text).split('\n');
  return lines.map(line => new Paragraph({
    children: [new TextRun({ text: line || ' ', font: MONO_FONT, size: 18 })],
    spacing: { after: 0, line: 260 },
    shading: { fill: 'F5F5F5', type: ShadingType.CLEAR },
  }));
}
function pBreak() { return new Paragraph({ children: [new PageBreak()] }); }
function spacer() { return new Paragraph({ children: [new TextRun('')], spacing: { after: 120 } }); }

function table(headers, rows, colWidths) {
  const n = headers.length;
  const widths = colWidths || headers.map(() => Math.floor(CONTENT_W / n));
  // Normalise widths so they sum to CONTENT_W (avoids Word rendering glitches).
  const sum = widths.reduce((a, b) => a + b, 0);
  const norm = sum === CONTENT_W ? widths : widths.map(w => Math.round((w / sum) * CONTENT_W));
  // Fix rounding drift
  norm[norm.length - 1] += CONTENT_W - norm.reduce((a, b) => a + b, 0);

  const mk = (cells, isHeader = false, zebra = false) => new TableRow({
    tableHeader: isHeader,
    children: cells.map((c, i) => new TableCell({
      borders,
      width: { size: norm[i], type: WidthType.DXA },
      shading: { fill: isHeader ? HEADER_FILL : (zebra ? ZEBRA_FILL : 'FFFFFF'), type: ShadingType.CLEAR },
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: Array.isArray(c) ? c : [
        new Paragraph({ children: [new TextRun({ text: String(c), bold: isHeader })] }),
      ],
    })),
  });
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: norm,
    rows: [mk(headers, true)].concat(rows.map((r, idx) => mk(r, false, idx % 2 === 1))),
  });
}

module.exports = {
  MONO_FONT, BODY_FONT,
  h1, h1NoBreak, h2, h3, h4,
  p, pRuns, bullet, bulletRuns, num,
  code, pBreak, spacer, table,
  CONTENT_W,
};
