export interface RealtimeTranscriptionCredential {
  token: string;
  expiresInSeconds: number;
}

export interface RealtimeTranscriptionGateway {
  createSingleUseToken(signal?: AbortSignal): Promise<RealtimeTranscriptionCredential>;
}

export interface RealtimeTranscriptionSettings {
  modelId: "scribe_v2_realtime";
  languageCode: string;
  commitStrategy: "manual" | "vad";
  vadSilenceThresholdSecs: number;
  vadThreshold: number;
  minSpeechDurationMs: number;
  minSilenceDurationMs: number;
  includeTimestamps: boolean;
  microphone: {
    echoCancellation: boolean;
    noiseSuppression: boolean;
    autoGainControl: boolean;
  };
  manualAudio: {
    audioFormat: "pcm_16000";
    sampleRate: 16_000;
  };
}

export interface RealtimeTranscriptionSession {
  version: "1";
  token: string;
  expiresInSeconds: number;
  config: RealtimeTranscriptionSettings;
}
