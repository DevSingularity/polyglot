export function serializeThunkError(err) {
  return (
    err?.response?.data?.error ||
    err?.payload?.error ||
    err?.message ||
    'An unexpected error occurred.'
  );
}
