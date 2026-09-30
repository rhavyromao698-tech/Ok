# RDA Sports + RDA Sports Social

Aplicação full-stack responsiva construída sem dependências externas de runtime: Node.js 22+ e SQLite via `node:sqlite`. O projeto reúne catálogo, parceiros, RDA Social, eventos, Elite, conteúdo, atendimento, área privada e Command Center.

## Rodando localmente

```bash
npm start
```

Abra `http://localhost:4173`. O banco é criado em `data/rda.sqlite` na primeira execução e recebe dados demonstrativos identificados como demonstração.

Para desenvolvimento com reload:

```bash
npm run dev
```

Para validar os fluxos principais:

```bash
npm test
```

## Contas demonstrativas

As contas abaixo são criadas apenas no banco local e devem ser trocadas antes de qualquer ambiente real:

| Perfil | E-mail | Senha |
| --- | --- | --- |
| Administrador | `admin@rda.local` | `Admin@12345` |
| Equipe | `equipe@rda.local` | `Equipe@12345` |
| Cliente | `cliente@rda.local` | `Cliente@12345` |
| Atleta | `atleta@rda.local` | `Atleta@12345` |
| Responsável | `responsavel@rda.local` | `Responsavel@12345` |

## O que está ativo

- Sessão real com cookie HttpOnly, senha com `scrypt`, logout e cadastro.
- Banco SQLite persistente, migração inicial, índices e seed separado em modo demonstração.
- Catálogo com busca, categoria, marca, faixa de preço, disponibilidade, ordenação, variantes, favoritos, comparação e contato contextual.
- Controle de estoque por variante, movimentações auditadas e separação entre RDA e parceiro.
- Página e catálogo do parceiro E Lavamos Nós com itens marcados como demonstração.
- RDA Social com rascunho retomável, protocolo, envio, fila de análise, histórico, capacidade transacional, aprovação e vínculo de atleta.
- Áreas privadas de atleta e responsável com escopo de vínculos, agenda, presenças, desempenho, benefícios e notificações.
- Eventos com inscrição persistente, cancelamento, capacidade e prevenção de duplicidade.
- RDA Elite com saldo, histórico e resgate validado no servidor.
- Central de artigos, FAQ, busca global, quiz de orientação e contato.
- Command Center para indicadores, produtos, estoque, candidaturas, eventos, parceiros, artigos e auditoria.
- Coach local com respostas baseadas em dados atuais. A integração OpenAI é opcional e só é usada quando `OPENAI_API_KEY` existir no servidor; ela nunca é exposta ao navegador.

## Limitações deliberadas

Pagamentos, envio real de e-mail/WhatsApp/push, upload de documentos de menores e integração escolar externa não são simulados como ativos. O modelo de dados e os pontos de extensão estão preparados, mas a aplicação mostra estados honestos até que os provedores e políticas sejam configurados.

Os dados seed são demonstrativos e não representam estoque, agenda, preços, vagas, resultados ou parceiros confirmados.
