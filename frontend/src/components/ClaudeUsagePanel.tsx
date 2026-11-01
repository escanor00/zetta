import { GripHorizontal, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useDraggablePanel } from '../hooks/useDraggablePanel';
import { usePopupPanel } from '../hooks/usePopupPanel';
import {
  calibrateClaudeUsage,
  fetchClaudeUsage,
  type ClaudeUsage,
  type ClaudeUsageWindow,
} from '../lib/api';

interface ClaudeUsagePanelProps {
  open: boolean;
  onClose: () => void;
  /** Sits in the side column like its sections, instead of floating as a popup. */
  docked?: boolean;
}

const REFRESH_MS = 60_000;

function UsageBar({ label, window }: { label: string; window: ClaudeUsageWindow }) {
  const percent = window.percent;
  return (
    <div className="usage-row">
      <div className="usage-row-head">
        <span>{label}</span>
        <b>{percent != null ? `${percent.toFixed(0)}%` : '—'}</b>
      </div>
      <div className="usage-bar" role="progressbar" aria-valuenow={percent ?? 0} aria-valuemin={0} aria-valuemax={100}>
        <i className={percent != null && percent >= 90 ? 'is-high' : ''} style={{ width: `${Math.min(percent ?? 0, 100)}%` }} />
      </div>
      <small>{window.tokens.toLocaleString()} tokens</small>
    </div>
  );
}

/** Two bars (5 hours and weekly) of Claude Code use: a popup like mail and news, or docked in the side column. */
export function ClaudeUsagePanel({ open, onClose, docked = false }: ClaudeUsagePanelProps) {
  const mounted = usePopupPanel(open && !docked, onClose);
  const { panelRef, dragging, style, handleProps } = useDraggablePanel('claude-usage', mounted);
  const [usage, setUsage] = useState<ClaudeUsage | null>(null);
  const [fiveHour, setFiveHour] = useState('');
  const [weekly, setWeekly] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = () =>
      fetchClaudeUsage().then((next) => {
        if (!cancelled && next) setUsage(next);
      });
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [open]);

  const calibrate = async (event: FormEvent) => {
    event.preventDefault();
    const five = Number(fiveHour.replace(',', '.'));
    const week = Number(weekly.replace(',', '.'));
    if (!(five > 0 && five <= 100 && week > 0 && week <= 100)) {
      setError('Digite porcentagens entre 1 e 100.');
      return;
    }
    try {
      setUsage(await calibrateClaudeUsage(five, week));
      setError('');
      setFiveHour('');
      setWeekly('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao calibrar');
    }
  };

  const body = (
    <div className="usage-body">
      {usage ? (
        <>
          <UsageBar label="5 HORAS" window={usage.five_hour} />
          <UsageBar label="SEMANAL" window={usage.weekly} />
        </>
      ) : (
        <small>Lendo o uso…</small>
      )}
      <form className="usage-calibrate" onSubmit={calibrate}>
        <small>{usage?.calibrated ? 'Recalibrar com as porcentagens atuais:' : 'Digite as porcentagens que o Claude mostra agora:'}</small>
        <div>
          <input inputMode="decimal" placeholder="5h %" value={fiveHour} onChange={(e) => setFiveHour(e.target.value)} aria-label="Porcentagem das 5 horas" />
          <input inputMode="decimal" placeholder="semana %" value={weekly} onChange={(e) => setWeekly(e.target.value)} aria-label="Porcentagem semanal" />
          <button type="submit">CALIBRAR</button>
        </div>
        {error && <small className="usage-error">{error}</small>}
      </form>
    </div>
  );

  if (docked) {
    if (!open) return null;
    return (
      <section className="hologram-activity usage-docked" aria-label="Uso do Claude">
        <div className="hologram-activity-heading">
          <span>CLAUDE CODE <i>//</i> USO</span>
        </div>
        {body}
      </section>
    );
  }

  if (!mounted) return null;

  return (
    <section
      ref={panelRef}
      className={`mail-panel usage-panel ${open ? '' : 'is-leaving'} ${dragging ? 'is-dragging' : ''}`}
      style={style}
      role="dialog"
      aria-label="Uso do Claude"
    >
      <header
        className="mail-panel-head"
        title="Arraste para mover · clique duas vezes para recolocar"
        {...handleProps}
      >
        <GripHorizontal className="mail-panel-grip" size={16} aria-hidden="true" />
        <div className="mail-panel-title">
          <small>CLAUDE CODE</small>
          <strong>USO</strong>
        </div>
        <button className="mail-panel-close" type="button" aria-label="Fechar" title="Fechar" onClick={onClose}>
          <X size={16} />
        </button>
      </header>
      {body}
    </section>
  );
}
