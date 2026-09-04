type PublicOption = {
  id: string;
  names: { vi?: string; en?: string; "zh-TW"?: string };
};
type PublicOptionGroup = {
  id: string;
  selection: "single" | "multiple";
  required: boolean;
  options: PublicOption[];
};

/** Validates public option selections against the current menu and prepares the immutable order snapshot. */
export const normalizePublicOptionSelections = (
  requested: unknown,
  groups: PublicOptionGroup[] = [],
) => {
  const selections = (Array.isArray(requested) ? requested : []).map(
    (selection: any) => {
      const group = groups.find(
        (candidate) => candidate.id === selection?.groupId,
      );
      const option = group?.options.find(
        (candidate) => candidate.id === selection?.optionId,
      );
      if (!group || !option) throw new Error("INVALID_OPTION");
      return {
        groupId: group.id,
        optionId: option.id,
        name:
          option.names.vi ||
          option.names.en ||
          option.names["zh-TW"] ||
          option.id,
      };
    },
  );
  for (const group of groups) {
    const selected = selections.filter(
      (selection) => selection.groupId === group.id,
    );
    if (group.required && !selected.length)
      throw new Error("REQUIRED_OPTION_MISSING");
    if (group.selection === "single" && selected.length > 1)
      throw new Error("INVALID_OPTION");
    if (
      new Set(selected.map((selection) => selection.optionId)).size !==
      selected.length
    )
      throw new Error("INVALID_OPTION");
  }
  return selections;
};
