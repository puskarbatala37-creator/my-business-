/** Fingerprint / face sign-in can't run inside the demo preview (the sandboxed page has no access to the phone's sensor). */
const unavailable = async (): Promise<never> => {
  throw new Error('Fingerprint / face sign-in is not available in the demo preview.');
};
export const generateAuthenticationOptions = unavailable;
export const generateRegistrationOptions = unavailable;
export const verifyAuthenticationResponse = unavailable;
export const verifyRegistrationResponse = unavailable;
export type AuthenticationResponseJSON = any;
export type RegistrationResponseJSON = any;
export type AuthenticatorTransportFuture = string;
