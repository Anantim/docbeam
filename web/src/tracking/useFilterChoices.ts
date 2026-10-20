import { useEffect, useState } from 'react';
import { trackingApi, type Member, type TeamChoice } from './api.js';

/**
 * The people and the teams the Status filters offer, read once when the page opens. If either read fails the menu
 * simply has fewer choices (Anyone and Me are always there); the list itself never waits for them.
 */
export function useFilterChoices(enabled: boolean, signedInAgain = 0): { members: Member[]; teams: TeamChoice[] } {
  const [members, setMembers] = useState<Member[]>([]);
  const [teams, setTeams] = useState<TeamChoice[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    trackingApi.members().then((m) => current && setMembers(m), () => undefined);
    trackingApi.teams().then((t) => current && setTeams(t), () => undefined);
    return () => {
      current = false;
    };
  }, [enabled, signedInAgain]);
  return { members, teams };
}
