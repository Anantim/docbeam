import { jobChip } from '../tracking/format.js';
import { isUnfiltered, SENT_LABEL, SENT_PRESETS, STATUSES, type Filters, type SentPreset } from '../tracking/filters.js';
import type { JobStatus, Member, TeamChoice } from '../tracking/api.js';
import { FilterMenu } from './FilterMenu.js';
import { FILTER_AFTER } from './ListFilter.js';

interface Props {
  filters: Filters;
  onChange: (filters: Filters) => void;
  /** The signed-in person's id, so "Me" is one choice and the person is not listed twice. */
  meId: string;
  /** The people in the person's teams. Empty until they are loaded. */
  members: Member[];
  /** The person's teams. The Team filter is shown only when there is more than one. */
  teams: TeamChoice[];
}

/**
 * The one row of filters above the list (D-F1-21): Status, Sender, Sent, and Team (only for a person in more than one
 * team). Each is a small button with a short menu. "Clear filters" is there only while a filter is set.
 */
export function FilterBar({ filters, onChange, meId, members, teams }: Props) {
  const others = members.filter((m) => m.userId !== meId);
  // The address holds the person's id, never the word "me" (D-F1-81), so a shared link shows the sender's own name to the person who opens it.
  const senderLabel = filters.sender === meId ? 'Me' : (members.find((m) => m.userId === filters.sender)?.name ?? '');
  const teamLabel = teams.find((t) => t.id === filters.team)?.name ?? '';

  return (
    <div className="filterbar" role="group" aria-label="Filters">
      <FilterMenu
        label="Status"
        value={filters.status}
        valueLabel={filters.status ? jobChip(filters.status).label : ''}
        anyLabel="Any status"
        choices={STATUSES.map((s) => ({ value: s, label: jobChip(s).label }))}
        onChange={(v) => onChange({ ...filters, status: v as JobStatus | undefined })}
      />
      <FilterMenu
        label="Sender"
        value={filters.sender}
        valueLabel={senderLabel}
        anyLabel="Anyone"
        choices={[{ value: meId, label: 'Me' }, ...others.map((m) => ({ value: m.userId, label: m.name || 'Member' }))]}
        onChange={(v) => onChange({ ...filters, sender: v })}
        filterAfter={FILTER_AFTER.people}
        filterLabel="Filter senders"
      />
      <FilterMenu
        label="Sent"
        value={filters.sent}
        valueLabel={filters.sent ? SENT_LABEL[filters.sent] : ''}
        anyLabel="Any time"
        choices={SENT_PRESETS.map((p) => ({ value: p, label: SENT_LABEL[p] }))}
        onChange={(v) => onChange({ ...filters, sent: v as SentPreset | undefined })}
      />
      {/* Only for a person in more than one team, with no exception: a team in the address that is not one of theirs is dropped (D-F1-81). */}
      {teams.length > 1 && (
        <FilterMenu
          label="Team"
          value={filters.team}
          valueLabel={teamLabel}
          anyLabel="Any team"
          choices={teams.map((t) => ({ value: t.id, label: t.name }))}
          onChange={(v) => onChange({ ...filters, team: v })}
        />
      )}
      {!isUnfiltered(filters) && (
        <button className="link" type="button" onClick={() => onChange({})}>
          Clear filters
        </button>
      )}
    </div>
  );
}
