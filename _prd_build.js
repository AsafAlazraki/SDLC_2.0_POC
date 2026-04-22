// PRD builder for Requirements Intelligence Platform
// Run: node _prd_build.js → produces PRD-Requirements-Intelligence-Platform.docx
// This file is ephemeral and not tracked by git.

const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, PageOrientation, LevelFormat,
  HeadingLevel, BorderStyle, WidthType, ShadingType, PageBreak,
  PageNumber, TableOfContents, TabStopType, TabStopPosition,
  ExternalHyperlink,
} = require('docx');
const fs = require('fs');
const path = require('path');

// ─── Shared helpers ─────────────────────────────────────────────────────────
const MONO_FONT = 'Consolas';
const BODY_FONT = 'Arial';

const border = { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' };
const borders = { top: border, bottom: border, left: border, right: border };
const HEADER_FILL = 'D9E2F3';
const ZEBRA_FILL = 'F2F2F2';

// Page layout: US Letter with 1" margins → content width = 9360 DXA
const CONTENT_W = 9360;

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    pageBreakBefore: true,
    children: [new TextRun({ text, bold: true })],
  });
}
function h1NoBreak(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun({ text, bold: true })],
  });
}
function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun({ text, bold: true })],
  });
}
function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    children: [new TextRun({ text, bold: true })],
  });
}
function h4(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_4,
    children: [new TextRun({ text, bold: true })],
  });
}
function p(text) {
  return new Paragraph({ children: [new TextRun(text)], spacing: { after: 120 } });
}
function pRuns(runs) {
  return new Paragraph({ children: runs, spacing: { after: 120 } });
}
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
    children: runs,
    spacing: { after: 60 },
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

// Build a table from a header row and an array of row arrays.
function table(headers, rows, colWidths) {
  const n = headers.length;
  const widths = colWidths || headers.map(() => Math.floor(CONTENT_W / n));
  const mk = (cells, isHeader = false, zebra = false) => new TableRow({
    tableHeader: isHeader,
    children: cells.map((c, i) => new TableCell({
      borders,
      width: { size: widths[i], type: WidthType.DXA },
      shading: { fill: isHeader ? HEADER_FILL : (zebra ? ZEBRA_FILL : 'FFFFFF'), type: ShadingType.CLEAR },
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: Array.isArray(c)
        ? c
        : [new Paragraph({ children: [new TextRun({ text: String(c), bold: isHeader })] })],
    })),
  });
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: widths,
    rows: [mk(headers, true)].concat(rows.map((r, idx) => mk(r, false, idx % 2 === 1))),
  });
}

// ─── Load content chunks (each module as a .js returning arrays of children) ─
const sections = [];

// Cover + document control + TOC
sections.push(...require('./_prd_chunks/cover'));
sections.push(...require('./_prd_chunks/sec_00_control'));
sections.push(...require('./_prd_chunks/sec_01_exec_summary'));
sections.push(...require('./_prd_chunks/sec_02_problem'));
sections.push(...require('./_prd_chunks/sec_03_vision'));
sections.push(...require('./_prd_chunks/sec_04_personas'));
sections.push(...require('./_prd_chunks/sec_05_scope'));
sections.push(...require('./_prd_chunks/sec_06_journeys'));
sections.push(...require('./_prd_chunks/sec_07_fr'));
sections.push(...require('./_prd_chunks/sec_08_nfr'));
sections.push(...require('./_prd_chunks/sec_09_data_model'));
sections.push(...require('./_prd_chunks/sec_10_screens'));
sections.push(...require('./_prd_chunks/sec_11_ia'));
sections.push(...require('./_prd_chunks/sec_12_state'));
sections.push(...require('./_prd_chunks/sec_13_integrations'));
sections.push(...require('./_prd_chunks/sec_14_ac'));
sections.push(...require('./_prd_chunks/sec_15_metrics'));
sections.push(...require('./_prd_chunks/sec_16_risks'));
sections.push(...require('./_prd_chunks/sec_17_outsystems'));
sections.push(...require('./_prd_chunks/sec_18_glossary'));
sections.push(...require('./_prd_chunks/sec_19_appendices'));

// If invoked directly, build the doc.
if (require.main === module) {
  const doc = new Document({
    styles: {
      default: { document: { run: { font: BODY_FONT, size: 22 } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 36, bold: true, font: BODY_FONT, color: '1F3864' },
          paragraph: { spacing: { before: 360, after: 200 }, outlineLevel: 0 } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 28, bold: true, font: BODY_FONT, color: '2E74B5' },
          paragraph: { spacing: { before: 280, after: 140 }, outlineLevel: 1 } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 24, bold: true, font: BODY_FONT, color: '2E74B5' },
          paragraph: { spacing: { before: 220, after: 120 }, outlineLevel: 2 } },
        { id: 'Heading4', name: 'Heading 4', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 22, bold: true, italics: true, font: BODY_FONT, color: '2E74B5' },
          paragraph: { spacing: { before: 180, after: 100 }, outlineLevel: 3 } },
      ],
    },
    numbering: {
      config: [
        { reference: 'bullets',
          levels: [
            { level: 0, format: LevelFormat.BULLET, text: '\u2022', alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
            { level: 1, format: LevelFormat.BULLET, text: '\u25E6', alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 1440, hanging: 360 } } } },
            { level: 2, format: LevelFormat.BULLET, text: '\u25AA', alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 2160, hanging: 360 } } } },
          ] },
        { reference: 'numbers',
          levels: [
            { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
            { level: 1, format: LevelFormat.DECIMAL, text: '%2.', alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 1440, hanging: 360 } } } },
          ] },
      ],
    },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      headers: {
        default: new Header({ children: [new Paragraph({
          children: [
            new TextRun({ text: 'PRD — Requirements Intelligence Platform', size: 18, color: '808080' }),
            new TextRun('\t'),
            new TextRun({ text: 'Draft v1.0', size: 18, color: '808080' }),
          ],
          tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
        })] }),
      },
      footers: {
        default: new Footer({ children: [new Paragraph({
          children: [
            new TextRun({ text: 'Confidential — for internal OutSystems rebuild planning', size: 18, color: '808080' }),
            new TextRun('\t'),
            new TextRun({ text: 'Page ', size: 18, color: '808080' }),
            new TextRun({ children: [PageNumber.CURRENT], size: 18, color: '808080' }),
            new TextRun({ text: ' of ', size: 18, color: '808080' }),
            new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 18, color: '808080' }),
          ],
          tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
        })] }),
      },
      children: sections,
    }],
  });

  Packer.toBuffer(doc).then(buf => {
    const out = path.resolve(__dirname, 'PRD-Requirements-Intelligence-Platform.docx');
    fs.writeFileSync(out, buf);
    console.log('Wrote', out, `(${buf.length.toLocaleString()} bytes)`);
  }).catch(e => { console.error('PRD build failed:', e); process.exit(1); });
}
