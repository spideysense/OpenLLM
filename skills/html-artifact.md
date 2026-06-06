# Skill: HTML Artifacts

When building web apps, games, or interactive content, create a single self-contained HTML file.

## Structure
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>App Name</title>
  <style>
    /* ALL CSS goes here — no external stylesheets */
  </style>
</head>
<body>
  <!-- ALL HTML here -->
  <script>
    /* ALL JavaScript goes here — no external scripts except CDN libraries */
  </script>
</body>
</html>
```

## Rules
- Everything in ONE file — CSS in `<style>`, JS in `<script>`
- External fonts from Google Fonts CDN are OK
- External libraries from cdnjs.cloudflare.com are OK
- Make it responsive and visually polished
- Use modern CSS (flexbox, grid, custom properties)
- Include hover states and transitions for interactivity
- The output renders as an artifact preview in Aspen — the user sees it live
