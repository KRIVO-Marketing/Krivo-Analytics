-- KRIVO Eventos: cobertura de eventos em tempo real. Preços ainda não definidos (null), editáveis pela plataforma.
insert into public.catalog_items (kind, position, code, name, tagline, billing, summary, upfront_label, has_monthly, details)
select 'product', 6, '06', 'KRIVO Eventos', 'Cobertura de eventos em tempo real', 'Por evento',
 'O KRIVO Eventos manda uma equipe ao evento do cliente e publica a cobertura enquanto ele acontece, em Stories e Reels, e entrega depois o aftermovie e, quando contratado, as fotos. O cliente aparece no digital no momento do evento, sem precisar produzir nada.',
 'Por evento', false,
 $j$[
  {"label":"Para quem","text":"Casas, marcas e organizadores que fazem eventos (festas, lançamentos, shows, feiras, inaugurações) e querem divulgá-los na hora e ter material de qualidade depois."},
  {"label":"O que entrega","text":"Cobertura em tempo real no Instagram, com Stories durante o evento e Reels publicados no mesmo dia ou em até poucas horas; aftermovie editado depois do evento."},
  {"label":"Opcional","text":"Cobertura fotográfica com galeria tratada e entregue por link. Entra como adicional ou em pacote, a definir."},
  {"label":"Como roda","text":"Briefing antes do evento (horários, momentos-chave, pessoas e marcas a destacar, perfis a marcar); equipe no local; publicação ao vivo no perfil do cliente ou da KRIVO, conforme combinado; entrega do aftermovie e das fotos depois."},
  {"label":"Fora do escopo","text":"Transmissão ao vivo em plataforma de streaming, tráfego pago para divulgar o evento, locação de equipamento de som e luz, deslocamento e hospedagem fora da cidade base (cobrados à parte)."},
  {"label":"Pré-requisito do cliente","text":"Acesso ou autorização para publicar no perfil, credenciamento da equipe no local e um contato do evento para tirar dúvidas durante a cobertura."},
  {"label":"Prazo de entrega","text":"Stories e Reels: durante e logo após o evento. Aftermovie e fotos: a definir (sugestão: poucos dias úteis)."},
  {"label":"Cobrança","text":"Por evento, com valor conforme duração e itens contratados (Stories, Reels, aftermovie, fotos). Pacote para clientes com vários eventos: a avaliar."},
  {"label":"Atenção ao prometer","text":"Combinar por escrito o número de Reels, a duração do aftermovie e a quantidade mínima de fotos. Não prometer alcance ou número de seguidores."}
 ]$j$::jsonb
where not exists (select 1 from public.catalog_items where kind = 'product' and code = '06');
