import { GripHorizontal, Newspaper, X } from 'lucide-react';
import { useDraggablePanel } from '../hooks/useDraggablePanel';
import { usePopupPanel } from '../hooks/usePopupPanel';
import type { Headlines } from '../lib/api';
import { safeWebLink } from '../lib/news';
import { formatMailAge } from '../lib/unread-mail';

interface NewsPanelProps {
  news: Headlines | null;
  open: boolean;
  onClose: () => void;
}

/**
 * Headlines that open by themselves, with the same entrance as the unread-mail
 * panel (and alongside it): a newspaper unfolds, then the headlines slide in
 * one by one. Each headline links to the article. It can be dragged by its
 * header, never takes focus, and the close button and Escape put it away.
 */
export function NewsPanel({ news, open, onClose }: NewsPanelProps) {
  const mounted = usePopupPanel(open, onClose);
  const { panelRef, dragging, style, handleProps } = useDraggablePanel('news', mounted);

  if (!mounted || !news || news.items.length === 0) return null;

  const sources = [...new Set(news.items.map((item) => item.source))];

  return (
    <section
      ref={panelRef}
      className={`mail-panel news-panel ${open ? '' : 'is-leaving'} ${dragging ? 'is-dragging' : ''}`}
      style={style}
      role="dialog"
      aria-label="Manchetes do dia"
      aria-live="polite"
    >
      <header
        className="mail-panel-head"
        title="Arraste para mover · clique duas vezes para recolocar"
        {...handleProps}
      >
        <GripHorizontal className="mail-panel-grip" size={16} aria-hidden="true" />
        <svg className="news-paper" viewBox="0 0 120 92" aria-hidden="true">
          <rect className="news-paper-sheet" x="14" y="8" width="92" height="76" rx="3" />
          <g className="news-paper-lines">
            <rect x="24" y="18" width="72" height="9" rx="1.5" />
            <path d="M24 38h30M24 48h30M24 58h30M24 68h22M66 38h30M66 48h30M66 58h30M66 68h18" />
          </g>
          <rect className="news-paper-half news-paper-half-left" x="14" y="8" width="46" height="76" rx="3" />
          <rect className="news-paper-half news-paper-half-right" x="60" y="8" width="46" height="76" rx="3" />
        </svg>
        <div className="mail-panel-title">
          <small>NOTÍCIAS</small>
          <strong>Manchetes do dia</strong>
        </div>
        <button
          className="mail-panel-close"
          type="button"
          aria-label="Fechar notícias"
          title="Fechar"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </header>

      <ul className="mail-list">
        {news.items.map((item, index) => {
          const link = safeWebLink(item.link);
          const body = (
            <>
              <Newspaper size={13} aria-hidden="true" />
              <span className="mail-item-copy">
                <strong>{item.source}</strong>
                <span className="news-item-title" title={item.title}>
                  {item.title}
                </span>
              </span>
              <time dateTime={item.published ?? undefined}>{formatMailAge(item.published)}</time>
            </>
          );
          return (
            <li className="mail-item news-item" key={item.id} style={{ ['--i' as string]: index }}>
              {link ? (
                <a className="news-item-link" href={link} target="_blank" rel="noopener noreferrer">
                  {body}
                </a>
              ) : (
                <div className="news-item-link">{body}</div>
              )}
            </li>
          );
        })}
      </ul>

      <p className="mail-more">{sources.join(' · ')}</p>
    </section>
  );
}
