import { GripHorizontal, X } from 'lucide-react';
import { useDraggablePanel } from '../hooks/useDraggablePanel';
import { usePopupPanel } from '../hooks/usePopupPanel';
import type { NoteHit } from '../lib/notes';

interface NoteCardsProps {
  notes: NoteHit[];
  open: boolean;
  onClose: () => void;
}

/** Same panel as mail and news, listing the notes the assistant found (title + excerpt). */
export function NoteCards({ notes, open, onClose }: NoteCardsProps) {
  const mounted = usePopupPanel(open, onClose);
  const { panelRef, dragging, style, handleProps } = useDraggablePanel('notes', mounted);

  if (!mounted) return null;

  return (
    <section
      ref={panelRef}
      className={`mail-panel note-panel ${open ? '' : 'is-leaving'} ${dragging ? 'is-dragging' : ''}`}
      style={style}
      role="dialog"
      aria-label="Notas usadas"
    >
      <header
        className="mail-panel-head"
        title="Arraste para mover · clique duas vezes para recolocar"
        {...handleProps}
      >
        <GripHorizontal className="mail-panel-grip" size={16} aria-hidden="true" />
        <div className="mail-panel-title">
          <small>OBSIDIAN</small>
          <strong>NOTAS USADAS</strong>
        </div>
        <button className="mail-panel-close" type="button" aria-label="Fechar" title="Fechar" onClick={onClose}>
          <X size={16} />
        </button>
      </header>
      <ul className="note-list">
        {notes.map((note) => (
          <li className="note-card" key={note.path} title={note.path}>
            <strong>{note.title}</strong>
            <p>{note.excerpt}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
