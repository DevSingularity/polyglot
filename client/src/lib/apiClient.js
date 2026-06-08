import axios from 'axios';

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || '';

export const apiClient = axios.create({
  baseURL: apiBaseUrl,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const message = error.response?.data?.error || error.message;

    if (status === 401) {
      // Let callers handle redirect; still provide normalized error
    }

    return Promise.reject({ status, message, raw: error });
  },
);

export default apiClient;
