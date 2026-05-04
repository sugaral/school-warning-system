type PreloadCacheState = {
  orgs?: any[];
  classes?: any[];
  attendanceSessionOptions?: {
    orgs: any[];
    classes: any[];
  };
  attendanceQrConfig?: any;
};

const state: PreloadCacheState = {};

export function setPreloadedValue<K extends keyof PreloadCacheState>(key: K, value: PreloadCacheState[K]) {
  state[key] = value;
}

export function takePreloadedValue<K extends keyof PreloadCacheState>(key: K): PreloadCacheState[K] | undefined {
  const value = state[key];
  delete state[key];
  return value;
}
