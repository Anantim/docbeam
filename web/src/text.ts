/** "1 file", "3 files": the number with the right word. */
export const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
