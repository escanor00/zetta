import { useState, useEffect, useRef } from 'react';

interface TypewriterTextProps {
  text: string;
  isSpeaking: boolean;
  speed?: number; // palavras por segundo
  className?: string;
}

/**
 * Componente que revela o texto palavra por palavra enquanto está falando.
 * Quando não está falando, mostra o texto completo imediatamente.
 */
export function TypewriterText({
  text,
  isSpeaking,
  speed = 3.5, // ~3.5 palavras/segundo = velocidade natural de fala
  className = ''
}: TypewriterTextProps) {
  const [visibleText, setVisibleText] = useState(''); // Começa vazio sempre
  const wordsRef = useRef<string[]>([]);
  const currentIndexRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Se não está falando, mostra tudo imediatamente
    if (!isSpeaking) {
      setVisibleText(text);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    // Divide em palavras, preservando espaços e pontuação
    const words = text.match(/\S+\s*/g) || [];
    wordsRef.current = words;
    currentIndexRef.current = 0;

    // Inicia com texto vazio quando começa a falar
    setVisibleText('');

    // Intervalo entre palavras (em ms)
    const intervalMs = (1000 / speed);

    timerRef.current = setInterval(() => {
      if (currentIndexRef.current < wordsRef.current.length) {
        const wordsToShow = wordsRef.current.slice(0, currentIndexRef.current + 1);
        setVisibleText(wordsToShow.join(''));
        currentIndexRef.current++;
      } else {
        // Terminou de revelar todas as palavras
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      }
    }, intervalMs);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [text, isSpeaking, speed]);

  return (
    <span className={className}>
      {visibleText}
      {isSpeaking && currentIndexRef.current < wordsRef.current.length && (
        <span className="typewriter-cursor">▋</span>
      )}
    </span>
  );
}
