import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { TokenUsage, MessageTelemetry } from '../../types';

interface Props {
  usage?: TokenUsage;
  telemetry?: MessageTelemetry;
  isResearch?: boolean;
  variant?: 'default' | 'hologram';
}

function formatMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function XRayFooter({ usage, telemetry, isResearch = false, variant = 'default' }: Props) {
  const [expanded, setExpanded] = useState(false);

  // Build collapsed summary parts. For Deep Research responses we hide the
  // chat-side engine/model (which doesn't reflect the planner that actually
  // produced the answer) and label the response with the mode instead.
  const parts: string[] = [];
  if (isResearch) {
    parts.push('Deep Research');
  } else {
    if (telemetry?.engine) parts.push(telemetry.engine);
    if (telemetry?.model_id) parts.push(telemetry.model_id);
  }
  if (telemetry?.complexity_tier) parts.push(telemetry.complexity_tier);
  if (telemetry?.total_ms) parts.push(formatMs(telemetry.total_ms));
  if (usage && (usage.prompt_tokens || usage.completion_tokens)) {
    parts.push(`${usage.prompt_tokens} input tokens`);
    parts.push(`${usage.completion_tokens} output tokens`);
  }

  if (parts.length === 0 && !usage?.total_tokens) return null;

  // Fallback: just show total tokens if no telemetry
  const summary = parts.length > 0 ? parts.join(' - ') : `${usage!.total_tokens} tokens`;

  // Build expanded rows
  const rows: Array<{ label: string; value: string; color?: string }> = [];
  if (isResearch) {
    rows.push({ label: 'Mode', value: 'Deep Research' });
  } else if (telemetry?.engine) {
    const modelDetail = telemetry.model_id || '';
    rows.push({ label: 'Engine', value: `${telemetry.engine}${modelDetail ? ` (${modelDetail})` : ''}` });
  }
  if (usage) {
    const tokenParts = [`${usage.completion_tokens} generated`, `${usage.prompt_tokens} prompt`];
    // Estimate thinking tokens: if total generated >> visible output, the
    // difference is internal reasoning (e.g. Qwen3.5 thinking mode).
    if (telemetry?.tokens_per_sec && telemetry.total_ms && usage.completion_tokens > 50) {
      const visibleEstimate = Math.ceil(
        (telemetry.total_ms / 1000) * telemetry.tokens_per_sec,
      );
      if (usage.completion_tokens > visibleEstimate * 1.5) {
        const thinking = usage.completion_tokens - visibleEstimate;
        tokenParts.push(`~${thinking} thinking`);
      }
    }
    rows.push({ label: 'Tokens', value: tokenParts.join(' \u00B7 ') });
  }
  if (telemetry?.complexity_tier) {
    rows.push({
      label: 'Complexity',
      value: `${telemetry.complexity_tier} (${telemetry.complexity_score?.toFixed(2)})`,
    });
  }
  if (telemetry?.suggested_max_tokens) {
    rows.push({ label: 'Token budget', value: `${telemetry.suggested_max_tokens}` });
  }
  if (telemetry?.tokens_per_sec) {
    rows.push({ label: 'Speed', value: `${Math.round(telemetry.tokens_per_sec)} tok/s` });
  }
  if (telemetry?.ttft_ms != null || telemetry?.total_ms != null) {
    const latencyParts: string[] = [];
    if (telemetry.ttft_ms != null) latencyParts.push(`TTFT ${formatMs(telemetry.ttft_ms)}`);
    if (telemetry.total_ms != null) latencyParts.push(`Total ${formatMs(telemetry.total_ms)}`);
    rows.push({ label: 'Latency', value: latencyParts.join(' \u00B7 ') });
  }

  return (
    <div
      className={variant === 'hologram' ? 'hologram-telemetry' : undefined}
      style={variant === 'default' ? { borderTop: '1px solid var(--color-border-subtle)', marginTop: '0.375rem' } : undefined}
    >
      {/* Collapsed row */}
      <button
        onClick={() => rows.length > 0 && setExpanded(!expanded)}
        aria-expanded={rows.length > 0 ? expanded : undefined}
        className={`flex items-center gap-2 w-full text-left py-1 ${variant === 'hologram' ? 'hologram-telemetry-toggle' : ''}`}
        style={variant === 'default' ? { cursor: rows.length > 0 ? 'pointer' : 'default' } : undefined}
      >
        <span
          className={`w-1 h-1 rounded-full shrink-0 ${variant === 'hologram' ? 'hologram-telemetry-dot' : ''}`}
          style={variant === 'default' ? { background: 'var(--color-accent)' } : undefined}
        />
        <span
          className="text-[11px] flex-1"
          style={variant === 'default' ? { color: 'var(--color-text-tertiary)', fontFamily: 'system-ui' } : undefined}
        >
          {summary}
        </span>
        {rows.length > 0 && (
          expanded
            ? <ChevronUp size={10} className={variant === 'hologram' ? 'hologram-telemetry-chevron' : undefined} style={variant === 'default' ? { color: 'var(--color-text-tertiary)' } : undefined} />
            : <ChevronDown size={10} className={variant === 'hologram' ? 'hologram-telemetry-chevron' : undefined} style={variant === 'default' ? { color: 'var(--color-text-tertiary)' } : undefined} />
        )}
      </button>

      {/* Expanded trace */}
      {expanded && rows.length > 0 && (
        <div
          className={`rounded-lg mt-1 px-3 py-2 ${variant === 'hologram' ? 'hologram-telemetry-details' : ''}`}
          style={variant === 'default' ? { background: 'rgba(0, 0, 0, 0.15)' } : undefined}
        >
          <div className="grid gap-y-0.5" style={{ gridTemplateColumns: 'auto 1fr', columnGap: '1rem' }}>
            {rows.map((row) => (
              <div key={row.label} className="contents">
                <span className="text-[11px]" style={variant === 'hologram' ? undefined : { color: 'var(--color-text-tertiary)', fontFamily: 'monospace' }}>
                  {row.label}
                </span>
                <span
                  className="text-[11px]"
                  style={variant === 'hologram' ? undefined : { color: row.color || 'var(--color-text-secondary)', fontFamily: 'monospace' }}
                >
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
