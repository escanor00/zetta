import { GripHorizontal, Mail, X } from 'lucide-react';
import { useDraggablePanel } from '../hooks/useDraggablePanel';
import { usePopupPanel } from '../hooks/usePopupPanel';
import type { UnreadMail } from '../lib/api';
import { formatMailAge } from '../lib/unread-mail';

interface UnreadMailPanelProps {
  mail: UnreadMail | null;
  open: boolean;
  onClose: () => void;
}

/**
 * Unread mail that opens by itself: the panel boots up like a hologram, an
 * envelope opens, the letter rises, and the messages slide in one by one. It
 * never takes focus, can be dragged by its header (double click puts it back)
 * and always has a close button; Escape closes it too.
 */
export function UnreadMailPanel({ mail, open, onClose }: UnreadMailPanelProps) {
  const mounted = usePopupPanel(open, onClose);
  const { panelRef, dragging, style, handleProps } = useDraggablePanel('mail', mounted);

  if (!mounted || !mail || mail.count === 0) return null;

  const hidden = mail.count - mail.messages.length;
  const title =
    mail.count === 1
      ? '1 e-mail não lido'
      : `${mail.count.toLocaleString('pt-BR')} e-mails não lidos`;

  return (
    <section
      ref={panelRef}
      className={`mail-panel ${open ? '' : 'is-leaving'} ${dragging ? 'is-dragging' : ''}`}
      style={style}
      role="dialog"
      aria-label={title}
      aria-live="polite"
    >
      <header
        className="mail-panel-head"
        title="Arraste para mover · clique duas vezes para recolocar"
        {...handleProps}
      >
        <GripHorizontal className="mail-panel-grip" size={16} aria-hidden="true" />
        <svg className="mail-envelope" viewBox="0 0 120 92" aria-hidden="true">
          <rect className="mail-envelope-back" x="6" y="30" width="108" height="58" rx="4" />
          <g className="mail-letter">
            <rect x="20" y="16" width="80" height="56" rx="3" />
            <path d="M30 32h60M30 44h60M30 56h36" />
          </g>
          <path className="mail-envelope-front" d="M6 88L60 54l54 34z" />
          <path className="mail-envelope-flap" d="M6 30l54 34 54-34z" />
        </svg>
        <div className="mail-panel-title">
          <small>CAIXA DE ENTRADA</small>
          <strong>{title}</strong>
        </div>
        <button
          className="mail-panel-close"
          type="button"
          aria-label="Fechar e-mails não lidos"
          title="Fechar"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </header>

      <ul className="mail-list">
        {mail.messages.map((message, index) => (
          <li className="mail-item" key={message.uid} style={{ ['--i' as string]: index }}>
            <Mail size={13} aria-hidden="true" />
            <span className="mail-item-copy">
              <strong title={message.from_address}>{message.from}</strong>
              <span title={message.subject}>{message.subject}</span>
            </span>
            <time dateTime={message.date ?? undefined}>{formatMailAge(message.date)}</time>
          </li>
        ))}
      </ul>

      {hidden > 0 && (
        <p className="mail-more">
          e mais {hidden.toLocaleString('pt-BR')} {hidden === 1 ? 'mensagem' : 'mensagens'} na caixa de entrada
        </p>
      )}
    </section>
  );
}
