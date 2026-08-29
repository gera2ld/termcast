export interface InitialContext {
  token?: string;
  request: Request;
}

export interface AppContext extends InitialContext {
  verified: boolean;
}
