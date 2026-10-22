import { useEffect, useState } from 'react';
import { trackingApi, type Member, type TeamChoice } from './api.js';

export interface FilterChoices {
  members: Member[];
  teams: TeamChoice[];
  /** Both reads have answered, well or not. */
  settled: boolean;
  /** Both reads succeeded, so the lists are complete and an address can be judged by them. */
  ok: boolean;
}

/**
 * The people and the teams the Status filters offer, read once when the page opens. If either read fails the menu
 * simply has fewer choices (Anyone and Me are always there); the list itself never waits for them, except an address that
 * holds a team or a sender, which waits for `settled` before it is judged (D-F1-81).
 */
export function useFilterChoices(enabled: boolean, signedInAgain = 0): FilterChoices {
  const [members, setMembers] = useState<Member[]>([]);
  const [teams, setTeams] = useState<TeamChoice[]>([]);
  const [done, setDone] = useState({ members: false, teams: false });
  const [good, setGood] = useState({ members: false, teams: false });
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    setDone({ members: false, teams: false });
    setGood({ members: false, teams: false });
    trackingApi.members().then(
      (m) => {
        if (!current) return;
        setMembers(m);
        setGood((g) => ({ ...g, members: true }));
        setDone((d) => ({ ...d, members: true }));
      },
      () => current && setDone((d) => ({ ...d, members: true })),
    );
    trackingApi.teams().then(
      (t) => {
        if (!current) return;
        setTeams(t);
        setGood((g) => ({ ...g, teams: true }));
        setDone((d) => ({ ...d, teams: true }));
      },
      () => current && setDone((d) => ({ ...d, teams: true })),
    );
    return () => {
      current = false;
    };
  }, [enabled, signedInAgain]);
  return { members, teams, settled: done.members && done.teams, ok: good.members && good.teams };
}
