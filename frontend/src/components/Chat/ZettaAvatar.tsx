interface Props {
  size?: 'hero' | 'compact';
  active?: boolean;
}

/** The user's holographic portrait used as Zetta's visual identity. */
export function ZettaAvatar({ size = 'compact', active = false }: Props) {
  return (
    <div
      className={`zetta-avatar zetta-avatar--${size}${active ? ' zetta-avatar--active' : ''}`}
      role="img"
      aria-label="Rosto holográfico da Zetta"
    >
      <img
        className="zetta-avatar__portrait"
        src="/zetta-hologram.png"
        alt=""
        draggable={false}
      />
    </div>
  );
}
