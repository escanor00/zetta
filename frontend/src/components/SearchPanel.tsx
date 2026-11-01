import { GripHorizontal, Search, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { fetchSearch, type SearchResult } from '../lib/api';
import { safeWebLink } from '../lib/news';
import { useDraggablePanel } from '../hooks/useDraggablePanel';
import { usePopupPanel } from '../hooks/usePopupPanel';

interface SearchPanelProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Quick web search. Same panel as mail and news (drag by the header, Escape
 * and X close it). The results are listed here; each one opens in a new window.
 * Google cannot be read or shown inside another page, so it is only a link.
 */
export function SearchPanel({ open, onClose }: SearchPanelProps) {
  const mounted = usePopupPanel(open, onClose);
  const { panelRef, dragging, style, handleProps } = useDraggablePanel('search', mounted);
  const [query, setQuery] = useState('');
  const [asked, setAsked] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');

  if (!mounted) return null;

  const search = async (event: FormEvent) => {
    event.preventDefault();
    const text = query.trim();
    if (!text) return;
    setAsked(text);
    setStatus('loading');
    const found = await fetchSearch(text);
    setResults(found?.items ?? []);
    setStatus(found && !found.error ? 'idle' : 'error');
  };

  return (
    <section
      ref={panelRef}
      className={`mail-panel search-panel ${open ? '' : 'is-leaving'} ${dragging ? 'is-dragging' : ''}`}
      style={style}
      role="dialog"
      aria-label="Pesquisa rápida"
    >
      <header
        className="mail-panel-head"
        title="Arraste para mover · clique duas vezes para recolocar"
        {...handleProps}
      >
        <GripHorizontal className="mail-panel-grip" size={16} aria-hidden="true" />
        <div className="mail-panel-title">
          <small>WEB</small>
          <strong>PESQUISA RÁPIDA</strong>
        </div>
        <button className="mail-panel-close" type="button" aria-label="Fechar" title="Fechar" onClick={onClose}>
          <X size={16} />
        </button>
      </header>
      <form className="site-form search-form" onSubmit={search}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="O que você quer pesquisar?"
          aria-label="Pesquisar no Google"
        />
        <button type="submit" aria-label="Pesquisar">
          <Search size={14} />
        </button>
      </form>
      {status === 'loading' && <p className="site-note">Pesquisando…</p>}
      {status === 'error' && <p className="site-note">Não consegui pesquisar agora.</p>}
      {status === 'idle' && asked && results.length === 0 && (
        <p className="site-note">Nada encontrado.</p>
      )}
      {results.length > 0 && (
        <ul className="search-results">
          {results.map((item) => (
            <li key={item.link}>
              <a href={safeWebLink(item.link) ?? undefined} target="_blank" rel="noopener noreferrer">
                <strong>{item.title}</strong>
                <small>{item.host}</small>
                <span>{item.snippet}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {asked && (
        <a
          className="search-google"
          href={`https://www.google.com/search?q=${encodeURIComponent(asked)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          VER NO GOOGLE
        </a>
      )}
    </section>
  );
}
