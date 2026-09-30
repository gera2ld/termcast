export interface IShareSession {
  allowWrite: boolean;
  tabId?: string;
  maxConnections: number;
}

export interface ITermToken<T = unknown> {
  token: string;
  createdAt: number;
  expireAt: number;
  payload: T;
}
