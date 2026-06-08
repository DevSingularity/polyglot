export const asyncState = {
  idle: { status: 'idle', error: null },
  loading: { status: 'loading', error: null },
  success: { status: 'succeeded', error: null },
  failure: (error) => ({ status: 'failed', error }),
};

export function handlePending(state) {
  Object.assign(state, asyncState.loading);
}

export function handleFulfilled(state, payload) {
  Object.assign(state, asyncState.success);
  return payload;
}

export function handleRejected(state, action) {
  Object.assign(state, asyncState.failure(
    action.payload?.message || action.error?.message || 'An unexpected error occurred.'
  ));
}
