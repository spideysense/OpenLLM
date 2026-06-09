# Skill: Data Visualization

When building charts, dashboards, or data displays.

## Chart Libraries (CDN)
Use Chart.js for simple charts:
```html
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
```

Use D3.js for custom/complex visualizations:
```html
<script src="https://d3js.org/d3.v7.min.js"></script>
```

## Chart Types by Data
- **Trend over time** → Line chart
- **Compare categories** → Bar chart (horizontal for many categories)
- **Part of whole** → Donut chart (not pie — donuts are cleaner)
- **Distribution** → Histogram or box plot
- **Relationship** → Scatter plot
- **Geographic** → Map with markers
- **KPIs** → Big number cards with trend indicators

## Dashboard Layout
```
┌─────────────────────────────────────────────┐
│  Header / Filters / Date Range              │
├──────┬──────┬──────┬──────┬────────────────┤
│ KPI  │ KPI  │ KPI  │ KPI  │                │
├──────┴──────┴──────┴──────┤                │
│  Primary Chart             │  Side Panel    │
│  (large, main insight)     │  (table/list)  │
├────────────────────────────┤                │
│  Secondary Charts (2-col)  │                │
└────────────────────────────┴────────────────┘
```

## KPI Cards
```html
<div class="kpi">
  <div class="kpi-label">Total Revenue</div>
  <div class="kpi-value">$142,389</div>
  <div class="kpi-trend up">↑ 12.3% vs last month</div>
</div>
```

## Color Palette for Data
- Use a consistent 6-color palette:
  `#3b82f6, #22c55e, #f59e0b, #ef4444, #8b5cf6, #06b6d4`
- Use opacity for fills (0.1-0.3) with solid borders
- Gray for grid lines and axes
- Red/green only for negative/positive (with icons for colorblind users)

## Best Practices
- Always label axes
- Start y-axis at 0 for bar charts
- Use commas in large numbers: `toLocaleString()`
- Format currency: `new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })`
- Format dates consistently: `toLocaleDateString('en-US', { month: 'short', day: 'numeric' })`
- Add tooltips on hover for exact values
- Make charts responsive: use percentage widths + resize observers
- Add loading skeletons while data fetches

## Tables
- Zebra striping: alternating row backgrounds
- Sticky header for long tables
- Sortable columns (click header to sort)
- Right-align numbers, left-align text
- Truncate long text with ellipsis + tooltip
