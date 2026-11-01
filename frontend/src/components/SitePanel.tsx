import { ExternalLink, GripHorizontal, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useDraggablePanel } from '../hooks/useDraggablePanel';
import { usePopupPanel } from '../hooks/usePopupPanel';
import { fetchYoutubeFeed, type YoutubeVideo } from '../lib/api';
import { toYoutubeEmbed, type SiteInfo } from '../lib/sites';
import { formatMailAge } from '../lib/unread-mail';

interface SitePanelProps {
  site: SiteInfo;
  open: boolean;
  onClose: () => void;
}

/**
 * Same panel as mail and news (drag by the header, Escape and X close it) that
 * shows a site. YouTube and YouTube Music play pasted links in a player;
 * Instagram cannot be embedded, so it offers a button that opens it in a window.
 * YouTube Music docks as a small player under the central circle.
 */
export function SitePanel({ site, open, onClose }: SitePanelProps) {
  const mounted = usePopupPanel(open, onClose);
  const { panelRef, dragging, style, handleProps } = useDraggablePanel(`site-${site.id}`, mounted);
  const [draft, setDraft] = useState('');
  const [embed, setEmbed] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [videos, setVideos] = useState<YoutubeVideo[]>([]);
  const feed = site.id === 'youtube';

  useEffect(() => {
    if (!feed || !open) return;
    let cancelled = false;
    void fetchYoutubeFeed(8).then((result) => {
      if (!cancelled && result) setVideos(result.items);
    });
    return () => {
      cancelled = true;
    };
  }, [feed, open]);

  if (!mounted) return null;

  const play = (event: FormEvent) => {
    event.preventDefault();
    const next = toYoutubeEmbed(draft);
    setInvalid(next === null);
    if (next) setEmbed(next);
  };

  return (
    <section
      ref={panelRef}
      className={`mail-panel site-panel site-panel-${site.id} ${open ? '' : 'is-leaving'} ${dragging ? 'is-dragging' : ''}`}
      style={style}
      role="dialog"
      aria-label={site.label}
    >
      <header
        className="mail-panel-head"
        title="Arraste para mover · clique duas vezes para recolocar"
        {...handleProps}
      >
        <GripHorizontal className="mail-panel-grip" size={16} aria-hidden="true" />
        <div className="mail-panel-title">
          <small>SITE</small>
          <strong>{site.label}</strong>
        </div>
        <a
          className="mail-panel-close"
          href={site.home}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Abrir ${site.label} em outra janela`}
          title="Abrir em outra janela"
        >
          <ExternalLink size={15} />
        </a>
        <button className="mail-panel-close" type="button" aria-label="Fechar" title="Fechar" onClick={onClose}>
          <X size={16} />
        </button>
      </header>

      {site.embeddable ? (
        <div className="site-body">
          {embed && feed && (
            <button className="site-back" type="button" onClick={() => setEmbed(null)}>
              ← VOLTAR AOS VÍDEOS
            </button>
          )}
          {feed && !embed && videos.length > 0 && (
            <ul className="yt-grid">
              {videos.map((video) => (
                <li key={video.id}>
                  <button
                    type="button"
                    className="yt-card"
                    title={video.title}
                    onClick={() => setEmbed(toYoutubeEmbed(`https://www.youtube.com/watch?v=${video.id}`))}
                  >
                    <img src={video.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" />
                    <span className="yt-card-title">{video.title}</span>
                    <small>
                      {video.channel} · {formatMailAge(video.published)}
                    </small>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {embed && (
            <iframe
              className="site-frame"
              src={embed}
              title={site.label}
              allow="autoplay; encrypted-media; picture-in-picture"
              referrerPolicy="strict-origin-when-cross-origin"
            />
          )}
          <form className="site-form" onSubmit={play}>
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Cole aqui o link do vídeo ou da playlist"
              aria-label="Link do vídeo"
              aria-invalid={invalid}
            />
            <button type="submit">TOCAR</button>
          </form>
          {invalid && <p className="site-note">Link não reconhecido.</p>}
        </div>
      ) : (
        <div className="site-body">
          <p className="site-note">O Instagram não deixa ser aberto dentro de outra tela.</p>
          <a className="site-open" href={site.home} target="_blank" rel="noopener noreferrer">
            ABRIR O INSTAGRAM
          </a>
        </div>
      )}
    </section>
  );
}
