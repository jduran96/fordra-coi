// Shared design tokens for the App and Admin paths.
// Mirrors the `C` object in app/demo/AppClient.tsx (the demo stays
// self-contained on purpose — see AGENTS.md).
export const C = {
  paper:        'oklch(98.5% 0.004 80)',
  surface:      'oklch(100% 0 0)',
  surfaceHover: 'oklch(96.5% 0.005 80)',
  border:       'oklch(88% 0.008 80)',
  borderStrong: 'oklch(76% 0.010 80)',
  txt:          'oklch(13% 0.008 265)',
  txt2:         'oklch(46% 0.012 265)',
  txt3:         'oklch(68% 0.008 265)',
  accent:       'oklch(52% 0.17 38)',
  circle:       'oklch(52% 0.17 38)',
  success:      'oklch(46% 0.14 155)',
  error:        'oklch(52% 0.20 25)',
  serif:        "'DM Serif Display', Georgia, 'Times New Roman', serif",
  sans:         "Inter, -apple-system, BlinkMacSystemFont, sans-serif",
};
