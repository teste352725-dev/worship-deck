# Worship Deck

Painel de controle para operação de culto com integração entre **Holyrics**, **OBS Studio**, celulares/tablets e controle Web.

> Estado atual: **V3 Alpha 4 RC** — em testes e estabilização antes das versões APK e desktop instalável.

## Estrutura

- `apps/deck/` — servidor local e interface do Worship Deck.
- `apps/agent/` — Worship Agent para o computador da live/OBS.
- `docs/` — documentação do projeto.

## Requisitos atuais

- Windows 10/11 ou Linux compatível com Node.js
- Node.js 18 ou superior
- Holyrics com API Server configurada
- OBS Studio com obs-websocket habilitado

## Executar o Deck no Windows

Entre em `apps/deck/` e execute:

```bat
start.bat
```

Na primeira execução, se `config.json` não existir, o Worship Deck cria a configuração padrão automaticamente.

## Executar o Agent no PC do OBS

Entre em `apps/agent/` e execute:

```bat
start-agent.bat
```

O Agent anuncia o computador na rede local para que o Worship Deck consiga localizar o OBS automaticamente.

## Segurança

Arquivos com credenciais e configurações locais, como `config.json` e `agent-config.json`, **não devem ser enviados ao GitHub** e estão listados no `.gitignore`.

## Próximas etapas

- estabilização da V3 mobile;
- unificação Local + Web;
- V3 Web no Vercel;
- APK Android;
- `WorshipDeck-Setup.exe` e `WorshipAgent.exe`;
- sistema de plugins e integrações.

## Aviso

Projeto independente, não oficial do Holyrics nem do OBS Studio.
