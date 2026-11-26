-- Contrato agora sai em PDF: atualiza o texto do item do checklist (modelo e cópias ainda não concluídas).
update public.delivery_templates
set title = 'Preencher o contrato e gerar o PDF',
    description = 'Preencher o formulário do contrato na plataforma (partes, produtos, valores, datas) e gerar o PDF.'
where title = 'Preencher o contrato e gerar o Word';

update public.delivery_items
set title = 'Preencher o contrato e gerar o PDF',
    description = 'Preencher o formulário do contrato na plataforma (partes, produtos, valores, datas) e gerar o PDF.'
where title = 'Preencher o contrato e gerar o Word' and not done;
