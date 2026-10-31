import { useEffect, useState } from 'react';
import {
  Activity,
  BarChart3,
  Focus,
  Mail,
  MessageSquareText,
  Newspaper,
  Radar,
  RotateCcw,
  Server,
  Trash2,
  Volume2,
  X,
} from 'lucide-react';
import { ChatArea } from '../components/Chat/ChatArea';
import { XRayFooter } from '../components/Chat/XRayFooter';
import { NewsPanel } from '../components/NewsPanel';
import { UnreadMailPanel } from '../components/UnreadMailPanel';
import { useMorningBriefing } from '../hooks/useMorningBriefing';
import { useNews } from '../hooks/useNews';
import { useUnreadMail } from '../hooks/useUnreadMail';
import { fetchObsidianStatus, fetchSystemStats, type ObsidianStatus, type SystemStats } from '../lib/api';
import { useAppStore } from '../lib/store';
import { useTtsStore } from '../lib/tts';
import type { ToolCallInfo } from '../types';

const TOOL_LABELS: Record<string, string> = {
  file_read: 'Lendo arquivo ou nota',
  file_write: 'Criando ou atualizando nota',
  obsidian_search_notes: 'Buscando notas no Obsidian',
  web_search: 'Pesquisando na web',
  calculator: 'Calculando',
  code_interpreter: 'Executando código',
  daily_briefing: 'Preparando o resumo do dia',
};

function getToolLabel(tool: string): string {
  return TOOL_LABELS[tool] ?? `Executando ${tool.replace(/_/g, ' ')}`;
}

function getActivityPhaseLabel(
  phase: string,
  isProcessing: boolean,
  hasStreamedContent: boolean,
  runningTool?: ToolCallInfo,
  isSpeaking = false,
): string {
  if (!isProcessing) {
    return isSpeaking ? 'Lendo resposta em voz alta' : 'Pronto para nova solicitação';
  }
  if (runningTool) return getToolLabel(runningTool.tool);
  if (phase.startsWith('Searching:')) return `Pesquisando${phase.slice('Searching:'.length)}`;
  if (phase.toLowerCase().includes('research')) return 'Pesquisando fontes e contexto';
  if (phase.startsWith('Calling ')) {
    const tool = phase.slice('Calling '.length).replace(/\.\.\.$/, '').trim();
    return `Preparando ação: ${getToolLabel(tool)}`;
  }
  if (phase.toLowerCase().includes('generat')) return 'Gerando resposta';
  if (phase.toLowerCase().includes('think')) return 'Analisando seu pedido';
  if (phase) return phase;
  return hasStreamedContent ? 'Redigindo resposta' : 'Preparando sua solicitação';
}

function getToolTarget(toolCall: ToolCallInfo): string {
  try {
    const args = JSON.parse(toolCall.arguments) as Record<string, unknown>;
    if (typeof args.path === 'string') {
      return args.path.split(/[\\/]/).pop() || args.path;
    }

    for (const key of ['query', 'url', 'expression']) {
      const value = args[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim().replace(/\s+/g, ' ').slice(0, 96);
      }
    }
  } catch {
    return '';
  }
  return '';
}

function formatTimeOfDay(date: Date): string {
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function formatRate(bytesPerSecond: number | null | undefined): string {
  if (bytesPerSecond == null) return '—';
  if (bytesPerSecond >= 1_048_576) return `${(bytesPerSecond / 1_048_576).toFixed(1)}M`;
  if (bytesPerSecond >= 1024) return `${Math.round(bytesPerSecond / 1024)}K`;
  return `${Math.round(bytesPerSecond)}B`;
}

function formatGigabytes(bytes: number): string {
  return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
}

const SYSTEM_HISTORY = 30;

/** Sparkline points; pass `peak` for a fixed scale (e.g. 100 for percentages). */
function sparkPoints(values: number[], width: number, height: number, peak?: number): string {
  if (values.length === 0) return '';
  const series = values.length === 1 ? [values[0], values[0]] : values;
  const max = peak ?? Math.max(1, ...series);
  const step = width / (series.length - 1);
  return series
    .map((value, index) => `${(index * step).toFixed(1)},${(height - 1 - (value / max) * (height - 2)).toFixed(1)}`)
    .join(' ');
}

const TERRAIN_ROWS = Array.from({ length: 8 }, (_, index) => 8 + Math.pow(index / 7, 1.6) * 48);
const TERRAIN_COLUMNS = Array.from({ length: 11 }, (_, index) => index - 5);

function HudDial({ busy, className = '' }: { busy: boolean; className?: string }) {
  return (
    <svg className={`hud-dial ${busy ? 'is-busy' : ''} ${className}`} viewBox="0 0 64 64" aria-hidden="true">
      <circle className="hud-dial-ring" cx="32" cy="32" r="29" />
      <circle className="hud-dial-ring hud-dial-dashed" cx="32" cy="32" r="22" />
      <g className="hud-dial-spin">
        <path className="hud-dial-arc" d="M32 3a29 29 0 0 1 25 14" />
        <path className="hud-dial-arc" d="M32 61a29 29 0 0 1-25-14" />
      </g>
      <circle className="hud-dial-core" cx="32" cy="32" r="9" />
      <circle className="hud-dial-dot" cx="32" cy="32" r="3" />
    </svg>
  );
}

function getToolStatusLabel(status: ToolCallInfo['status'], latency?: number): string {
  if (status === 'running') return 'EM ANDAMENTO';
  if (status === 'error') return 'FALHOU';
  return latency != null ? `CONCLUÍDO · ${(latency / 1000).toFixed(2)}S` : 'CONCLUÍDO';
}

export function ChatPageWithVideo() {
  const [chatOpen, setChatOpen] = useState(false);
  const [activityVisible, setActivityVisible] = useState(true);
  const [systemPanelVisible, setSystemPanelVisible] = useState(true);
  const [signalPanelVisible, setSignalPanelVisible] = useState(true);
  const [radarPaused, setRadarPaused] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [vault, setVault] = useState<ObsidianStatus | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [system, setSystem] = useState<{
    stats: SystemStats | null;
    cpu: number[];
    memory: number[];
    network: number[];
  }>({ stats: null, cpu: [], memory: [], network: [] });
  const [wakeStatus, setWakeStatus] = useState<
    'listening' | 'transcribing' | 'offline' | 'idle' | 'conversation'
  >('idle');
  const ttsState = useTtsStore((s) => s.state);
  const speakingId = useTtsStore((s) => s.speakingId);
  const ttsAvailable = useTtsStore((s) => s.available);
  const ensureTtsHealth = useTtsStore((s) => s.ensureHealth);
  const messages = useAppStore((s) => s.messages);
  const models = useAppStore((s) => s.models);
  const modelsLoading = useAppStore((s) => s.modelsLoading);
  const selectedModel = useAppStore((s) => s.selectedModel);
  const serverInfo = useAppStore((s) => s.serverInfo);
  const apiReachable = useAppStore((s) => s.apiReachable);
  const activeId = useAppStore((s) => s.activeId);
  const deleteConversation = useAppStore((s) => s.deleteConversation);
  const savings = useAppStore((s) => s.savings);
  const streamState = useAppStore((s) => s.streamState);
  const voiceOutputEnabled = useAppStore((s) => s.settings.voiceOutputEnabled);

  const {
    mail,
    open: mailOpen,
    close: closeMail,
    reopen: reopenMail,
    hasNew: mailHasNew,
  } = useUnreadMail();
  const {
    news,
    open: newsOpen,
    close: closeNews,
    reopen: reopenNews,
    hasNew: newsHasNew,
  } = useNews();
  const { needsGesture: morningNeedsGesture, start: startMorning } = useMorningBriefing();

  const isSpeaking = ttsState === 'speaking' && speakingId !== null;
  const latestAssistantMessage = [...messages].reverse().find((message) => message.role === 'assistant');
  const isProcessing = streamState.isStreaming && streamState.conversationId === activeId;
  const visibleToolCalls = (
    isProcessing
      ? streamState.activeToolCalls
      : latestAssistantMessage?.toolCalls ?? []
  ).slice(-4);
  const runningTool = [...visibleToolCalls].reverse().find((toolCall) => toolCall.status === 'running');
  const activityPhaseLabel = getActivityPhaseLabel(
    streamState.phase,
    isProcessing,
    Boolean(streamState.content),
    runningTool,
    isSpeaking,
  );
  const recentMeasuredMessages = messages
    .filter((message) => message.role === 'assistant' && message.usage)
    .slice(-12);
  const latestMeasuredMessage = [...recentMeasuredMessages].reverse()[0];
  const latestUsage = latestMeasuredMessage?.usage;
  const latestTelemetry = latestAssistantMessage?.telemetry;
  const messageCounts = messages.reduce(
    (counts, message) => {
      counts[message.role] += 1;
      counts.tools += message.toolCalls?.length ?? 0;
      counts.tokens += message.usage?.total_tokens
        ?? (message.usage?.prompt_tokens ?? 0) + (message.usage?.completion_tokens ?? 0);
      return counts;
    },
    { user: 0, assistant: 0, tools: 0, tokens: 0 },
  );
  const modelAvailable = selectedModel !== '' && models.some((model) => model.id === selectedModel);
  const selectedModelInfo = models.find((model) => model.id === selectedModel);
  const engineName = latestTelemetry?.engine || serverInfo?.engine || 'SEM DADOS DO MOTOR';
  const serverConnected = apiReachable === true;
  const systemStatus = apiReachable === null
    ? 'VERIFICANDO'
    : serverConnected
      ? 'ATIVO'
      : 'INATIVO';
  const voiceStatus = isSpeaking
    ? 'FALANDO'
    : ttsState === 'loading'
      ? 'PREPARANDO'
      : !voiceOutputEnabled
        ? 'DESLIGADO'
        : ttsAvailable === null
          ? 'VERIFICANDO'
          : ttsAvailable
            ? 'PRONTO'
            : 'INDISPONÍVEL';
  const vaultStatus = vault === null
    ? 'INDISPONÍVEL'
    : !vault.configured
      ? 'NÃO DEFINIDO'
      : vault.connected
        ? 'CONECTADO'
        : 'NÃO ENCONTRADO';
  const statusBars = [
    { label: 'SERVIDOR', state: apiReachable === null ? 'VERIFICANDO' : serverConnected ? 'PRONTO' : 'INATIVO', ready: serverConnected },
    { label: 'MODELO', state: modelsLoading ? 'BUSCANDO' : modelAvailable && serverConnected ? 'PRONTO' : 'INATIVO', ready: modelAvailable && serverConnected },
    { label: 'COFRE', state: vaultStatus === 'CONECTADO' ? 'PRONTO' : 'INATIVO', ready: vault?.connected === true },
    { label: 'VOZ', state: !voiceOutputEnabled ? 'DESLIGADO' : ttsAvailable === null ? 'VERIFICANDO' : ttsAvailable ? 'PRONTO' : 'INATIVO', ready: voiceOutputEnabled && ttsAvailable === true },
  ];
  const signalBars = recentMeasuredMessages.map((message) => ({
    id: message.id,
    timestamp: new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    prompt: message.usage?.prompt_tokens ?? 0,
    completion: message.usage?.completion_tokens ?? 0,
  }));
  const maxTokens = Math.max(1, ...signalBars.map((bar) => bar.prompt + bar.completion));
  const inSeries = recentMeasuredMessages.map((message) => message.usage?.prompt_tokens ?? 0);
  const outSeries = recentMeasuredMessages.map((message) => message.usage?.completion_tokens ?? 0);
  const rateSeries = recentMeasuredMessages.map((message) => message.telemetry?.tokens_per_sec ?? 0);
  const trendRows = [
    { label: 'ENTRADA', series: inSeries, value: latestUsage?.prompt_tokens.toLocaleString() ?? '—' },
    { label: 'SAÍDA', series: outSeries, value: latestUsage?.completion_tokens.toLocaleString() ?? '—' },
    {
      label: 'TOK/S',
      series: rateSeries,
      value: latestTelemetry?.tokens_per_sec ? latestTelemetry.tokens_per_sec.toFixed(1) : '—',
    },
  ];
  const hostStats = system.stats;
  const systemRows: Array<{
    label: string;
    value: string;
    title: string;
    series?: number[];
    peak?: number;
    bar?: number;
  }> = [
    {
      label: 'CPU',
      value: hostStats ? `${hostStats.cpu.percent.toFixed(0)}%` : '—',
      title: 'Uso de CPU do computador',
      series: system.cpu,
      peak: 100,
    },
    {
      label: 'MEMÓRIA',
      value: hostStats ? `${hostStats.memory.percent.toFixed(0)}%` : '—',
      title: hostStats
        ? `Memória: ${formatGigabytes(hostStats.memory.used_bytes)} de ${formatGigabytes(hostStats.memory.total_bytes)}`
        : 'Memória indisponível',
      series: system.memory,
      peak: 100,
    },
    {
      label: 'DISCO',
      value: hostStats?.disk ? `${hostStats.disk.percent.toFixed(0)}%` : '—',
      title: hostStats?.disk
        ? `Disco do sistema: ${formatGigabytes(hostStats.disk.used_bytes)} de ${formatGigabytes(hostStats.disk.total_bytes)}`
        : 'Disco indisponível',
      bar: hostStats?.disk?.percent ?? 0,
    },
    {
      label: 'REDE',
      value: hostStats ? `↓${formatRate(hostStats.network.down)} ↑${formatRate(hostStats.network.up)}` : '—',
      title: 'Rede: recebido ↓ e enviado ↑ por segundo',
      series: system.network,
    },
  ];
  const recentRows = messages.slice(-8).map((message) => ({
    id: message.id,
    role: message.role,
    time: new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    tokens: message.usage
      ? message.usage.total_tokens ?? message.usage.prompt_tokens + message.usage.completion_tokens
      : null,
  }));
  const lastTotal = (latestUsage?.prompt_tokens ?? 0) + (latestUsage?.completion_tokens ?? 0);
  const gaugeFill = latestUsage ? Math.round((lastTotal / maxTokens) * 100) : 0;
  const sessionTag = activeId ? activeId.slice(0, 8).toUpperCase() : 'SEM_SESSAO';
  const leftCode: Array<[string, string]> = [
    ['MOTOR', engineName],
    ['MODELO', selectedModel || 'NENHUM'],
    ['COFRE', vault?.connected ? vault.vault : vaultStatus],
    ['FERRAMENTAS', String(messageCounts.tools)],
    ['MENSAGENS', String(messageCounts.user + messageCounts.assistant)],
    ['SESSÃO', sessionTag],
  ];
  const rightCode: Array<[string, string]> = [
    ['CONEXÃO', systemStatus],
    ['VOZ', voiceStatus],
    ['FASE', isProcessing ? activityPhaseLabel.toUpperCase() : 'OCIOSO'],
    ['1º TOKEN', latestTelemetry?.ttft_ms != null ? `${latestTelemetry.ttft_ms.toLocaleString()} MS` : '—'],
    ['TOK/S', latestTelemetry?.tokens_per_sec ? latestTelemetry.tokens_per_sec.toFixed(1) : '—'],
    ['TOKENS', messageCounts.tokens.toLocaleString()],
  ];
  const sphereDots = Array.from({ length: 13 }, (_, latitudeIndex) => {
    const latitude = ((latitudeIndex - 6) * 12 * Math.PI) / 180;
    return Array.from({ length: 31 }, (_, longitudeIndex) => {
      const longitude = ((longitudeIndex - 15) * 6 * Math.PI) / 180;
      const depth = Math.cos(latitude) * Math.cos(longitude);
      return {
        x: 300 + 100 * Math.cos(latitude) * Math.sin(longitude),
        y: 300 - 100 * Math.sin(latitude),
        depth,
      };
    }).filter((dot) => dot.depth > 0.06);
  }).flat();

  const canDelete = activeId !== null && !isProcessing;

  const handleDeleteConversation = () => {
    if (!canDelete) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setConfirmDelete(false);
    deleteConversation(activeId);
  };

  const restoreLayout = () => {
    setActivityVisible(true);
    setSystemPanelVisible(true);
    setSignalPanelVisible(true);
    setRadarPaused(false);
    setFocusMode(false);
    setChatOpen(false);
  };

  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      void fetchSystemStats().then((stats) => {
        if (cancelled) return;
        setSystem((previous) => {
          if (stats === null) return { ...previous, stats: null };
          const throughput = stats.network.down != null
            ? [...previous.network, stats.network.down + (stats.network.up ?? 0)]
            : previous.network;
          return {
            stats,
            cpu: [...previous.cpu, stats.cpu.percent].slice(-SYSTEM_HISTORY),
            memory: [...previous.memory, stats.memory.percent].slice(-SYSTEM_HISTORY),
            network: throughput.slice(-SYSTEM_HISTORY),
          };
        });
      });
    };
    poll();
    const timer = window.setInterval(poll, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refreshVault = () => {
      void fetchObsidianStatus().then((status) => {
        if (!cancelled) setVault(status);
      });
    };
    refreshVault();
    const timer = window.setInterval(refreshVault, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    void ensureTtsHealth();
  }, [ensureTtsHealth]);

  // The confirmation is only valid for a few seconds, and never survives
  // closing the panel or switching/finishing the conversation.
  useEffect(() => {
    if (!confirmDelete) return;
    const timer = window.setTimeout(() => setConfirmDelete(false), 4000);
    return () => window.clearTimeout(timer);
  }, [confirmDelete]);

  useEffect(() => {
    setConfirmDelete(false);
  }, [chatOpen, activeId, isProcessing]);

  useEffect(() => {
    if (!chatOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setChatOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [chatOpen]);

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--color-bg)' }}>
      <div className={`hologram-stage flex-1 ${isSpeaking ? 'is-speaking' : ''} ${isProcessing ? 'is-processing' : ''} ${radarPaused ? 'is-radar-paused' : ''} ${focusMode ? 'is-focus-mode' : ''} ${activityVisible ? '' : 'is-activity-hidden'} ${systemPanelVisible ? '' : 'is-system-hidden'} ${signalPanelVisible ? '' : 'is-signal-hidden'}`}>
        <div className="hologram-header">
          <div className="hologram-brand">
            <span className="hologram-status-dot" />
            <span>OPENJARVIS <span className="hologram-brand-divider">//</span> COGNIÇÃO TÁTICA</span>
          </div>
          <div className="hologram-header-readouts" aria-label="Telemetria atual da sessão">
            <span>MODELO <b title={selectedModel || 'Nenhum modelo selecionado'}>{selectedModel || 'SEM MODELO'}</b></span>
            <span>TAXA <b>{latestTelemetry?.tokens_per_sec != null ? `${latestTelemetry.tokens_per_sec.toFixed(1)} TOK/S` : '—'}</b></span>
            <span>TOKENS <b>{messageCounts.tokens.toLocaleString()}</b></span>
            <span>FERRAMENTAS <b>{messageCounts.tools}</b></span>
          </div>
          <div className="hologram-header-controls">
            {mail?.connected && mail.count > 0 && (
              <button
                className="hologram-chat-toggle hologram-mail-toggle"
                type="button"
                aria-label={mailOpen ? 'Fechar e-mails não lidos' : `Abrir ${mail.count.toLocaleString('pt-BR')} e-mails não lidos`}
                aria-expanded={mailOpen}
                title={mailOpen ? 'Fechar e-mails' : 'Ver e-mails não lidos'}
                onClick={mailOpen ? closeMail : reopenMail}
              >
                <Mail size={14} />
                <span>E-MAILS</span>
                <b>{mail.count > 999 ? '999+' : mail.count}</b>
                {mailHasNew && !mailOpen && <i className="hologram-chat-toggle-indicator" />}
              </button>
            )}
            {news && news.items.length > 0 && (
              <button
                className="hologram-chat-toggle hologram-news-toggle"
                type="button"
                aria-label={newsOpen ? 'Fechar notícias' : 'Abrir manchetes do dia'}
                aria-expanded={newsOpen}
                title={newsOpen ? 'Fechar notícias' : 'Ver manchetes do dia'}
                onClick={newsOpen ? closeNews : reopenNews}
              >
                <Newspaper size={14} />
                <span>NOTÍCIAS</span>
                <b>{news.items.length}</b>
                {newsHasNew && !newsOpen && <i className="hologram-chat-toggle-indicator" />}
              </button>
            )}
            <button
              className="hologram-chat-toggle"
              type="button"
              aria-label={chatOpen ? 'Fechar painel de conversa' : 'Abrir painel de conversa'}
              aria-expanded={chatOpen}
              onClick={() => setChatOpen((open) => !open)}
              title={chatOpen ? 'Fechar conversa' : 'Abrir conversa'}
            >
              <MessageSquareText size={14} />
              <span>CONVERSA</span>
              {(isProcessing || wakeStatus === 'listening' || wakeStatus === 'conversation') && (
                <i className="hologram-chat-toggle-indicator" />
              )}
            </button>
            <div className="hologram-mode" aria-live="polite">
              <span className="hologram-mode-light" />
              {isSpeaking
                ? 'VOZ ATIVA'
                : isProcessing
                  ? 'PROCESSANDO'
                  : wakeStatus === 'transcribing'
                    ? 'TRANSCREVENDO VOZ'
                  : wakeStatus === 'listening'
                    ? 'PALAVRA DE ATIVAÇÃO ATIVA'
                    : wakeStatus === 'offline'
                      ? 'MICROFONE INATIVO'
                      : wakeStatus === 'conversation'
                        ? 'CONVERSA POR VOZ'
                        : 'EM ESPERA'}
            </div>
          </div>
        </div>

        <section className="hologram-readout hologram-readout-left" aria-label="Status do sistema e voz">
          <span className="hologram-readout-label">SISTEMA</span>
          <span className="hologram-readout-value">{systemStatus}</span>
          <span className="hologram-readout-line" />
          <span className="hologram-readout-label">LINK DE VOZ</span>
          <span className="hologram-readout-value">{voiceStatus}</span>
        </section>

        <div className="hologram-entity" role="img" aria-label="Interface holográfica com radar e núcleo de energia">
          <div className="hologram-entity-aura" />
          <svg className="hologram-radar" viewBox="0 0 600 600" aria-hidden="true">
            <defs>
              <radialGradient id="radar-core">
                <stop offset="0" stopColor="#ffffff" />
                <stop offset=".08" stopColor="#d9ffff" />
                <stop offset=".22" stopColor="#36dfff" stopOpacity=".92" />
                <stop offset=".52" stopColor="#087df4" stopOpacity=".26" />
                <stop offset="1" stopColor="#031b4a" stopOpacity="0" />
              </radialGradient>
              <radialGradient id="hologram-sphere" cx="34%" cy="28%" r="74%">
                <stop offset="0" stopColor="#9af8ff" stopOpacity=".22" />
                <stop offset=".28" stopColor="#14cce8" stopOpacity=".12" />
                <stop offset=".68" stopColor="#087dc4" stopOpacity=".08" />
                <stop offset="1" stopColor="#04142f" stopOpacity=".3" />
              </radialGradient>
              <radialGradient id="sphere-specular" cx="30%" cy="24%" r="42%">
                <stop offset="0" stopColor="#fff" stopOpacity=".92" />
                <stop offset=".16" stopColor="#98f6ff" stopOpacity=".22" />
                <stop offset="1" stopColor="#61ddff" stopOpacity="0" />
              </radialGradient>
              <filter id="radar-glow" x="-100%" y="-100%" width="300%" height="300%">
                <feGaussianBlur stdDeviation="5" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <circle className="radar-aura" cx="300" cy="300" r="248" />
            <g className="radar-rotate-slow">
              <circle className="radar-ring radar-ring-dashed" cx="300" cy="300" r="236" />
              <circle className="radar-ring radar-ring-dashed radar-ring-offset" cx="300" cy="300" r="218" />
              <path className="radar-arc radar-arc-blue" d="M 300 80 A 220 220 0 0 1 487 184" />
              <path className="radar-arc radar-arc-cyan" d="M 509 340 A 212 212 0 0 1 381 493" />
              <path className="radar-arc radar-arc-blue" d="M 211 487 A 210 210 0 0 1 82 300" />
              <path className="radar-arc radar-arc-cyan" d="M 120 157 A 218 218 0 0 1 247 89" />
            </g>
            <g className="radar-rotate-reverse">
              <circle className="radar-ring" cx="300" cy="300" r="184" />
              <circle className="radar-ring radar-ring-muted" cx="300" cy="300" r="166" />
              <path className="radar-arc radar-arc-segment" d="M 300 120 A 180 180 0 0 1 455 210" />
              <path className="radar-arc radar-arc-segment" d="M 462 330 A 165 165 0 0 1 357 449" />
              <path className="radar-arc radar-arc-segment" d="M 236 445 A 165 165 0 0 1 138 302" />
              <path className="radar-arc radar-arc-segment" d="M 166 190 A 160 160 0 0 1 271 142" />
              <circle className="radar-ring radar-ring-inner" cx="300" cy="300" r="122" />
              <circle className="radar-ring radar-ring-inner radar-ring-dashed" cx="300" cy="300" r="105" />
            </g>
            <g className="radar-orbit-back">
              <ellipse cx="300" cy="300" rx="145" ry="64" transform="rotate(-18 300 300)" />
            </g>
            <g className="radar-ticks">
              {Array.from({ length: 72 }, (_, index) => (
                <line
                  key={index}
                  x1="300"
                  y1="48"
                  x2="300"
                  y2={index % 6 === 0 ? '68' : '56'}
                  transform={`rotate(${index * 5} 300 300)`}
                />
              ))}
            </g>
            <g className="radar-crosshair">
              <path d="M300 -34V44M300 556v78M-34 300H44M556 300h78" />
              <path className="radar-crosshair-fine" d="M300 -20V620M-20 300H620" />
              <path d="M290 -8l10 14 10-14M290 608l10-14 10 14M-8 290l14 10-14 10M608 290l-14 10 14 10" />
            </g>
            <g className="radar-reticle">
              <path d="M300 202v45m0 106v45m-98-98h45m106 0h45" />
              <path d="M300 265l35 35-35 35-35-35z" />
              <circle cx="300" cy="300" r="54" />
              <circle cx="300" cy="300" r="18" />
            </g>
            <circle className="radar-core-glow" cx="300" cy="300" r="78" filter="url(#radar-glow)" />
            <path className="radar-scan" d="M300 300 L300 67 A233 233 0 0 1 372 78 Z" />
            <g className="radar-orbitals">
              <ellipse className="radar-orbit radar-orbit-one" cx="300" cy="300" rx="145" ry="64" transform="rotate(-18 300 300)" />
              <ellipse className="radar-orbit radar-orbit-amber" cx="300" cy="300" rx="145" ry="64" transform="rotate(-18 300 300)" />
              <ellipse className="radar-orbit radar-orbit-two" cx="300" cy="300" rx="133" ry="51" transform="rotate(34 300 300)" />
              <ellipse className="radar-orbit radar-orbit-three" cx="300" cy="300" rx="119" ry="34" transform="rotate(4 300 300)" />
            </g>
            <g className="radar-sphere">
              <circle className="radar-sphere-shell" cx="300" cy="300" r="103" />
              <g className="radar-sphere-turn">
                <g className="radar-sphere-grid">
                  {Array.from({ length: 9 }, (_, index) => {
                    const latitude = ((index - 4) * 15 * Math.PI) / 180;
                    const radiusX = 100 * Math.cos(latitude);
                    const centerY = 300 - 100 * Math.sin(latitude);
                    return (
                      <ellipse
                        key={`latitude-${index}`}
                        cx="300"
                        cy={centerY}
                        rx={radiusX}
                        ry={Math.max(3, radiusX * 0.19)}
                      />
                    );
                  })}
                  <ellipse cx="300" cy="300" rx="30" ry="100" />
                  <ellipse cx="300" cy="300" rx="62" ry="100" />
                  <ellipse cx="300" cy="300" rx="88" ry="100" />
                  <path d="M300 200 C245 224 245 376 300 400 M300 200 C355 224 355 376 300 400" />
                </g>
                <g className="radar-sphere-dots">
                  {sphereDots.map((dot, index) => (
                    <circle
                      key={index}
                      cx={dot.x}
                      cy={dot.y}
                      r={0.75 + dot.depth * 0.9}
                      opacity={0.22 + dot.depth * 0.68}
                    />
                  ))}
                </g>
                <ellipse className="radar-sphere-latitude" cx="300" cy="300" rx="98" ry="32" />
                <ellipse className="radar-sphere-longitude" cx="300" cy="300" rx="43" ry="100" />
                <path className="radar-sphere-meridian" d="M300 200 C245 224 245 376 300 400 M300 200 C355 224 355 376 300 400" />
              </g>
              <g className="radar-sphere-front-orbit">
                <ellipse cx="300" cy="300" rx="145" ry="64" transform="rotate(-18 300 300)" />
                <ellipse className="radar-sphere-orbit-amber" cx="300" cy="300" rx="145" ry="64" transform="rotate(-18 300 300)" />
              </g>
              <circle className="radar-sphere-specular" cx="300" cy="300" r="103" />
              <circle className="radar-center" cx="300" cy="300" r="4" />
            </g>
          </svg>
          <div className="hologram-radar-callouts" aria-hidden="true">
            <span className="hologram-radar-callout callout-top">MOTOR / {engineName}</span>
            <span className="hologram-radar-callout callout-left">MODELO / {selectedModel || 'NENHUM'}</span>
            <span className="hologram-radar-callout callout-right">TOK/S / {latestTelemetry?.tokens_per_sec?.toFixed(1) ?? '—'}</span>
            <span className="hologram-radar-callout callout-bottom">SESSÃO / {messageCounts.tokens.toLocaleString()} TOKENS</span>
            <span className="hologram-radar-callout callout-upper-right">1º TOKEN / {latestTelemetry?.ttft_ms != null ? `${latestTelemetry.ttft_ms.toLocaleString()} MS` : '—'}</span>
            <span className="hologram-radar-callout callout-lower-left">FERRAMENTAS / {messageCounts.tools}</span>
            <i className="hologram-radar-target target-one" />
            <i className="hologram-radar-target target-two" />
            <i className="hologram-radar-target target-three" />
          </div>
        </div>

        <div className="hologram-ruler" aria-hidden="true">
          {Array.from({ length: 41 }, (_, index) => <span key={index} />)}
        </div>
        <div className="hologram-grid-floor" aria-hidden="true" />
        <svg className="hud-frame hud-frame-top" viewBox="0 0 800 44" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 6H236L262 32H538L564 6H800" />
          <path className="is-thin" d="M0 14H220L254 40H546L580 14H800" />
          <path className="is-accent" d="M262 32H306M494 32H538" />
        </svg>
        <svg className="hud-frame hud-frame-bottom hud-hide-sm" viewBox="0 0 800 44" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 38H236L262 12H538L564 38H800" />
          <path className="is-thin" d="M0 30H220L254 4H546L580 30H800" />
          <path className="is-accent" d="M262 12H306M494 12H538" />
        </svg>
        <div className="hud-codeblock hud-codeblock-left" aria-hidden="true">
          {leftCode.map(([label, value]) => (
            <div key={label}><span>{label}</span><b title={value}>{value}</b></div>
          ))}
        </div>
        <div className="hud-codeblock hud-codeblock-right" aria-hidden="true">
          {rightCode.map(([label, value]) => (
            <div key={label}><span>{label}</span><b title={value}>{value}</b></div>
          ))}
        </div>

        <div className="hud-col hud-col-left">
          <section className="hud-badges hud-hide-md" aria-label="Estado dos enlaces">
            <div className="hud-badges-head"><span className="is-active">CONEXÃO</span><span>VOZ</span></div>
            <div className="hud-badge-row">
              <HudDial busy={isProcessing} className="hud-dial-sm" />
              <b className={`hud-badge-letter ${serverConnected ? 'is-on' : ''}`}>A</b>
              <span className="hud-badge-meta">API<small>{systemStatus}</small></span>
            </div>
            <div className="hud-badge-row">
              <HudDial busy={isSpeaking} className="hud-dial-sm" />
              <b className={`hud-badge-letter ${voiceStatus === 'PRONTO' || isSpeaking ? 'is-on' : ''}`}>V</b>
              <span className="hud-badge-meta">VOZ<small>{voiceStatus}</small></span>
            </div>
          </section>
        <section className="hologram-side-panel hologram-side-panel-left" aria-label="Status real da conexão e modelo">
          <span className="hud-panel-title"><i /> EXECUÇÃO / LINK NEURAL</span>
          <span className="hud-panel-model" title={selectedModel || serverInfo?.model || 'Nenhum modelo selecionado'}>
            {selectedModel || serverInfo?.model || 'NENHUM MODELO SELECIONADO'}
          </span>
          <div className="hud-panel-status-dials">
            {statusBars.map((status) => (
              <div className={`hud-status-dial ${status.ready ? 'is-ready' : ''}`} key={status.label}>
                <svg viewBox="0 0 48 48" aria-hidden="true">
                  <circle className="hud-status-dial-track" cx="24" cy="24" r="20" />
                  <circle
                    className="hud-status-dial-progress"
                    cx="24"
                    cy="24"
                    r="20"
                    strokeDasharray={status.ready ? '74 126' : '0 126'}
                    transform="rotate(-90 24 24)"
                  />
                </svg>
                <span className="hud-status-dial-light" />
                <span className="hud-status-dial-label">{status.label}</span>
                <b>{status.state}</b>
              </div>
            ))}
          </div>
          <div className="hud-panel-detail-grid">
            <div><span>MOTOR</span><b title={engineName}>{engineName}</b></div>
            <div><span>PROVEDOR</span><b title={selectedModelInfo?.owned_by || 'Desconhecido'}>{selectedModelInfo?.owned_by || '—'}</b></div>
            <div><span>MENSAGENS</span><b>{messageCounts.user + messageCounts.assistant}</b></div>
            <div><span>CHAMADAS</span><b>{messageCounts.tools}</b></div>
            <div><span>COFRE</span><b title={vault?.vault || 'Nenhum cofre configurado'}>{vault?.connected ? vault.vault : vaultStatus}</b></div>
            <div><span>NOTAS DO COFRE</span><b>{vault?.notes != null ? vault.notes.toLocaleString() : '—'}</b></div>
          </div>
          <span className="hud-panel-code">
            {modelsLoading ? 'BUSCANDO MODELOS' : `${models.length} DISPONÍVEIS  /  ${messageCounts.tokens.toLocaleString()} TOKENS DA SESSÃO`}
          </span>
        </section>
          <section className="hud-list-panel hud-hide-sm" aria-label="Mensagens recentes da sessão">
            <span className="hud-panel-title"><i /> [SESSÃO_{sessionTag}]</span>
            <div className="hud-list-body">
              <div
                className="hud-gauge"
                role="img"
                aria-label={`Última resposta: ${gaugeFill}% do maior volume recente de tokens`}
              >
                <span style={{ height: `${gaugeFill}%` }} />
              </div>
              {recentRows.length > 0 ? (
                <ol className="hud-list-rows">
                  {recentRows.map((row) => (
                    <li className={`is-${row.role}`} key={row.id}>
                      <span>{row.role === 'user' ? 'VOCÊ' : 'ZETTA'} · {row.time}</span>
                      <b>{row.tokens != null ? row.tokens.toLocaleString() : '—'}</b>
                    </li>
                  ))}
                </ol>
              ) : (
                <span className="hud-panel-no-data">SEM MENSAGENS</span>
              )}
            </div>
          </section>
        <section className="hologram-resource-panel hud-hide-sm" aria-label="Telemetria da sessão">
          <span className="hud-panel-title"><i /> SESSÃO / RECURSOS</span>
          <div className="hud-panel-detail-grid">
            <div><span>TOKENS DA SESSÃO</span><b>{messageCounts.tokens.toLocaleString()}</b></div>
            <div><span>MODELOS DISPONÍVEIS</span><b>{modelsLoading ? 'BUSCANDO' : models.length}</b></div>
            <div><span>TOKENS ECONOMIZADOS</span><b>{savings?.total_tokens.toLocaleString() ?? '—'}</b></div>
            <div><span>CHAMADAS TOTAIS</span><b>{savings?.total_calls.toLocaleString() ?? '—'}</b></div>
          </div>
          <span className="hud-panel-code">
            ÚLTIMA RESPOSTA / {latestUsage?.prompt_tokens.toLocaleString() ?? '—'} ENTRADA · {latestUsage?.completion_tokens.toLocaleString() ?? '—'} SAÍDA
          </span>
        </section>
        </div>

        <div className="hud-col hud-col-right">
          <section className="hud-disc-panel hud-hide-md" aria-label="Fluxo de tokens recentes">
            <svg className="hud-disc" viewBox="0 0 80 80" aria-hidden="true">
              <circle className="hud-disc-ring" cx="40" cy="40" r="36" />
              <g className="hud-disc-spin">
                <circle className="hud-disc-ring hud-disc-dashed" cx="40" cy="40" r="28" />
                <path className="hud-disc-arc" d="M40 6a34 34 0 0 1 29 17" />
              </g>
              <ellipse className="hud-disc-ring" cx="40" cy="40" rx="18" ry="7" />
              <circle className="hud-disc-core" cx="40" cy="40" r="3.5" />
            </svg>
            <div
              className="hud-mini-bars"
              role="img"
              aria-label={`${signalBars.length} respostas medidas recentemente`}
            >
              {signalBars.length > 0 ? (
                signalBars.slice(-10).map((bar) => (
                  <i
                    key={bar.id}
                    style={{ height: `${Math.max(8, ((bar.prompt + bar.completion) / maxTokens) * 100)}%` }}
                  />
                ))
              ) : (
                <span className="hud-panel-no-data">SEM FLUXO DE TOKENS</span>
              )}
            </div>
          </section>
        <section className="hologram-side-panel hologram-side-panel-right" aria-label="Métricas reais de tokens das respostas recentes">
          <span className="hud-panel-title"><i /> INFERÊNCIA / ANÁLISE DE SINAL</span>
          {signalBars.length > 0 ? (
            <>
              <div
                className="hud-panel-spectrum"
                role="img"
                aria-label={`${signalBars.length} respostas medidas; última resposta: ${latestUsage?.prompt_tokens ?? 0} tokens de entrada e ${latestUsage?.completion_tokens ?? 0} de saída`}
              >
                {signalBars.map((bar) => (
                  <span
                    key={bar.id}
                    title={`${bar.timestamp}: ${bar.prompt.toLocaleString()} entrada, ${bar.completion.toLocaleString()} saída`}
                    style={{ height: `${Math.max(4, ((bar.prompt + bar.completion) / maxTokens) * 100)}%` }}
                  >
                    <i style={{ height: `${bar.prompt + bar.completion > 0 ? (bar.prompt / (bar.prompt + bar.completion)) * 100 : 0}%` }} />
                    <b style={{ height: `${bar.prompt + bar.completion > 0 ? (bar.completion / (bar.prompt + bar.completion)) * 100 : 0}%` }} />
                  </span>
                ))}
              </div>
              <div className="hud-spectrum-legend">
                <span><i className="hud-spectrum-input" /> ENTRADA</span>
                <span><i className="hud-spectrum-output" /> GERADOS</span>
              </div>
              <span className="hud-panel-code">
                ÚLTIMA / {latestUsage?.prompt_tokens.toLocaleString() ?? '—'} ENTRADA · {latestUsage?.completion_tokens.toLocaleString() ?? '—'} SAÍDA
              </span>
            </>
          ) : (
            <span className="hud-panel-no-data">AGUARDANDO MÉTRICAS DE TOKENS</span>
          )}
          <div className="hud-panel-detail-grid hud-panel-inference-grid">
            <div><span>VELOCIDADE</span><b>{latestTelemetry?.tokens_per_sec ? `${latestTelemetry.tokens_per_sec.toFixed(1)} tok/s` : '—'}</b></div>
            <div><span>PRIMEIRO TOKEN</span><b>{latestTelemetry?.ttft_ms != null ? `${latestTelemetry.ttft_ms.toLocaleString()} ms` : '—'}</b></div>
            <div><span>ÚLTIMA EXECUÇÃO</span><b>{latestTelemetry?.total_ms != null ? `${(latestTelemetry.total_ms / 1000).toFixed(2)} s` : '—'}</b></div>
            <div><span>CHAMADAS TOTAIS</span><b>{savings?.total_calls.toLocaleString() ?? '—'}</b></div>
            <div><span>ÚLTIMA ENTRADA</span><b>{latestUsage?.prompt_tokens.toLocaleString() ?? '—'}</b></div>
            <div><span>ÚLTIMA SAÍDA</span><b>{latestUsage?.completion_tokens.toLocaleString() ?? '—'}</b></div>
          </div>
          <span className="hud-panel-code">
            {savings ? `TOTAL / ${savings.total_tokens.toLocaleString()} TOKENS` : 'TELEMETRIA DE ECONOMIA / INDISPONÍVEL'}
            {isProcessing ? `  ·  AO VIVO / ${activityPhaseLabel.toUpperCase()} / ${(streamState.elapsedMs / 1000).toFixed(1)}S` : ''}
          </span>
        </section>
          <section className="hud-indication-panel hud-hide-md" aria-label="Tendência das respostas recentes">
            <span className="hud-panel-title"><i /> CONHECIMENTO / TENDÊNCIAS</span>
            {trendRows.map((row) => (
              <div className="hud-indication" key={row.label}>
                <span>{row.label}</span>
                <svg viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden="true">
                  {row.series.length > 0 && <polyline points={sparkPoints(row.series, 100, 20)} />}
                </svg>
                <b>{row.value}</b>
              </div>
            ))}
            <div className="hud-sys-grid" aria-label="Recursos do computador">
              {systemRows.map((row) => (
                <div className="hud-sys-cell" key={row.label} title={row.title}>
                  <span>{row.label}</span>
                  <b>{row.value}</b>
                  {row.bar != null ? (
                    <i className="hud-sys-bar"><u style={{ width: `${row.bar}%` }} /></i>
                  ) : (
                    <svg viewBox="0 0 100 16" preserveAspectRatio="none" aria-hidden="true">
                      {row.series && row.series.length > 0 && (
                        <polyline points={sparkPoints(row.series, 100, 16, row.peak)} />
                      )}
                    </svg>
                  )}
                </div>
              ))}
            </div>
            <span className="hud-panel-code">
              COFRE / {vault?.connected ? `${vault.vault} · ${vault.notes ?? 0} NOTAS` : vaultStatus}
            </span>
          </section>
        <section
          className="hologram-activity"
          aria-label="Atividade atual do assistente"
          aria-live="polite"
          aria-atomic="false"
        >
          <div className="hologram-activity-heading">
            <span className="hologram-activity-signal" />
            <span>ATIVIDADE <i>//</i> AO VIVO</span>
            <b className={isProcessing || isSpeaking || wakeStatus === 'conversation' ? 'is-live' : ''}>
              {isProcessing
                ? 'AO VIVO'
                : isSpeaking
                  ? 'FALANDO'
                  : wakeStatus === 'transcribing'
                    ? 'OUVINDO'
                    : wakeStatus === 'conversation'
                      ? 'CONVERSA ATIVA'
                      : visibleToolCalls.length
                        ? 'ÚLTIMA EXECUÇÃO'
                        : 'PRONTO'}
            </b>
          </div>
          <div className="hologram-activity-phase">
            <span className={isProcessing || isSpeaking || wakeStatus === 'transcribing' || wakeStatus === 'conversation' ? 'is-live' : ''} />
            <strong>
              {wakeStatus === 'transcribing'
                ? 'Transcrevendo áudio recebido'
                : wakeStatus === 'conversation'
                  ? 'Modo de conversa ativo — ouvindo você'
                  : activityPhaseLabel}
            </strong>
            {isProcessing && streamState.elapsedMs > 0 && (
              <time>{(streamState.elapsedMs / 1000).toFixed(1)}S</time>
            )}
          </div>
          <div className="hologram-activity-summary">
            <span>{messageCounts.tools} EVENTOS DE FERRAMENTA</span>
            <span>{messageCounts.user + messageCounts.assistant} MENSAGENS</span>
            {isProcessing && <b>{(streamState.elapsedMs / 1000).toFixed(1)}S DECORRIDOS</b>}
          </div>
          {visibleToolCalls.length > 0 ? (
            <ol className="hologram-activity-tools">
              {visibleToolCalls.map((toolCall, index) => (
                <li className={`hologram-activity-tool is-${toolCall.status}`} key={toolCall.id}>
                  <span className="hologram-activity-step">{String(index + 1).padStart(2, '0')}</span>
                  <span className="hologram-activity-tool-copy">
                    <strong>{getToolLabel(toolCall.tool)}</strong>
                    {getToolTarget(toolCall) && <small>{getToolTarget(toolCall)}</small>}
                  </span>
                  <span className="hologram-activity-tool-status">
                    {getToolStatusLabel(toolCall.status, toolCall.latency)}
                  </span>
                </li>
              ))}
            </ol>
          ) : isProcessing || isSpeaking ? (
            <div className="hologram-activity-wait">
              <span className="hologram-activity-wave" aria-hidden="true">
                {Array.from({ length: 14 }, (_, index) => <i key={index} />)}
              </span>
              <span>
                {isSpeaking
                  ? 'RESPOSTA SENDO REPRODUZIDA'
                  : streamState.content
                    ? 'RESPOSTA EM FORMAÇÃO'
                    : 'AGUARDANDO PRÓXIMA ETAPA DO AGENTE'}
              </span>
            </div>
          ) : (
            <div className="hologram-activity-wait">
              <span>Envie uma solicitação para acompanhar as ações aqui.</span>
            </div>
          )}
          {isProcessing && streamState.content && (
            <p className="hologram-activity-preview">
              {streamState.content.replace(/\s+/g, ' ').slice(-220)}
            </p>
          )}
        </section>
          <section className="hud-timer-panel hud-hide-sm" aria-label="Hora atual e áudio">
            <div className="hud-timer-top">
              <svg className="hud-terrain" viewBox="0 0 120 60" aria-hidden="true">
                {TERRAIN_ROWS.map((y) => {
                  const half = 14 + ((y - 8) / 48) * 44;
                  return <path key={y} d={`M${60 - half} ${y}H${60 + half}`} />;
                })}
                {TERRAIN_COLUMNS.map((column) => (
                  <path key={column} d={`M${60 + column * 5.6} 8L${60 + column * 10} 56`} />
                ))}
              </svg>
              <div className="hud-timer">
                <small>HORA ATUAL</small>
                <time dateTime={now.toISOString()}>{formatTimeOfDay(now)}</time>
              </div>
            </div>
            <div className="hud-wave" aria-hidden="true">
              {Array.from({ length: 26 }, (_, index) => <i key={index} />)}
            </div>
          </section>
        </div>

        <section className="hologram-compact-metrics" aria-label="Telemetria resumida">
          <div><span>CONEXÃO</span><b>{systemStatus}</b></div>
          <div><span>MODELO</span><b title={selectedModel || 'Nenhum modelo selecionado'}>{selectedModel || '—'}</b></div>
          <div><span>GERAÇÃO</span><b>{latestTelemetry?.tokens_per_sec ? `${latestTelemetry.tokens_per_sec.toFixed(1)} tok/s` : '—'}</b></div>
          <div><span>TOKENS DO CHAT</span><b>{messageCounts.tokens.toLocaleString()}</b></div>
        </section>

        <section className="hologram-readout hologram-readout-right" aria-label="Status do áudio e telemetria da resposta">
          <span className="hologram-readout-label">NÚCLEO DE IA</span>
          <span className="hologram-readout-value">{serverConnected ? 'CONECTADO' : 'DESCONECTADO'}</span>
          <div className="hologram-waveform" aria-hidden="true">
            {Array.from({ length: 18 }, (_, index) => (
              <span
                key={index}
                className={isSpeaking ? 'is-active' : undefined}
                style={{ animationDelay: `${index * 35}ms` }}
              />
            ))}
          </div>
          <span className="hologram-readout-caption">
            {isSpeaking ? 'SAÍDA DE ÁUDIO / AO VIVO' : `SAÍDA DE ÁUDIO / ${voiceStatus}`}
          </span>
          {latestAssistantMessage && (
            <XRayFooter
              usage={latestAssistantMessage.usage}
              telemetry={latestAssistantMessage.telemetry}
              isResearch={latestAssistantMessage.isResearch}
              variant="hologram"
            />
          )}
        </section>

        <footer className="hologram-footer">
          <div className="hud-footer-left">
            <HudDial busy={isProcessing} />
            <div className="hud-footer-left-copy">
          <span className="hologram-footer-link">
            <strong>{serverConnected ? 'LINK ESTABELECIDO' : apiReachable === null ? 'LINK / VERIFICANDO' : 'LINK / INATIVO'}</strong>
            <small>{isSpeaking
              ? 'FALANDO'
              : isProcessing
                ? 'PROCESSANDO'
                : wakeStatus === 'listening'
                  ? 'ESCUTANDO “OLÁ, ZETTA”'
                  : wakeStatus === 'transcribing'
                    ? 'TRANSCREVENDO VOZ'
                    : wakeStatus === 'conversation'
                      ? 'CONVERSA POR VOZ ATIVA'
                      : wakeStatus === 'offline'
                        ? 'LINK DE VOZ INATIVO'
                        : 'AGUARDANDO COMANDO'}</small>
          </span>
              <span
                className="hud-loading"
                role="progressbar"
                aria-label="Processamento do assistente"
                aria-valuetext={isProcessing ? 'Processando' : 'Pronto'}
              >
                <small>{isProcessing ? 'PROCESSANDO' : 'PRONTO'}</small>
                <i className={isProcessing ? 'is-busy' : ''} />
              </span>
            </div>
          </div>
          <nav className="hologram-command-dock" aria-label="Controles da interface holográfica">
            <button className="hologram-command-button" type="button" aria-label={systemPanelVisible ? 'Ocultar status do sistema' : 'Mostrar status do sistema'} aria-pressed={systemPanelVisible} title={systemPanelVisible ? 'Ocultar status' : 'Mostrar status'} onClick={() => setSystemPanelVisible((visible) => !visible)}><Server size={15} /></button>
            <button className="hologram-command-button" type="button" aria-label={signalPanelVisible ? 'Ocultar telemetria' : 'Mostrar telemetria'} aria-pressed={signalPanelVisible} title={signalPanelVisible ? 'Ocultar telemetria' : 'Mostrar telemetria'} onClick={() => setSignalPanelVisible((visible) => !visible)}><BarChart3 size={15} /></button>
            <button className="hologram-command-button" type="button" aria-label={radarPaused ? 'Retomar varredura do radar' : 'Pausar varredura do radar'} aria-pressed={radarPaused} title={radarPaused ? 'Retomar varredura' : 'Pausar varredura'} onClick={() => setRadarPaused((paused) => !paused)}><Radar size={15} /></button>
            <button className="hologram-command-button" type="button" aria-label={activityVisible ? 'Ocultar atividade' : 'Mostrar atividade'} aria-pressed={activityVisible} title={activityVisible ? 'Ocultar atividade' : 'Mostrar atividade'} onClick={() => setActivityVisible((visible) => !visible)}><Activity size={15} /></button>
            <button className="hologram-command-button" type="button" aria-label={chatOpen ? 'Fechar conversa' : 'Abrir conversa'} aria-pressed={chatOpen} title={chatOpen ? 'Fechar conversa' : 'Abrir conversa'} onClick={() => setChatOpen((open) => !open)}><MessageSquareText size={15} /></button>
            <button className="hologram-command-button" type="button" aria-label={focusMode ? 'Restaurar painéis laterais' : 'Focar radar'} aria-pressed={focusMode} title={focusMode ? 'Restaurar painéis' : 'Focar radar'} onClick={() => setFocusMode((focused) => !focused)}><Focus size={15} /></button>
            <button className="hologram-command-button" type="button" aria-label="Restaurar interface" title="Restaurar interface" onClick={restoreLayout}><RotateCcw size={15} /></button>
          </nav>
          <div className="hud-footer-right">
            <span className="hologram-footer-id">OJ / 01</span>
            <HudDial busy={isSpeaking} />
          </div>
        </footer>

        <UnreadMailPanel mail={mail} open={mailOpen} onClose={closeMail} />
        <NewsPanel news={news} open={newsOpen} onClose={closeNews} />

        {morningNeedsGesture && (
          <button className="morning-hint" type="button" onClick={startMorning}>
            <Volume2 size={14} />
            <span>OUVIR O RESUMO DO DIA</span>
          </button>
        )}
      </div>

      <>
        {chatOpen && (
          <button
            className="chat-sidebar-backdrop"
            type="button"
            aria-label="Fechar conversa"
            onClick={() => setChatOpen(false)}
          />
        )}
        <aside
          className={`chat-sidebar ${chatOpen ? 'is-open' : ''}`}
          id="hologram-chat-panel"
          aria-label="Painel de conversa"
          aria-hidden={!chatOpen}
          inert={!chatOpen}
        >
          <div className="chat-sidebar-heading">
            <span>LINK NEURAL <i>//</i> CONVERSA</span>
            <div className="chat-sidebar-actions">
              <button
                className={`chat-sidebar-delete ${confirmDelete ? 'is-confirming' : ''}`}
                type="button"
                aria-label={confirmDelete ? 'Confirmar exclusão da conversa' : 'Excluir conversa'}
                title={
                  isProcessing
                    ? 'Aguarde a resposta terminar para excluir'
                    : activeId === null
                      ? 'Nenhuma conversa para excluir'
                      : confirmDelete
                        ? 'Clique de novo para confirmar'
                        : 'Excluir conversa'
                }
                disabled={!canDelete}
                onClick={handleDeleteConversation}
              >
                <Trash2 size={15} />
                {confirmDelete && <span>CONFIRMAR?</span>}
              </button>
              <button
                className="chat-sidebar-close"
                type="button"
                aria-label="Fechar conversa"
                onClick={() => setChatOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
          </div>
          <div className="chat-sidebar-content">
            <ChatArea
              onWakeStatusChange={setWakeStatus}
            />
          </div>
        </aside>
      </>
    </div>
  );
}
