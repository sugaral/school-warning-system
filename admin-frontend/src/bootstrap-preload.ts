import {
  getAttendanceQrConfig,
  getAttendanceSessionOptions,
  listClasses,
  listOrgs,
} from './api';
import { setPreloadedValue } from './preload-cache';

const PRELOAD_TIMEOUT_MS = 8000;

const withTimeout = async <T>(promise: Promise<T>, timeoutMs = PRELOAD_TIMEOUT_MS) =>
  await Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        clearTimeout(timer);
        reject(new Error(`preload timeout after ${timeoutMs}ms`));
      }, timeoutMs);
    }),
  ]);

export async function preloadAppCaches() {
  const token = localStorage.getItem('admin_token');
  if (!token) {
    return;
  }

  const tasks = [
    withTimeout(listOrgs()).then((response) => {
      if (response?.code === 0) {
        setPreloadedValue('orgs', response.data || []);
      }
    }),
    withTimeout(listClasses()).then((response) => {
      if (response?.code === 0) {
        setPreloadedValue('classes', response.data || []);
      }
    }),
    withTimeout(getAttendanceSessionOptions()).then((response) => {
      if (response?.code === 0) {
        setPreloadedValue('attendanceSessionOptions', response.data || { orgs: [], classes: [] });
      }
    }),
    withTimeout(getAttendanceQrConfig()).then((response) => {
      if (response?.code === 0) {
        setPreloadedValue('attendanceQrConfig', response.data || {});
      }
    }),
  ];

  await Promise.allSettled(tasks);
}
