
import { useState, useRef, useCallback, useEffect } from 'react';
import { Send, Square, Paperclip, Search } from 'lucide-react';
import { toast } from 'sonner';
import { useAppStore, generateId } from '../../lib/store';
import { streamChat, streamResearch } from '../../lib/sse';
import { fetchSavings, getBase } from '../../lib/api';
import { listConnectors, getSyncStatus } from '../../lib/connectors-api';
import { serializeToolCallArguments } from '../../lib/tool-call';
import {
  engineFromCompletionChunk,
  resolveChatEngine,
} from '../../lib/chat-telemetry';
import { MicButton } from './MicButton';
import {
  getWakeWordMessage,
  startsWithWakeGreeting,
} from '../../lib/wake-word';
import { useSpeech } from '../../hooks/useSpeech';
import { useTtsStore } from '../../lib/tts';
import type {
  ChatMessage,
  MessageTelemetry,
  ResearchSearchTrace,
  ResearchSource,
  TokenUsage,
  ToolCallInfo,
} from '../../types';

// While Deep Research is toggled on, poll connected sources for sync
// progress so we can surface "Searching over N items — sync in progress"
// next to the toggle. Polling is gated on `enabled` so toggling DR off
// stops the network chatter immediately.
function useResearchCorpusSync(enabled: boolean): {
  syncing: boolean;
  itemsSynced: number;
} {
  const [state, setState] = useState({ syncing: false, itemsSynced: 0 });

  useEffect(() => {
    if (!enabled) {
      setState({ syncing: false, itemsSynced: 0 });
      return;
    }

    let cancelled = false;

    const poll = async () => {
      try {
        const list = await listConnectors();
        const connected = list.filter((c) => c.connected);

        if (connected.length === 0) {
          if (!cancelled) {
            setState({ syncing: false, itemsSynced: 0 });
          }
          return;
        }

        const results = await Promise.all(
          connected.map(async (c) => {
            try {
              return await getSyncStatus(c.connector_id);
            } catch {
              return null;
            }
          }),
        );

        let syncing = false;
        let itemsSynced = 0;

        for (const r of results) {
          if (!r) continue;
          if (r.state === 'syncing') syncing = true;
          itemsSynced += r.items_synced ?? 0;
        }

        if (!cancelled) {
          setState({ syncing, itemsSynced });
        }
      } catch {
        // Network blip — leave previous state intact.
      }
    };

    void poll();

    const interval = setInterval(() => {
      void poll();
    }, 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [enabled]);

  return state;
}

type WakeStatus = 'listening' | 'transcribing' | 'offline' | 'idle' | 'conversation';

interface InputAreaProps {
  onWakeStatusChange?: (status: WakeStatus) => void;
}

export function InputArea({ onWakeStatusChange }: InputAreaProps) {
  const sendMessageRef = useRef<
    (text?: string, source?: 'text' | 'voice') => Promise<void>
  >(
    async () => { },
  );

  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Controls the continuous voice conversation.
  const voiceConversationRef = useRef(false);
  const [voiceConversationActive, setVoiceConversationActive] = useState(false);
  const pendingVoiceRestartRef = useRef(false);

  const ttsState = useTtsStore((s) => s.state);
  const previousTtsStateRef = useRef(ttsState);

  const activeId = useAppStore((s) => s.activeId);
  const selectedModel = useAppStore((s) => s.selectedModel);
  const streamState = useAppStore((s) => s.streamState);
  const messages = useAppStore((s) => s.messages);
  const speechEnabled = useAppStore((s) => s.settings.speechEnabled);
  const maxTokens = useAppStore((s) => s.settings.maxTokens);
  const temperature = useAppStore((s) => s.settings.temperature);
  const createConversation = useAppStore((s) => s.createConversation);
  const addMessage = useAppStore((s) => s.addMessage);
  const updateLastAssistant = useAppStore((s) => s.updateLastAssistant);
  const setStreamState = useAppStore((s) => s.setStreamState);
  const resetStream = useAppStore((s) => s.resetStream);
  const modelLoading = useAppStore((s) => s.modelLoading);
  const deepResearch = useAppStore((s) => s.deepResearch);
  const setDeepResearch = useAppStore((s) => s.setDeepResearch);

  const corpusSync = useResearchCorpusSync(deepResearch);

  const isCurrentChatStreaming =
    streamState.isStreaming &&
    streamState.conversationId === activeId;

  const {
    state: speechState,
    error: speechError,
    available: speechAvailable,
    startRecording,
    stopRecording,
  } = useSpeech((text) => {
    if (!text.trim()) {
      if (voiceConversationRef.current) {
        pendingVoiceRestartRef.current = true;
      }
      return;
    }

    if (voiceConversationRef.current) {
      pendingVoiceRestartRef.current = true;
    }
    void sendMessageRef.current(text, 'voice');
  });
  const {
    state: wakeSpeechState,
    error: wakeSpeechError,
    available: wakeSpeechAvailable,
    healthChecked: wakeHealthChecked,
    availabilityError: wakeAvailabilityError,
    startRecording: startWakeRecording,
    cancelRecording: cancelWakeRecording,
  } = useSpeech((transcript) => {
    if (
      voiceConversationRef.current ||
      streamState.isStreaming ||
      ttsState !== 'idle'
    ) {
      return;
    }

    const message = getWakeWordMessage(transcript);
    if (message === null) {
      if (startsWithWakeGreeting(transcript)) {
        toast.info('Ouvi uma saudação, mas não reconheci “Zetta”. Tente dizer “Olá, Zetta” com clareza.');
      }
      return;
    }

    voiceConversationRef.current = true;
    setVoiceConversationActive(true);
    pendingVoiceRestartRef.current = true;
    void sendMessageRef.current(message, 'voice');
  });

  // Abort an in-flight stream when the user switches models mid-generation.
  const prevModelRef = useRef(selectedModel);

  useEffect(() => {
    if (
      prevModelRef.current !== selectedModel &&
      streamState.isStreaming
    ) {
      abortRef.current?.abort();

      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }

      resetStream();
      abortRef.current = null;
    }

    prevModelRef.current = selectedModel;
  }, [selectedModel, streamState.isStreaming, resetStream]);

  const micDisabled =
    !speechEnabled ||
    !speechAvailable ||
    streamState.isStreaming;

  const micReason:
    | 'not-enabled'
    | 'no-backend'
    | 'streaming'
    | undefined =
    !speechEnabled
      ? 'not-enabled'
      : !speechAvailable
        ? 'no-backend'
        : streamState.isStreaming
          ? 'streaming'
          : undefined;

  const wakeStatus: WakeStatus = wakeSpeechError || (
    wakeHealthChecked && !wakeSpeechAvailable
  )
    ? 'offline'
    : voiceConversationActive
      ? speechState === 'transcribing' || wakeSpeechState === 'transcribing'
        ? 'transcribing'
        : 'conversation'
      : wakeSpeechState === 'recording'
        ? 'listening'
        : wakeSpeechState === 'transcribing'
          ? 'transcribing'
          : 'idle';

  useEffect(() => {
    onWakeStatusChange?.(wakeStatus);
  }, [onWakeStatusChange, wakeStatus]);

  useEffect(() => {
    const message = wakeSpeechError ?? (
      wakeHealthChecked && !wakeSpeechAvailable
          ? wakeAvailabilityError
          : null
    );
    if (message) {
      toast.error(`Wake word: ${message}`, { duration: 8000 });
    }
  }, [
    wakeSpeechError,
    wakeHealthChecked,
    wakeSpeechAvailable,
    wakeAvailabilityError,
  ]);

  useEffect(() => {
    if (
      !speechEnabled ||
      !wakeSpeechAvailable ||
      wakeSpeechError ||
      voiceConversationActive ||
      wakeSpeechState !== 'idle' ||
      speechState !== 'idle' ||
      streamState.isStreaming ||
      ttsState !== 'idle'
    ) {
      return;
    }

    void startWakeRecording().catch(() => undefined);
  }, [
    speechEnabled,
    wakeSpeechAvailable,
    wakeSpeechError,
    voiceConversationActive,
    wakeSpeechState,
    speechState,
    streamState.isStreaming,
    ttsState,
    startWakeRecording,
  ]);

  useEffect(() => {
    if (speechError) {
      toast.error(speechError, { duration: 8000 });
    }
  }, [speechError]);

  // Starts or stops continuous voice conversation.
  const handleMicClick = useCallback(async () => {
    if (speechState === 'recording') {
      voiceConversationRef.current = false;
      setVoiceConversationActive(false);
      pendingVoiceRestartRef.current = false;
      if (wakeSpeechState === 'recording') {
        await cancelWakeRecording().catch(() => undefined);
      }

      try {
        await stopRecording();
      } catch {
        // Error is captured by useSpeech.
      }

      return;
    }

    if (speechState === 'transcribing') {
      voiceConversationRef.current = false;
      setVoiceConversationActive(false);
      pendingVoiceRestartRef.current = false;
      return;
    }

    // Clicking again while the conversation is active turns it off.
    if (voiceConversationRef.current) {
      voiceConversationRef.current = false;
      setVoiceConversationActive(false);
      pendingVoiceRestartRef.current = false;
      return;
    }

    voiceConversationRef.current = true;
    setVoiceConversationActive(true);

    if (wakeSpeechState === 'recording') {
      await cancelWakeRecording().catch(() => undefined);
    }

    try {
      await startRecording();
    } catch {
      voiceConversationRef.current = false;
      setVoiceConversationActive(false);
    }
  }, [
    speechState,
    startRecording,
    stopRecording,
    wakeSpeechState,
    cancelWakeRecording,
  ]);

  // When the assistant finishes speaking, restart microphone recording.
  useEffect(() => {
    const previousState = previousTtsStateRef.current;
    previousTtsStateRef.current = ttsState;

    const speechFinished =
      (previousState === 'speaking' ||
        previousState === 'loading') &&
      ttsState === 'idle';

    if (speechFinished) {
      pendingVoiceRestartRef.current = true;
    }

    if (
      voiceConversationRef.current &&
      pendingVoiceRestartRef.current &&
      ttsState === 'idle' &&
      wakeSpeechState === 'idle' &&
      speechState === 'idle' &&
      !streamState.isStreaming
    ) {
      pendingVoiceRestartRef.current = false;

      void startRecording().catch(() => {
        voiceConversationRef.current = false;
        setVoiceConversationActive(false);
        toast.error('Não foi possível continuar a conversa por voz. Verifique o microfone.');
      });
    }
  }, [
    ttsState,
    wakeSpeechState,
    speechState,
    streamState.isStreaming,
    startRecording,
  ]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;

    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, [input]);

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    resetStream();
  }, [resetStream]);

  const sendMessage = useCallback(async (
    transcribedText?: string,
    inputSource: 'text' | 'voice' = 'text',
  ) => {
    const content = (transcribedText ?? input).trim();

    if (!content || streamState.isStreaming) return;

    if (!selectedModel) {
      toast.error('Pick a model first (⌘K)');
      return;
    }

    setInput('');

    let convId = activeId;

    if (!convId) {
      convId = createConversation(selectedModel);
    }

    const userMsg: ChatMessage = {
      id: generateId(),
      role: 'user',
      content,
      timestamp: Date.now(),
    };

    addMessage(convId, userMsg);

    // Build API messages before adding the assistant placeholder.
    const currentMessages = useAppStore.getState().messages;

    const apiMessages = currentMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const assistantMsg: ChatMessage = {
      id: generateId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      isResearch: deepResearch || undefined,
    };

    addMessage(convId, assistantMsg);

    // Start streaming.
    const startTime = Date.now();

    const timer = setInterval(() => {
      setStreamState({ elapsedMs: Date.now() - startTime });
    }, 100);

    timerRef.current = timer;

    const controller = new AbortController();
    abortRef.current = controller;

    let accumulatedContent = '';
    let usage: TokenUsage | undefined;
    let complexity:
      | {
        score: number;
        tier: string;
        suggested_max_tokens: number;
      }
      | undefined;

    let routedEngine: string | undefined;

    const toolCalls: ToolCallInfo[] = [];
    const researchTraces: ResearchSearchTrace[] = [];
    const researchSourcesByRef = new Map<number, ResearchSource>();

    const flushSources = () =>
      Array.from(researchSourcesByRef.values()).sort(
        (a, b) => a.ref - b.ref,
      );

    let lastFlush = 0;
    let ttftMs: number | undefined;

    setStreamState({
      conversationId: convId,
      isStreaming: true,
      phase: deepResearch ? 'Researching...' : 'Generating...',
      elapsedMs: 0,
      activeToolCalls: [],
      content: '',
    });

    useAppStore.getState().addLogEntry({
      timestamp: Date.now(),
      level: 'info',
      category: 'chat',
      message: deepResearch
        ? `Research: "${content.slice(0, 80)}${content.length > 80 ? '...' : ''}"`
        : `Request: "${content.slice(0, 80)}${content.length > 80 ? '...' : ''}" → ${selectedModel}`,
    });

    try {
      if (deepResearch) {
        for await (const ev of streamResearch(
          content,
          selectedModel,
          controller.signal,
        )) {
          if (ev.type === 'search_call') {
            const trace: ResearchSearchTrace = {
              id: generateId(),
              query: ev.arguments?.query ?? '',
              person: ev.arguments?.person,
              timeRange: ev.arguments?.time_range,
              status: 'pending',
            };

            researchTraces.push(trace);

            setStreamState({
              phase: `Searching: ${trace.query}`,
            });

            updateLastAssistant(
              convId,
              accumulatedContent,
              undefined,
              undefined,
              undefined,
              undefined,
              [...researchTraces],
              flushSources(),
            );

            useAppStore.getState().addLogEntry({
              timestamp: Date.now(),
              level: 'info',
              category: 'tool',
              message: `Search: "${trace.query}"${trace.person ? ` (person: ${trace.person})` : ''}`,
            });
          } else if (ev.type === 'search_result') {
            const pending = [...researchTraces]
              .reverse()
              .find((t) => t.status === 'pending');

            if (pending) {
              pending.status = 'complete';
              pending.numHits = ev.num_hits;
              pending.topTitles = ev.top_titles;
            }

            if (ev.sources) {
              for (const src of ev.sources) {
                if (
                  src &&
                  typeof src.ref === 'number' &&
                  !researchSourcesByRef.has(src.ref)
                ) {
                  researchSourcesByRef.set(src.ref, src);
                }
              }
            }

            updateLastAssistant(
              convId,
              accumulatedContent,
              undefined,
              undefined,
              undefined,
              undefined,
              [...researchTraces],
              flushSources(),
            );
          } else if (ev.type === 'synthesis') {
            if (!ttftMs) {
              ttftMs = Date.now() - startTime;
            }

            accumulatedContent += ev.text;

            setStreamState({
              content: accumulatedContent,
              phase: '',
            });

            const now = Date.now();

            if (now - lastFlush >= 80) {
              updateLastAssistant(
                convId,
                accumulatedContent,
                undefined,
                undefined,
                undefined,
                undefined,
                [...researchTraces],
                flushSources(),
              );

              lastFlush = now;
            }
          } else if (ev.type === 'system_metrics') {
            useAppStore.getState().setLiveEnergy({
              power_w: ev.power_w,
              energy_j: ev.energy_j,
              duration_s: ev.duration_s,
            });
          } else if (ev.type === 'error') {
            const msg =
              ev.message || 'Research failed (no detail provided)';

            accumulatedContent = accumulatedContent
              ? `${accumulatedContent}\n\n**Research stopped:** ${msg}`
              : `**Research failed:** ${msg}`;

            setStreamState({
              content: accumulatedContent,
              phase: '',
            });

            useAppStore.getState().addLogEntry({
              timestamp: Date.now(),
              level: 'error',
              category: 'chat',
              message: `Deep Research error: ${msg}`,
            });

            toast.error(msg, { duration: 8000 });
          } else if (ev.type === 'done') {
            if (ev.usage) {
              usage = {
                prompt_tokens: ev.usage.prompt_tokens ?? 0,
                completion_tokens: ev.usage.completion_tokens ?? 0,
                total_tokens:
                  ev.usage.total_tokens ??
                  (ev.usage.prompt_tokens ?? 0) +
                  (ev.usage.completion_tokens ?? 0),
              };

              useAppStore.getState().incrementSavings(usage);
            }

            window.setTimeout(() => {
              useAppStore.getState().setLiveEnergy(null);
            }, 1500);

            break;
          }
        }
      } else {
        for await (const sseEvent of streamChat(
          {
            model: selectedModel,
            messages: apiMessages,
            conversation_id: convId,
            input_source: inputSource,
            stream: true,
            temperature,
            max_tokens: maxTokens,
          },
          controller.signal,
        )) {
          const eventName = sseEvent.event;

          if (eventName === 'agent_turn_start') {
            setStreamState({ phase: 'Agent thinking...' });
          } else if (eventName === 'inference_start') {
            setStreamState({ phase: 'Generating...' });

            useAppStore.getState().addLogEntry({
              timestamp: Date.now(),
              level: 'info',
              category: 'chat',
              message: `Generating with ${selectedModel}...`,
            });
          } else if (eventName === 'tool_call_start') {
            try {
              const data = JSON.parse(sseEvent.data);

              const tc: ToolCallInfo = {
                id: generateId(),
                tool: data.tool,
                arguments: serializeToolCallArguments(data.arguments),
                status: 'running',
              };

              toolCalls.push(tc);

              setStreamState({
                phase: `Calling ${data.tool}...`,
                activeToolCalls: [...toolCalls],
              });

              updateLastAssistant(
                convId,
                accumulatedContent,
                [...toolCalls],
              );

              useAppStore.getState().addLogEntry({
                timestamp: Date.now(),
                level: 'info',
                category: 'tool',
                message: `Calling ${data.tool}(${serializeToolCallArguments(data.arguments)})`,
              });
            } catch {
              // Ignore malformed tool-call events.
            }
          } else if (eventName === 'tool_call_end') {
            try {
              const data = JSON.parse(sseEvent.data);

              const tc = toolCalls.find(
                (t) => t.tool === data.tool && t.status === 'running',
              );

              if (tc) {
                tc.status = data.success ? 'success' : 'error';
                tc.latency = data.latency;
                tc.result = data.result;
              }

              setStreamState({
                phase: 'Generating...',
                activeToolCalls: [...toolCalls],
              });

              updateLastAssistant(
                convId,
                accumulatedContent,
                [...toolCalls],
              );
            } catch {
              // Ignore malformed tool-call events.
            }
          } else {
            try {
              const data = JSON.parse(sseEvent.data);
              const delta = data.choices?.[0]?.delta;

              if (data.usage) usage = data.usage;
              if (data.complexity) complexity = data.complexity;

              routedEngine =
                engineFromCompletionChunk(data) ?? routedEngine;

              if (delta?.content) {
                if (!ttftMs) {
                  ttftMs = Date.now() - startTime;
                }

                accumulatedContent += delta.content;

                setStreamState({
                  content: accumulatedContent,
                  phase: '',
                });

                const now = Date.now();

                if (now - lastFlush >= 80) {
                  updateLastAssistant(
                    convId,
                    accumulatedContent,
                    toolCalls.length > 0
                      ? [...toolCalls]
                      : undefined,
                  );

                  lastFlush = now;
                }
              }

              if (
                data.choices?.[0]?.finish_reason === 'stop'
              ) {
                break;
              }
            } catch {
              // Ignore malformed stream events.
            }
          }
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        if (!accumulatedContent) {
          accumulatedContent = '(Generation stopped)';
        }
      } else {
        const errMsg = err?.message || String(err);

        accumulatedContent =
          accumulatedContent || `Error: ${errMsg}`;

        useAppStore.getState().addLogEntry({
          timestamp: Date.now(),
          level: 'error',
          category: 'chat',
          message: `Stream error: ${errMsg}`,
        });
      }

      useAppStore.getState().setLiveEnergy(null);
    } finally {
      if (!accumulatedContent) {
        accumulatedContent =
          'No response was generated. Please try again.';
      }

      const totalMs = Date.now() - startTime;
      const appState = useAppStore.getState();

      const selectedOwner = appState.models.find(
        (m) => m.id === selectedModel,
      )?.owned_by;

      const engineLabel = resolveChatEngine({
        routedEngine,
        serverEngine: appState.serverInfo?.engine,
        selectedModel,
        selectedOwner,
      });

      const telemetry: MessageTelemetry = {
        engine: engineLabel,
        model_id: selectedModel,
        total_ms: totalMs,
        ttft_ms: ttftMs,
        tokens_per_sec: usage?.completion_tokens
          ? usage.completion_tokens / (totalMs / 1000)
          : undefined,
        complexity_score: complexity?.score,
        complexity_tier: complexity?.tier,
        suggested_max_tokens: complexity?.suggested_max_tokens,
      };

      // Check whether digest audio is available.
      let audioMeta: { url: string } | undefined;

      try {
        const digestRes = await fetch(`${getBase()}/api/digest`);

        if (digestRes.ok) {
          const digest = await digestRes.json();

          if (digest.audio_available) {
            audioMeta = {
              url: `${getBase()}/api/digest/audio`,
            };
          }
        }
      } catch {
        // Not a digest response or server unavailable — skip.
      }

      updateLastAssistant(
        convId,
        accumulatedContent,
        toolCalls.length > 0 ? toolCalls : undefined,
        usage,
        telemetry,
        audioMeta,
        researchTraces.length > 0
          ? researchTraces
          : undefined,
        researchSourcesByRef.size > 0
          ? flushSources()
          : undefined,
      );

      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }

      resetStream();

      useAppStore.getState().addLogEntry({
        timestamp: Date.now(),
        level: 'info',
        category: 'chat',
        message: `Response: ${accumulatedContent.length} chars`,
      });

      abortRef.current = null;

      // Research updates session counters optimistically.
      if (!deepResearch) {
        fetchSavings()
          .then((data) => useAppStore.getState().setSavings(data))
          .catch(() => { });
      }
    }
  }, [
    input,
    activeId,
    selectedModel,
    streamState.isStreaming,
    createConversation,
    addMessage,
    updateLastAssistant,
    setStreamState,
    resetStream,
    deepResearch,
    temperature,
    maxTokens,
  ]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  useEffect(() => {
    sendMessageRef.current = sendMessage;
  }, [sendMessage]);

  return (
    <div
      className="px-4 pb-4 pt-2"
      style={{
        maxWidth: '960px',
        margin: '0 auto',
        width: '100%',
      }}
    >
      <div className="mb-2 flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setDeepResearch(!deepResearch)}
            disabled={streamState.isStreaming}
            aria-pressed={deepResearch}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs transition-colors cursor-pointer disabled:cursor-default disabled:opacity-50"
            style={{
              background: deepResearch
                ? 'var(--color-accent-subtle)'
                : 'transparent',
              border: `1px solid ${deepResearch
                ? 'var(--color-accent)'
                : 'var(--color-border)'
                }`,
              color: deepResearch
                ? 'var(--color-accent)'
                : 'var(--color-text-tertiary)',
            }}
            title={
              deepResearch
                ? 'Deep Research: on'
                : 'Deep Research: off'
            }
          >
            <Search size={12} />
            Deep Research
          </button>
        </div>

        {deepResearch &&
          corpusSync.syncing &&
          corpusSync.itemsSynced > 0 && (
            <div
              className="text-[11px] leading-snug"
              style={{ color: 'var(--color-text-tertiary)' }}
            >
              Searching over{' '}
              <span
                key={corpusSync.itemsSynced}
                className="sync-bump"
                style={{
                  color: 'var(--color-text-secondary)',
                }}
              >
                {corpusSync.itemsSynced.toLocaleString()}
              </span>{' '}
              items — sync in progress, results will improve as more
              data is indexed.
            </div>
          )}
      </div>

      <div
        className="flex items-center gap-2 rounded-2xl px-4 py-3 transition-shadow"
        style={{
          background: 'var(--color-input-bg)',
          border: '1px solid var(--color-input-border)',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            selectedModel
              ? 'Message Zetta...'
              : 'Pick a model first (⌘K)...'
          }
          rows={1}
          className="flex-1 bg-transparent outline-none resize-none text-sm leading-relaxed"
          style={{
            color: 'var(--color-text)',
            maxHeight: '200px',
            // The auto-size effect measures scrollHeight, which is 0 while the
            // HUD chat panel is display:none; without a floor the field is
            // 0px tall once the panel opens and cannot be focused.
            minHeight: '1.5rem',
          }}
          disabled={streamState.isStreaming || modelLoading}
        />

        {isCurrentChatStreaming ? (
          <button
            onClick={stopStreaming}
            className="p-2 rounded-xl transition-colors shrink-0 cursor-pointer"
            style={{
              background: 'var(--color-error)',
              color: 'var(--color-on-accent)',
            }}
            title="Stop generating"
          >
            <Square size={16} />
          </button>
        ) : (
          <div className="flex items-center gap-1">
            <MicButton
              state={speechState}
              onClick={handleMicClick}
              disabled={micDisabled}
              reason={micReason}
            />

            <button
              onClick={() => void sendMessage()}
              disabled={
                streamState.isStreaming ||
                !input.trim() ||
                modelLoading ||
                !selectedModel
              }
              title={
                selectedModel
                  ? 'Send message'
                  : 'Pick a model first (⌘K)'
              }
              className="p-2 rounded-xl transition-colors shrink-0 cursor-pointer disabled:opacity-30 disabled:cursor-default"
              style={{
                background: input.trim()
                  ? 'var(--color-accent)'
                  : 'var(--color-bg-tertiary)',
                color: input.trim()
                  ? 'white'
                  : 'var(--color-text-tertiary)',
              }}
            >
              <Send size={16} />
            </button>
          </div>
        )}
      </div>

      <div
        className="flex items-center justify-center mt-2 text-[11px]"
        style={{ color: 'var(--color-text-tertiary)' }}
      >
        <span>
          <kbd className="font-mono">Enter</kbd> to send &middot;{' '}
          <kbd className="font-mono">Shift+Enter</kbd> for new line
        </span>
      </div>
    </div>
  );
}
