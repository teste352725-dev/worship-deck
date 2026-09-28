# Worship Deck para Android

Aplicativo Android nativo que abre a mesma interface responsiva do Deck.

## Fluxo

1. Procura o Worship Deck por anúncio UDP na rede local.
2. Se necessário, pesquisa os IPs da rede nas portas 4177 e 4277.
3. Ao encontrar, abre `/?mode=deck&source=apk`.
4. O WebView mantém `deviceId` e token de pareamento permanentemente.
5. Caso não encontre, oferece endereço manual e endereço remoto.

## Build local

Requer JDK 17, Android SDK 35 e Gradle 8.7:

```sh
cd apps/android
gradle assembleDebug
```

APK: `app/build/outputs/apk/debug/app-debug.apk`.
