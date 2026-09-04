import { addDays, startOfDay } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";

export const DEFAULT_STORE_TIME_ZONE = "Asia/Taipei";

export type StoreAvailability = {
  permanentlyActive: boolean;
  temporarilyUnavailable: boolean;
  temporarilyUnavailableUntil?: Date | null;
};

export const isStoreItemAvailable = (
  availability: StoreAvailability,
  now = new Date(),
) =>
  availability.permanentlyActive &&
  (!availability.temporarilyUnavailable ||
    !availability.temporarilyUnavailableUntil ||
    availability.temporarilyUnavailableUntil <= now);

export const nextStoreMidnight = (
  now = new Date(),
  timeZone = DEFAULT_STORE_TIME_ZONE,
) => {
  const storeNow = toZonedTime(now, timeZone);
  return fromZonedTime(startOfDay(addDays(storeNow, 1)), timeZone);
};
