/**
 * PONTO DE TROCA: assim que houver o SVG oficial do logotipo (KRIVO® completo) e do monograma (KV®),
 * substitua o conteúdo deste componente pelo SVG. Não redesenhar o K com fonte comum.
 * Solução provisória: palavra KRIVO em negrito com ® sobrescrito.
 */
export default function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-start font-bold leading-none tracking-tight ${className}`} role="img" aria-label="KRIVO">
      <span aria-hidden>KRIVO</span>
      <sup aria-hidden className="ml-0.5 text-[0.4em] font-normal leading-none">®</sup>
    </span>
  );
}
