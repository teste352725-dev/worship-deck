WORSHIP AGENT V3
================

Use esta pasta SOMENTE no PC onde o OBS esta rodando, quando o OBS estiver em um
computador diferente do Worship Deck/Holyrics.

1. Certifique-se de que o OBS WebSocket esta ativo (normalmente porta 4455).
2. Execute start-agent.bat.
3. Se o Firewall do Windows perguntar, permita em Redes Privadas.
4. No Worship Deck, ative Localizar automaticamente o PC do OBS.

O arquivo agent-config.json e criado automaticamente na primeira execucao.
Ele guarda apenas o ID/nome do Agent e a porta do OBS. Nao guarda senha do OBS.

Para iniciar junto com o Windows, execute uma vez:
instalar-inicializacao-windows.bat
