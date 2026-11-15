/** Pure reducer to keep independent form dirty states; never stores form values. */
export const updateDirtyForm = (state, id, dirty) => {
  if (!id) throw new Error("A stable form id is required");
  const has = Boolean(state[id]);
  if (has === Boolean(dirty)) return state;
  if (!dirty) {
    const next = { ...state };
    delete next[id];
    return next;
  }
  return { ...state, [id]: true };
};

export const hasUnsavedChanges = (state) => Object.values(state).some(Boolean);
