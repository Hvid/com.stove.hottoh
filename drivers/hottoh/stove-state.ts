/**
 * Maps the detailed stove states reported by hottohts (e.g. "starting_6_ignition")
 * to the coarse categories used by the flow cards.
 *
 * The order of STATE_CATEGORIES defines the state_id token of the
 * "stove state changed" trigger, so only append to it.
 */
export const STATE_CATEGORIES = ['Off', 'Starting', 'Preheating', 'Running', 'Cooling Down', 'Cleaning', 'Standby'] as const;

export type StateCategory = typeof STATE_CATEGORIES[number];

const CATEGORY_BY_STATE: Record<string, StateCategory> = {
  switched_off: 'Off',
  black_out: 'Off',
  eco_stop_2: 'Off',
  eco_stop_3: 'Off',
  starting_1_check: 'Starting',
  starting_3_loading: 'Starting',
  starting_4_waiting: 'Starting',
  starting_5_waiting: 'Starting',
  starting_6_ignition: 'Starting',
  starting_7_stabilization: 'Preheating',
  power: 'Running',
  stopping_1_wait_standby: 'Cooling Down',
  stopping_2_wait_standby: 'Cooling Down',
  starting_2_clean_all: 'Cleaning',
  eco_stop_1_standby: 'Standby',
};

/**
 * @returns The category, or null for states without one (errors, pellet warnings, anti-freeze)
 */
export function getStateCategory(state: string | null): StateCategory | null {
  if (state === null || !Object.prototype.hasOwnProperty.call(CATEGORY_BY_STATE, state)) return null;
  return CATEGORY_BY_STATE[state];
}

/**
 * @returns The state_id token value: the category index, or -1 for states without a category
 */
export function getStateId(state: string | null): number {
  const category = getStateCategory(state);
  return category === null ? -1 : STATE_CATEGORIES.indexOf(category);
}
