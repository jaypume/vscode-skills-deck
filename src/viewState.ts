/**
 * In-memory view state for the Skills tree.
 *
 * These are ephemeral UI preferences (grouping, filtering, sorting) — they are
 * NOT persisted to data.json. Only declared data (skills, repositories, agents)
 * is portable; view state resets to defaults each session.
 */

import { GroupDimension, SortingOption, StatusFilter } from './types';

export interface ViewState {
  groupBy: GroupDimension;
  groupRepositories: boolean;
  statusFilter: StatusFilter;
  sortingOption: SortingOption;
}

const DEFAULTS: ViewState = {
  groupBy: 'category',
  groupRepositories: true,
  statusFilter: 'all',
  sortingOption: 'A-Z',
};

const state: ViewState = { ...DEFAULTS };

type Listener = () => void;
const listeners = new Set<Listener>();

export function get<K extends keyof ViewState>(key: K): ViewState[K] {
  return state[key];
}

export function set<K extends keyof ViewState>(key: K, value: ViewState[K]): void {
  if (state[key] === value) { return; }
  state[key] = value;
  for (const listener of listeners) { listener(); }
}

export function all(): ViewState {
  return { ...state };
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
