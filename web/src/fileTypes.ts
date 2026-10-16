// The colour of each file type's badge, in one map (D-M3-12). Each keeps its text label, so colour is never the
// only signal, and each pair has a contrast of at least 4.5 to 1 (checked in fileTypes.test.ts).
export type TypeLabel = 'PDF' | 'DOCX' | 'XLSX' | 'PNG' | 'JPG';

export const TYPE_COLOURS: Record<TypeLabel, { bg: string; fg: string; name: string }> = {
  PDF: { bg: '#FEE4E2', fg: '#B42318', name: 'red' },
  DOCX: { bg: '#D1E0FF', fg: '#1849A9', name: 'blue' },
  XLSX: { bg: '#D1FADF', fg: '#05603A', name: 'green' },
  PNG: { bg: '#E9D7FE', fg: '#6941C6', name: 'purple' },
  JPG: { bg: '#E9D7FE', fg: '#6941C6', name: 'purple' },
};

/** WCAG contrast ratio of two #rrggbb colours. */
export function contrast(a: string, b: string): number {
  const lum = (hex: string): number => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
