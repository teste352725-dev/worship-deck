# Runtime unificado — Local + Web

A V3 usa **um único frontend**: `apps/deck/public`.

- Local: servido pelo `server.js` na porta 4177.
- Web: `scripts/build-web.js` copia exatamente os mesmos arquivos para `apps/web/public` durante o build do Vercel.

## Detecção de runtime

`runtime.js` identifica `local` ou `web` pelo host e tenta consultar `GET /api/runtime`.

A resposta pode sobrescrever:

```json
{
  "kind": "web",
  "apiContractVersion": 1,
  "apiBase": "",
  "capabilities": {}
}
```

O frontend continua chamando apenas URLs relativas `/api/...`; não conhece IP do Holyrics, OBS ou Bridge.

## Contrato API v1

O backend Local e o backend Web devem apresentar a mesma forma para as rotas usadas pela interface:

| Rota | Método | Função |
| --- | --- | --- |
| `/api/runtime` | GET | Runtime/capacidades |
| `/api/status` | GET | Estado Holyrics |
| `/api/control` | POST | Próximo/anterior/F8/F9/F10/encerrar |
| `/api/favorites` | GET | Favoritos |
| `/api/favorite` | POST | Executar favorito |
| `/api/obs/status` | GET | Estado/cenas OBS |
| `/api/obs/scene` | POST | Trocar cena |
| `/api/obs/reconnect` | POST | Reconectar OBS |
| `/api/automation` | GET/POST | Estado/configuração do Diretor |
| `/api/automation/resume` | POST | Reavaliar automação |
| `/api/config` | GET/POST | Configuração pública/editável |
| `/api/diagnostics` | GET | Diagnóstico |
| `/api/agents` | GET | Agents locais |
| `/api/network` | GET | Endereços LAN |
| `/api/profiles` | GET/POST | Perfis locais |
| `/api/backup/export` | POST | Backup local |
| `/api/backup/import` | POST | Restaurar backup |
| `/api/cloud/test` | POST | Testar Web/Bridge |

Na Web, recursos exclusivamente locais podem anunciar `false` em `capabilities` e responder com uma mensagem amigável até receberem um equivalente seguro via Bridge.

## Regra de arquitetura

Não criar `app-web.js` e `app-local.js`.

Qualquer mudança visual deve ser feita uma única vez em `apps/deck/public`. Diferenças entre ambientes pertencem à camada de API/runtime.
