import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { get, writable } from "svelte/store";
import { orpc, setToken } from "./orpc-client";

export const loading = writable(false);
export const registerRequested = writable(false);

function withLoading<T extends unknown[], U>(cb: (...args: T) => Promise<U>) {
  return async (...args: T) => {
    if (get(loading)) {
      throw new Error("Loading");
    }
    loading.set(true);
    try {
      return await cb(...args);
    } finally {
      loading.set(false);
    }
  };
}

export const handleRegister = withLoading(async (name: string) => {
  const { options } = await orpc.webauthn.registration.options();
  // console.log('Registration Options:', options);

  const attResp = await startRegistration({ optionsJSON: options });
  // console.log('Registration Response', attResp);

  const { verified, token } = await orpc.webauthn.registration.verify({ name, attResp });
  if (!verified || !token) throw new Error("Registration failed");
  setToken(token);
});

export const handleAuthentication = withLoading(async (autofill?: boolean) => {
  const { options } = await orpc.webauthn.authentication.options();
  // console.log('Authentication Options:', options);

  const authResp = await startAuthentication({
    optionsJSON: options,
    useBrowserAutofill: autofill,
  });
  // console.log('Authentication Response:', authResp, autofill);

  const { verified, token } = await orpc.webauthn.authentication.verify({ authResp });
  if (!verified || !token) throw new Error("Authentication failed");
  setToken(token);
});
