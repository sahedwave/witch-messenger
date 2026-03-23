import { AR_FILTERS } from "./arFilters";

export const SNAP_FILTERS = AR_FILTERS;

export function getSnapFilter(filterId: string) {
  return SNAP_FILTERS.find((filter) => filter.id === filterId) || SNAP_FILTERS[0];
}
