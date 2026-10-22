/** A count as it is shown everywhere in the app: with a thousands separator ("2,000", never "2000") (D-F1-81). */
export const num = (n: number): string => n.toLocaleString('en-US');

/** "1 file", "3 files", "2,000 deliveries": the number with the right word. */
export const plural = (n: number, one: string, many: string): string => `${num(n)} ${n === 1 ? one : many}`;
