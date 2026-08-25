# Arquitetura atual

```text
Celular / Tablet
       |
       v
Worship Deck local (porta 4177)
       |
       +--> Holyrics API / Plugin
       |
       +--> Worship Agent (rede local)
                 |
                 v
            OBS WebSocket
```

Para acesso remoto pela internet, a arquitetura Web usa Vercel + Bridge, mantendo o OBS sem exposição direta da porta 4455 à internet.
