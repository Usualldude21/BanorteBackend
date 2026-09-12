import {
  type RealtimeTranscriptionGateway,
  type RealtimeTranscriptionSession,
  type RealtimeTranscriptionSettings,
} from "./ports/realtime-transcription.js";

export type RealtimeTranscriptionSessionService = (
  signal?: AbortSignal,
) => Promise<RealtimeTranscriptionSession>;

export function createRealtimeTranscriptionSessionService(options: {
  gateway: RealtimeTranscriptionGateway;
  settings: RealtimeTranscriptionSettings;
}): RealtimeTranscriptionSessionService {
  return async (signal) => {
    const credential = await options.gateway.createSingleUseToken(signal);

    return {
      version: "1",
      token: credential.token,
      expiresInSeconds: credential.expiresInSeconds,
      config: options.settings,
    };
  };
}
