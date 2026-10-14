const TEAM_COLOURS = ['#B5452B', '#6B4FA8', '#1F7A6E', '#2B59C3', '#8A6D1E', '#A23B72'];

/** A team keeps its colour in the tree and in Review, whatever order the teams load in. */
export function teamColour(teamName: string): string {
  let hash = 0;
  for (const ch of teamName) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return TEAM_COLOURS[hash % TEAM_COLOURS.length] ?? '#2B59C3';
}
