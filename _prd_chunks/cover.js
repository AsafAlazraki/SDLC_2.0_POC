// Cover page + TOC
const { Paragraph, TextRun, AlignmentType, PageBreak, HeadingLevel,
        TableOfContents } = require('docx');

module.exports = [
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 3600, after: 240 },
    children: [new TextRun({ text: 'REQUIREMENTS INTELLIGENCE PLATFORM', size: 52, bold: true, color: '1F3864' })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 240 },
    children: [new TextRun({ text: 'Product Requirements Document', size: 36, color: '2E74B5' })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 720 },
    children: [new TextRun({ text: 'OutSystems Rebuild Specification', size: 28, italics: true, color: '595959' })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
    children: [new TextRun({ text: 'From a raw customer requirements spreadsheet to a fully groomed,', size: 24, italics: true, color: '595959' })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
    children: [new TextRun({ text: 'dependency-aware, Jira-ready Epic \u2192 Feature \u2192 Story backlog in under an hour \u2014', size: 24, italics: true, color: '595959' })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 2400 },
    children: [new TextRun({ text: 'with ODC Mentor 2.0 prompts developers can paste straight into OutSystems.', size: 24, italics: true, color: '595959' })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
    children: [new TextRun({ text: 'Version 1.0 \u2022 Status: Draft for OutSystems rebuild', size: 22, color: '595959' })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
    children: [new TextRun({ text: 'Prepared by: Asaf Alazraki', size: 22, color: '595959' })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: new Date().toISOString().slice(0, 10), size: 22, color: '595959' })],
  }),
  new Paragraph({ children: [new PageBreak()] }),

  // Table of contents
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun({ text: 'Table of Contents', bold: true })],
  }),
  new Paragraph({ children: [new TextRun({ text: '(right-click \u2192 Update Field to refresh once opened in Word)', size: 20, italics: true, color: '808080' })] }),
  new Paragraph({ children: [new TextRun('')] }),
  new TableOfContents('Contents', { hyperlink: true, headingStyleRange: '1-3' }),
  new Paragraph({ children: [new PageBreak()] }),
];
