# Skill: Document Creation

When asked to create documents, presentations, or spreadsheets, generate them as self-contained HTML files that can be printed or saved as PDF.

## Reports & Documents
Structure for professional documents:
```html
<style>
  @page { size: A4; margin: 2.5cm; }
  @media print { .no-print { display: none; } }
  body { font-family: 'Georgia', serif; font-size: 12pt; line-height: 1.8; color: #1a1a1a; max-width: 800px; margin: 0 auto; padding: 2rem; }
  h1 { font-size: 24pt; border-bottom: 2px solid #1a1a1a; padding-bottom: 8px; }
  h2 { font-size: 16pt; margin-top: 2em; color: #333; }
  table { width: 100%; border-collapse: collapse; margin: 1em 0; }
  th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
  th { background: #f5f5f5; font-weight: 600; }
  .cover { text-align: center; padding: 4rem 0; page-break-after: always; }
</style>
```

## Presentations / Slide Decks
Create as an interactive HTML slide deck:
```html
<style>
  .slide { width: 960px; height: 540px; margin: 2rem auto; padding: 3rem; box-sizing: border-box; background: #fff; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,.1); position: relative; page-break-after: always; }
  .slide h1 { font-size: 2.5rem; margin-bottom: 1rem; }
  .slide h2 { font-size: 1.8rem; color: #555; }
  .slide-number { position: absolute; bottom: 1rem; right: 1.5rem; color: #aaa; font-size: .8rem; }
</style>
<!-- Add keyboard navigation: ArrowRight/ArrowLeft to scroll between slides -->
```
- Max 6 bullet points per slide
- One idea per slide
- Use large fonts (24pt+ for body, 36pt+ for titles)
- Include a title slide, agenda, content slides, summary, CTA
- Add speaker notes as data attributes or hidden divs

## Spreadsheets & Tables
Create interactive HTML tables with sorting and formulas:
- Right-align numbers, left-align text
- Format currency with `Intl.NumberFormat`
- Add totals row at bottom
- Zebra striping for readability
- Make columns sortable with click handlers
- Add CSV export button

## Invoices
```
┌─────────────────────────────────────┐
│  COMPANY LOGO        INVOICE #001   │
│                      Date: ...      │
├─────────────────────────────────────┤
│  Bill To:            Ship To:       │
│  [Client details]    [Address]      │
├──────┬────────┬──────┬──────────────┤
│ Item │ Qty    │ Rate │ Amount       │
├──────┼────────┼──────┼──────────────┤
│      │        │      │              │
├──────┴────────┴──────┼──────────────┤
│              Subtotal│ $X,XXX.XX    │
│                  Tax │ $XXX.XX      │
│                TOTAL │ $X,XXX.XX    │
└──────────────────────┴──────────────┘
│  Payment terms: Net 30              │
│  Bank details: ...                  │
└─────────────────────────────────────┘
```

## Resumes / CVs
- Clean, single-page layout
- Name large at top, contact info below
- Sections: Summary, Experience, Skills, Education
- Use bullet points with quantified achievements
- ATS-friendly: no tables, no columns, no images for text

## Cover Letters
- 3-4 paragraphs max
- Opening: specific role + why this company
- Body: 2-3 relevant achievements with numbers
- Close: enthusiasm + call to action
- Tone: professional but genuine
