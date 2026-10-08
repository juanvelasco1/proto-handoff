// use_figma script template (read-only) — counts every text look used on the light screens
// (family, style, size, line height, letter spacing, case). gen-foundations.mjs turns the
// census into the type scale: text styles come from what the screens use, not from a guess.
const PARAMS = /*PARAMS*/ { page: '' } /*END*/;

const page = await figma.getNodeByIdAsync(PARAMS.page);
await figma.setCurrentPageAsync(page);
const frames = page.children.flatMap((c) => (c.type === 'SECTION' ? c.children : [c]))
  .filter((f) => f.type === 'FRAME' && !f.getSharedPluginData('uic', 'darkOf'));
const looks = {};
let mixed = 0;
for (const f of frames) {
  for (const t of f.findAllWithCriteria({ types: ['TEXT'] })) {
    // a mixed node still counts: each styled run is a look of its own
    const segs = t.getStyledTextSegments(['fontName', 'fontSize', 'lineHeight', 'letterSpacing', 'textCase']);
    if (segs.length > 1) mixed++;
    for (const s of segs) {
      const lh = s.lineHeight.unit === 'AUTO' ? 'auto' : s.lineHeight.unit === 'PERCENT'
        ? Math.round(s.fontSize * s.lineHeight.value) / 100 : Math.round(s.lineHeight.value * 10) / 10;
      const ls = s.letterSpacing.unit === 'PERCENT'
        ? Math.round(s.fontSize * s.letterSpacing.value) / 100 : Math.round(s.letterSpacing.value * 100) / 100;
      const k = [s.fontName.family, s.fontName.style, s.fontSize, lh, ls, s.textCase].join('|');
      looks[k] = (looks[k] || 0) + 1;
    }
  }
}
return { frames: frames.length, mixed, looks: Object.entries(looks).sort((a, b) => b[1] - a[1]) };
