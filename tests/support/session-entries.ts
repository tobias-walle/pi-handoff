import type {
  CustomEntry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

export function customEntries(
  manager: Pick<SessionManager, "getBranch">,
  customType: string,
): CustomEntry[] {
  return manager
    .getBranch()
    .filter(
      (entry): entry is CustomEntry =>
        entry.type === "custom" && entry.customType === customType,
    );
}
