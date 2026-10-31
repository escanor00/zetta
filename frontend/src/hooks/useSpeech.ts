
import { useState, useCallback, useRef, useEffect } from 'react';
import { transcribeAudio, fetchSpeechHealth } from '../lib/api';

export type SpeechState = 'idle' | 'recording' | 'transcribing';

export function useSpeech(onTranscript?: (text: string) => void) {
  const [state, setState] = useState<SpeechState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [available, setAvailable] = useState(false);
  const [healthChecked, setHealthChecked] = useState(false);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const stopRecordingRef = useRef<(() => Promise<string>) | null>(null);
  const onTranscriptRef = useRef(onTranscript);

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  useEffect(() => {
    fetchSpeechHealth()
      .then((health) => {
        setAvailable(health.available);
        setAvailabilityError(
          health.available ? null : 'Speech transcription backend is unavailable',
        );
      })
      .catch((err: unknown) => {
        setAvailable(false);
        setAvailabilityError(
          err instanceof Error
            ? `Could not check speech transcription backend: ${err.message}`
            : 'Could not check speech transcription backend',
        );
      })
      .finally(() => setHealthChecked(true));
  }, []);

  const stopRecording = useCallback(async (): Promise<string> => {
    const recorder = mediaRecorderRef.current;

    if (!recorder || recorder.state !== 'recording') {
      throw new Error('Not recording');
    }

    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    return new Promise((resolve, reject) => {
      recorder.onstop = async () => {
        setState('transcribing');

        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;

        const audioContext = audioContextRef.current;
        audioContextRef.current = null;

        if (audioContext && audioContext.state !== 'closed') {
          void audioContext.close().catch(() => {});
        }

        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });
        chunksRef.current = [];
        mediaRecorderRef.current = null;

        try {
          const result = await transcribeAudio(blob);
          const text = result.text.trim();

          setState('idle');

          onTranscriptRef.current?.(text);

          resolve(text);
        } catch (err) {
          // Retry uma vez em caso de erro de rede ou temporário
          const shouldRetry = err instanceof Error &&
            (err.message.includes('network') ||
             err.message.includes('fetch') ||
             err.message.includes('timeout'));

          if (shouldRetry) {
            try {
              const retryResult = await transcribeAudio(blob);
              const retryText = retryResult.text.trim();

              setState('idle');

              onTranscriptRef.current?.(retryText);

              resolve(retryText);
              return;
            } catch (retryErr) {
              // Se o retry falhar, continua com o erro original
            }
          }

          setState('idle');
          const message =
            err instanceof Error ? err.message : 'Transcription failed';

          setError(message);
          reject(err);
        }
      };

      recorder.stop();
    });
  }, []);

  const cancelRecording = useCallback(async (): Promise<void> => {
    const recorder = mediaRecorderRef.current;

    if (!recorder || recorder.state !== 'recording') {
      return;
    }

    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    await new Promise<void>((resolve, reject) => {
      recorder.onstop = () => {
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;

        const audioContext = audioContextRef.current;
        audioContextRef.current = null;
        if (audioContext && audioContext.state !== 'closed') {
          void audioContext.close().catch(() => {});
        }

        chunksRef.current = [];
        mediaRecorderRef.current = null;
        setState('idle');
        resolve();
      };

      try {
        recorder.stop();
      } catch (err) {
        setError(
          err instanceof Error
            ? `Could not stop microphone recording: ${err.message}`
            : 'Could not stop microphone recording',
        );
        reject(err);
      }
    });
  }, []);

  useEffect(() => {
    stopRecordingRef.current = stopRecording;

    return () => {
      stopRecordingRef.current = null;

      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
      }

      streamRef.current?.getTracks().forEach((track) => track.stop());

      const audioContext = audioContextRef.current;
      if (audioContext && audioContext.state !== 'closed') {
        void audioContext.close().catch(() => {});
      }
    };
  }, [stopRecording]);

  const startRecording = useCallback(async (): Promise<void> => {
    setError(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      const message = 'Microphone not supported in this browser';
      setError(message);
      throw new Error(message);
    }

    if (mediaRecorderRef.current?.state === 'recording') {
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      streamRef.current = stream;

      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;

      await audioContext.resume();

      const analyser = audioContext.createAnalyser();
      const microphone = audioContext.createMediaStreamSource(stream);

      analyser.fftSize = 512;
      microphone.connect(analyser);

      const data = new Uint8Array(analyser.fftSize);
      let silenceStartedAt: number | null = null;
      let speechDetected = false;

      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setState('recording');

      const detectSilence = () => {
        if (mediaRecorderRef.current !== recorder || recorder.state !== 'recording') {
          return;
        }

        analyser.getByteTimeDomainData(data);

        let sum = 0;

        for (const value of data) {
          const normalized = (value - 128) / 128;
          sum += normalized * normalized;
        }

        const volume = Math.sqrt(sum / data.length);
        const now = Date.now();

        if (volume > 0.012) {
          speechDetected = true;
          silenceStartedAt = null;
        } else if (speechDetected) {
          silenceStartedAt ??= now;

          if (now - silenceStartedAt >= 1500) {
            silenceTimerRef.current = null;
            void stopRecordingRef.current?.().catch(() => {});
            return;
          }
        }

        silenceTimerRef.current = setTimeout(detectSilence, 100);
      };

      silenceTimerRef.current = setTimeout(detectSilence, 100);
    } catch (err) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;

      const audioContext = audioContextRef.current;
      audioContextRef.current = null;

      if (audioContext && audioContext.state !== 'closed') {
        void audioContext.close().catch(() => {});
      }

      mediaRecorderRef.current = null;
      setState('idle');

      const message = err instanceof Error
        ? `Could not start recording: ${err.message}`
        : 'Could not access the microphone';
      setError(message);
      throw err instanceof Error ? err : new Error(message);
    }
  }, []);

  return {
    state,
    error,
    available,
    healthChecked,
    availabilityError,
    startRecording,
    stopRecording,
    cancelRecording,
    isRecording: state === 'recording',
    isTranscribing: state === 'transcribing',
  };
}
