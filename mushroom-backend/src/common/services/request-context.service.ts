import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestStore {
  userId?: string;
  role?: string;
  phoneNumber?: string;
}

const asyncLocalStorage = new AsyncLocalStorage<RequestStore>();

export const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

export class RequestContextService {
  static run<T>(store: RequestStore, callback: () => T): T {
    return asyncLocalStorage.run(store, callback);
  }

  static runWithSystemContext<T>(callback: () => T): T {
    return asyncLocalStorage.run(
      {
        userId: SYSTEM_USER_ID,
        role: 'ADMIN',
        phoneNumber: 'SYSTEM',
      },
      callback,
    );
  }

  static getStore(): RequestStore | undefined {
    return asyncLocalStorage.getStore();
  }

  static getUserId(): string | undefined {
    return asyncLocalStorage.getStore()?.userId;
  }
}
